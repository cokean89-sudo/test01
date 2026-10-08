// 문서: 목록 · 생성 · 저장 · 버전 기록 · 복원 · 페이지 맡기 · 활동 기록
//
// 편집기는 실시간 공동 편집(WebSocket, server/collab)으로 저장한다. 아래 PUT 저장은 예전 방식 클라이언트용으로 남겨 두었고,
// 들어온 문서를 같은 공동 편집 방에 '바뀐 부분만' 반영한다 (그 사이 다른 사람이 고친 것은 남는다).

import { Router } from "express";
import { z } from "zod";
import { SAFE_IMAGE_SRC } from "../../shared/files";
import { toB64 } from "../../shared/collabProtocol";
import type { DocContent } from "../../shared/collab";
import type { CollabDoc, DocumentData } from "../../shared/types";
import { peerUserOf, type CollabHub } from "../collab/hub";
import { hasRole, requireUser, teamRole } from "../context";
import { publish } from "../events";
import type { Repo } from "../repo";
import { enforceLimit, HttpError } from "../security";
import { recordUsage } from "../usage";

const MAX_DOC_BYTES = 8 * 1024 * 1024;

const DocBody = z
  .object({
    title: z.string().max(300),
    query: z.string().max(1000).optional(),
    settings: z.record(z.string(), z.unknown()),
    pages: z.array(z.record(z.string(), z.unknown())).max(500),
    tray: z
      .array(
        z.object({
          id: z.string().max(40),
          src: z.string().max(4000),
          refId: z.string().max(40).optional(),
          natW: z.number().optional(),
          natH: z.number().optional(),
          caption: z.string().max(500).optional(),
          sourceUrl: z.string().max(4000).optional(),
          fit: z.enum(["cover", "contain"]).optional(),
          focusX: z.number().optional(),
          focusY: z.number().optional(),
          from: z.string().max(80).optional(),
          addedAt: z.number(),
        }),
      )
      .max(200)
      .optional(),
  })
  .passthrough();

