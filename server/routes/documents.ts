// 문서: 목록·생성·저장(동시 편집 병합)·버전 기록·복원

import { Router } from "express";
import { z } from "zod";
import type { DocumentData } from "../../shared/types";
import { hasRole, requireUser, teamRole } from "../context";
import { publish } from "../events";
import type { Repo } from "../repo";
import { enforceLimit, HttpError } from "../security";

const MAX_DOC_BYTES = 8 * 1024 * 1024;

const DocBody = z
  .object({
    title: z.string().max(300),
    query: z.string().max(1000).optional(),
    settings: z.record(z.string(), z.unknown()),
    pages: z.array(z.record(z.string(), z.unknown())).max(500),
  })
  .passthrough();

function parseDoc(body: unknown): Pick<DocumentData, "title" | "query" | "settings" | "pages"> {
  if (JSON.stringify(body ?? {}).length > MAX_DOC_BYTES) throw new HttpError(413, "문서가 너무 큽니다.");
  const d = DocBody.parse(body) as unknown as DocumentData;
  // 이미지 주소에 javascript: 등 위험한 스킴이 들어오지 않게 한다
  for (const p of d.pages) {
    for (const e of p.elements ?? []) {
      if (e.type === "image" && e.src && !/^(https?:\/\/|\/samples\/)/i.test(e.src)) e.src = "";
      if (e.type === "image" && e.sourceUrl && !/^https?:\/\//i.test(e.sourceUrl)) e.sourceUrl = undefined;
    }
  }
  return { title: d.title, query: d.query, settings: d.settings, pages: d.pages };
}

export function documentsRouter(repo: Repo): Router {
  const r = Router({ mergeParams: true });

  r.get("/documents", teamRole(repo, "viewer"), (req, res) => {
    res.json(repo.listDocs(req.teamId!));
  });

  r.post("/documents", teamRole(repo, "editor"), (req, res) => {
    enforceLimit(`doc-create:${req.user!.id}`, 200, 60 * 60_000);
    const doc = repo.createDoc(req.teamId!, parseDoc(req.body) as DocumentData, req.user!.id);
    repo.log(req.teamId!, req.user!.id, "doc.create", `문서 '${doc.title}' 생성`, { type: "doc", id: doc.id });
    publish(req.teamId!, "docs", {}, req.user!.id);
    res.json(doc);
  });

  r.put("/documents/:id", teamRole(repo, "editor"), (req, res) => {
    const user = req.user!;
    enforceLimit(`doc-save:${user.id}`, 1200, 60 * 60_000);
    const baseVersion = z.number().int().min(1).parse(req.body?.baseVersion);
    const out = repo.saveDoc(req.teamId!, String(req.params.id), parseDoc(req.body?.doc), baseVersion, user.id);
    if (!out) throw new HttpError(404, "문서를 찾을 수 없습니다.");
    publish(req.teamId!, "doc", { docId: req.params.id, version: out.version, by: user.id, byName: user.name }, user.id);
    res.json(out);
  });

  r.post("/documents/:id/duplicate", teamRole(repo, "editor"), (req, res) => {
    const src = repo.getDoc(req.teamId!, String(req.params.id));
    if (!src) throw new HttpError(404, "문서를 찾을 수 없습니다.");
    const copy = repo.createDoc(req.teamId!, { ...src, title: src.title + " (사본)" }, req.user!.id);
    repo.log(req.teamId!, req.user!.id, "doc.duplicate", `문서 '${src.title}' 복제`, { type: "doc", id: copy.id });
    publish(req.teamId!, "docs", {}, req.user!.id);
    res.json(copy);
  });

  r.delete("/documents/:id", teamRole(repo, "editor"), (req, res) => {
    const doc = repo.getDoc(req.teamId!, String(req.params.id));
    if (!doc) throw new HttpError(404, "문서를 찾을 수 없습니다.");
    repo.deleteDoc(req.teamId!, doc.id);
    repo.log(req.teamId!, req.user!.id, "doc.delete", `문서 '${doc.title}' 삭제`);
    publish(req.teamId!, "docs", {}, req.user!.id);
    res.json({ ok: true });
  });

  r.get("/documents/:id/versions", teamRole(repo, "viewer"), (req, res) => {
    if (repo.docTeam(String(req.params.id)) !== req.teamId) throw new HttpError(404, "문서를 찾을 수 없습니다.");
    res.json(repo.listVersions(String(req.params.id)));
  });

  r.get("/documents/:id/versions/:version", teamRole(repo, "viewer"), (req, res) => {
    const doc = repo.getVersion(req.teamId!, String(req.params.id), Number(req.params.version));
    if (!doc) throw new HttpError(404, "버전을 찾을 수 없습니다.");
    res.json(doc);
  });

  r.post("/documents/:id/versions/:version/restore", teamRole(repo, "editor"), (req, res) => {
    const id = String(req.params.id);
    const old = repo.getVersion(req.teamId!, id, Number(req.params.version));
    const cur = repo.getDoc(req.teamId!, id);
    if (!old || !cur) throw new HttpError(404, "버전을 찾을 수 없습니다.");
    const out = repo.saveDoc(req.teamId!, id, old, cur.version!, req.user!.id)!;
    repo.log(req.teamId!, req.user!.id, "doc.restore", `문서 '${cur.title}'를 이전 버전(v${req.params.version})으로 복원`, { type: "doc", id });
    publish(req.teamId!, "doc", { docId: id, version: out.version, by: req.user!.id, byName: req.user!.name });
    res.json(repo.getDoc(req.teamId!, id));
  });

  return r;
}

/** 문서 id 만으로 열기 (뷰어·인쇄·편집기) — 문서가 속한 팀의 멤버인지 확인 */
export function documentLookupRouter(repo: Repo): Router {
  const r = Router();
  r.get("/:id", (req, res) => {
    const user = requireUser(req);
    const id = String(req.params.id);
    const teamId = repo.docTeam(id);
    const role = teamId ? repo.getRole(teamId, user.id) : undefined;
    if (!teamId || !hasRole(role, "viewer")) throw new HttpError(404, "문서를 찾을 수 없습니다.");
    res.json({ ...repo.getDoc(teamId, id), role });
  });
  return r;
}