function parseDoc(body: unknown): Pick<DocumentData, "title" | "query" | "settings" | "pages" | "tray"> {
  if (JSON.stringify(body ?? {}).length > MAX_DOC_BYTES) throw new HttpError(413, "문서가 너무 커요.");
  const d = DocBody.parse(body) as unknown as DocumentData;
  // 이미지 주소에 javascript: 등 위험한 스킴이 들어오지 않게 한다 (http(s) · 앱 샘플 · 앱에 저장한 이미지만)
  for (const p of d.pages) {
    for (const e of p.elements ?? []) {
      if (e.type === "image" && e.src && !SAFE_IMAGE_SRC.test(e.src)) e.src = "";
      if (e.type === "image" && e.sourceUrl && !/^https?:\/\//i.test(e.sourceUrl)) e.sourceUrl = undefined;
    }
  }
  // 보관함 이미지도 같은 기준
  const tray = d.tray?.filter((t) => SAFE_IMAGE_SRC.test(t.src) && !t.src.startsWith("/samples/")).map((t) => (t.sourceUrl && !/^https?:\/\//i.test(t.sourceUrl) ? { ...t, sourceUrl: undefined } : t));
  return { title: d.title, query: d.query, settings: d.settings, pages: d.pages, tray };
}

const PAGE_ID = /^[\w-]{1,40}$/;

export function documentsRouter(repo: Repo, collab: CollabHub): Router {
  const r = Router({ mergeParams: true });

  /** 이 팀의 문서인지 확인하고 공동 편집 정보 */
  const docOf = (teamId: string, id: string) => {
    const info = repo.docTeam(id) === teamId ? repo.docForCollab(id) : undefined;
    if (!info) throw new HttpError(404, "문서를 찾을 수 없어요.");
    return { ...info, content: collab.liveContent(id) ?? info.content };
  };

  r.get("/documents", teamRole(repo, "viewer"), (req, res) => {
    res.json(repo.listDocs(req.teamId!));
  });

  r.post("/documents", teamRole(repo, "editor"), (req, res) => {
    enforceLimit(`doc-create:${req.user!.id}`, 200, 60 * 60_000);
    const doc = repo.createDoc(req.teamId!, parseDoc(req.body) as DocumentData, req.user!.id);
    recordUsage(repo.db, { userId: req.user!.id, teamId: req.teamId!, kind: "doc", detail: "create" });
    repo.log(req.teamId!, req.user!.id, "doc.create", `문서 '${doc.title}' 생성`, { type: "doc", id: doc.id });
    publish(req.teamId!, "docs", {}, req.user!.id);
    res.json(doc);
  });

  r.put("/documents/:id", teamRole(repo, "editor"), (req, res) => {
    const user = req.user!;
    enforceLimit(`doc-save:${user.id}`, 1200, 60 * 60_000);
    const id = String(req.params.id);
    const baseVersion = z.number().int().min(1).parse(req.body?.baseVersion);
    const input = parseDoc(req.body?.doc);
    const cur = docOf(req.teamId!, id);
    // 출발한 버전과 비교해 바뀐 부분만 얹는다 (그 버전이 없으면 지금 내용 기준)
    const base: DocContent = (baseVersion !== cur.version && repo.versionContent(id, baseVersion)) || repo.versionContent(id, cur.version) || cur.content;
    // 보관함을 모르는 예전 클라이언트가 저장해도 지금 보관함을 지우지 않는다
    const next: DocContent = { ...input, tray: input.tray ?? base.tray };
    const out = collab.applyContent(id, peerUserOf(user), req.role!, base, next);
    if (!out) throw new HttpError(404, "문서를 찾을 수 없어요.");
    if (out.rejected) throw new HttpError(409, out.rejected, "assigned_page");
    const merged = baseVersion !== cur.version;
    res.json({ version: out.version, merged, doc: merged ? repo.getDoc(req.teamId!, id) : undefined, conflicts: [] });
  });

  r.post("/documents/:id/duplicate", teamRole(repo, "editor"), (req, res) => {
    const found = repo.getDoc(req.teamId!, String(req.params.id));
    if (!found) throw new HttpError(404, "문서를 찾을 수 없어요.");
    const src = { ...found, ...(collab.liveContent(found.id) ?? {}) };
    const copy = repo.createDoc(req.teamId!, { ...src, title: src.title + " (사본)" }, req.user!.id);
    recordUsage(repo.db, { userId: req.user!.id, teamId: req.teamId!, kind: "doc", detail: "duplicate" });
    repo.log(req.teamId!, req.user!.id, "doc.duplicate", `문서 '${src.title}' 복제`, { type: "doc", id: copy.id });
    publish(req.teamId!, "docs", {}, req.user!.id);
    res.json(copy);
  });

  r.delete("/documents/:id", teamRole(repo, "editor"), (req, res) => {
    const doc = repo.getDoc(req.teamId!, String(req.params.id));
    if (!doc) throw new HttpError(404, "문서를 찾을 수 없어요.");
    collab.drop(doc.id);
    repo.deleteDoc(req.teamId!, doc.id);
    repo.log(req.teamId!, req.user!.id, "doc.delete", `문서 '${doc.title}' 삭제`);
    publish(req.teamId!, "docs", {}, req.user!.id);
    res.json({ ok: true });
  });

  r.get("/documents/:id/versions", teamRole(repo, "viewer"), (req, res) => {
    if (repo.docTeam(String(req.params.id)) !== req.teamId) throw new HttpError(404, "문서를 찾을 수 없어요.");
    res.json(repo.listVersions(String(req.params.id)));
  });

  r.get("/documents/:id/versions/:version", teamRole(repo, "viewer"), (req, res) => {
    const doc = repo.getVersion(req.teamId!, String(req.params.id), Number(req.params.version));
    if (!doc) throw new HttpError(404, "버전을 찾을 수 없어요.");
    res.json(doc);
  });

  r.post("/documents/:id/versions/:version/restore", teamRole(repo, "editor"), (req, res) => {
    const id = String(req.params.id);
    const v = Number(req.params.version);
    const cur = docOf(req.teamId!, id);
    const old = repo.versionContent(id, v);
    if (!old) throw new HttpError(404, "버전을 찾을 수 없어요.");
    // 공동 편집 방에 새 변경으로 반영 → 문서를 보고 있는 사람들에게도 바로 보인다 (담당자만 편집과 상관없이)
    collab.applyContent(id, peerUserOf(req.user!), req.role!, cur.content, old, { restore: v });
    repo.log(req.teamId!, req.user!.id, "doc.restore", `문서 '${cur.content.title}'를 이전 버전(v${v})으로 복원`, { type: "doc", id });
    res.json(repo.getDoc(req.teamId!, id));
  });

  // ─── 페이지 맡기 ────────────────────────────────────────

  /** 이 페이지 맡기 — 편집자 이상. 다른 사람이 맡은 페이지는 먼저 해제해야 한다 */
  r.post("/documents/:id/pages/:pageId/assign", teamRole(repo, "editor"), (req, res) => {
    const id = String(req.params.id);
    const pageId = String(req.params.pageId);
    const me = req.user!;
    const doc = docOf(req.teamId!, id);
    if (!PAGE_ID.test(pageId) || !doc.content.pages.some((p) => p.id === pageId)) throw new HttpError(404, "페이지를 찾을 수 없어요.");
    const cur = repo.assignments(id).assignments[pageId];
    if (cur && cur.userId !== me.id) throw new HttpError(409, `${cur.name}님이 맡은 페이지예요.`, "assigned_page");
    repo.assignPage(id, pageId, me.id, me.id);
    repo.recordDocActivity(id, req.teamId!, me.id, pageId, [{ label: "페이지", action: "맡음" }]);
    collab.assignChanged(id);
    res.json(repo.assignments(id));
  });

  /** 맡기 해제 — 맡은 사람, 문서를 만든 사람, 팀 관리자 */
  r.delete("/documents/:id/pages/:pageId/assign", teamRole(repo, "editor"), (req, res) => {
    const id = String(req.params.id);
    const pageId = String(req.params.pageId);
    const me = req.user!;
    const doc = docOf(req.teamId!, id);
    const cur = repo.assignments(id).assignments[pageId];
    if (cur) {
      if (cur.userId !== me.id && doc.createdBy !== me.id && !hasRole(req.role, "admin")) {
        throw new HttpError(403, "맡은 사람, 문서를 만든 사람, 팀 관리자만 해제할 수 있어요.");
      }
      repo.unassignPage(id, pageId);
      repo.recordDocActivity(id, req.teamId!, me.id, pageId, [{ label: cur.userId === me.id ? "페이지 맡기" : `${cur.name}님 페이지 맡기`, action: "해제" }]);
      collab.assignChanged(id);
    }
    res.json(repo.assignments(id));
  });

  /** 담당자만 편집 — 문서를 만든 사람 · 팀 관리자 */
  r.put("/documents/:id/assign-strict", teamRole(repo, "editor"), (req, res) => {
    const id = String(req.params.id);
    const me = req.user!;
    const doc = docOf(req.teamId!, id);
    if (doc.createdBy !== me.id && !hasRole(req.role, "admin")) throw new HttpError(403, "문서를 만든 사람이나 팀 관리자만 바꿀 수 있어요.");
    const { strict } = z.object({ strict: z.boolean() }).parse(req.body);
    repo.setAssignStrict(id, strict);
    repo.recordDocActivity(id, req.teamId!, me.id, null, [{ label: "담당자만 편집", action: strict ? "켬" : "끔" }]);
    collab.assignChanged(id);
    res.json(repo.assignments(id));
  });

  // ─── 활동 기록 ──────────────────────────────────────────

  r.get("/documents/:id/activity", teamRole(repo, "viewer"), (req, res) => {
    const id = String(req.params.id);
    if (repo.docTeam(id) !== req.teamId) throw new HttpError(404, "문서를 찾을 수 없어요.");
    const before = req.query.before ? Number(req.query.before) : undefined;
    res.json(repo.docActivity(id, { before: Number.isFinite(before) ? before : undefined, limit: 300 }));
  });

  return r;
}

/**
 * 문서 id 만으로 열기 (뷰어 · 인쇄 · 편집기) — 문서가 속한 팀의 멤버인지 확인.
 * ?collab=1 (편집기): 공동 편집 방의 Yjs 상태(ystate)와 같은 시점의 내용 · 페이지 맡기를 함께 준다.
 */
export function documentLookupRouter(repo: Repo, collab: CollabHub): Router {
  const r = Router();
  r.get("/:id", (req, res) => {
    const user = requireUser(req);
    const id = String(req.params.id);
    const teamId = repo.docTeam(id);
    const role = teamId ? repo.getRole(teamId, user.id) : undefined;
    if (!teamId || !hasRole(role, "viewer")) throw new HttpError(404, "문서를 찾을 수 없어요.");
    const doc = repo.getDoc(teamId, id)!;
    if (req.query.collab === "1") {
      const snap = collab.snapshot(id)!;
      const out: CollabDoc = { ...doc, ...snap.content, role, ystate: toB64(snap.state), assign: snap.assign };
      res.json(out);
      return;
    }
    res.json({ ...doc, ...(collab.liveContent(id) ?? {}), role });
  });
  return r;
}
