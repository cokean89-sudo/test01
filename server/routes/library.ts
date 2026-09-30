// 팀 라이브러리: 레퍼런스(중복 확인 포함)·케이스·태그, 백업

import { Router } from "express";
import { z } from "zod";
import { fileIdOf, fileUrl } from "../../shared/files";
import type { DuplicateInfo, Reference } from "../../shared/types";
import { teamRole } from "../context";
import { publish } from "../events";
import type { Repo } from "../repo";
import { enforceLimit, HttpError } from "../security";
import type { FileStore } from "../storage";
import { removeKeys } from "./uploads";

const tagList = z.array(z.string().trim().min(1).max(60)).max(50);

// 수정(PATCH)용 스키마는 기본값 없이 만든다 — Zod 4 의 .partial() 은 .default() 를 그대로 적용해서,
// { width, height } 만 보내도 tags·kind·source 가 기본값으로 덮어써진다.
const RefFields = z.object({
  imageUrl: z.string().trim().min(1).max(4000),
  sourceUrl: z.string().max(4000).optional(),
  title: z.string().max(500).optional(),
  note: z.string().max(5000).optional(),
  tags: tagList,
  caseId: z.string().max(40).optional(),
  kind: z.enum(["image", "logo"]),
  logoLabel: z.string().max(100).optional(),
  width: z.number().positive().max(100000).optional(),
  height: z.number().positive().max(100000).optional(),
  source: z.enum(["pinterest", "web", "image", "manual", "sample", "upload"]),
  /** 링크를 사본으로 저장했을 때 원래 링크 */
  originalUrl: z.string().max(4000).optional(),
});

const RefInput = RefFields.extend({
  tags: tagList.default([]),
  kind: RefFields.shape.kind.default("image"),
  source: RefFields.shape.source.default("manual"),
});

const RefPatch = RefFields.partial().extend({ caseId: z.string().max(40).nullable().optional() });

const CaseFields = z.object({
  name: z.string().trim().min(1).max(200),
  subtitle: z.string().max(300).optional(),
  highlight: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  tags: tagList,
});

const CaseInput = CaseFields.extend({ tags: tagList.default([]) });
const CasePatch = CaseFields.partial();

/**
 * 이미지 주소 확인 — http(s) 링크, 앱 샘플(/samples/…), 이 팀이 저장한 파일(/api/files/…)만. javascript: 등 차단.
 * 저장한 파일이면 파일 id · 원래 링크를 함께 돌려준다 (다른 팀 파일은 거부).
 */
function resolveImage(repo: Repo, teamId: string, imageUrl: string, originalUrl?: string): { imageUrl: string; fileId?: string; originalUrl?: string } {
  const fid = fileIdOf(imageUrl);
  if (fid) {
    const f = repo.getFile(fid);
    if (!f || f.team_id !== teamId) throw new HttpError(400, "이 팀에 없는 이미지 파일이에요.");
    const orig = originalUrl && /^https?:\/\//i.test(originalUrl) ? originalUrl : (f.original_url ?? undefined);
    return { imageUrl: fileUrl(fid), fileId: fid, originalUrl: orig };
  }
  if (/^https?:\/\//i.test(imageUrl) || /^\/samples\/[\w.-]+$/.test(imageUrl)) return { imageUrl, fileId: undefined, originalUrl: undefined };
  throw new HttpError(400, "이미지 주소는 http(s) 링크여야 해요.");
}

function mergeTags(a: string[], b: string[]) {
  const out = [...a];
  for (const t of b) if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

export function libraryRouter(repo: Repo, store: FileStore): Router {
  const r = Router({ mergeParams: true });
  const changed = (teamId: string, userId: string, kind: string) => publish(teamId, "library", { kind }, userId);

  r.get("/library", teamRole(repo, "viewer"), (req, res) => {
    res.json({ references: repo.listRefs(req.teamId!), cases: repo.listCases(req.teamId!) });
  });

  /** 저장 전에 중복 이미지 확인 — 누가 언제 추가했는지 함께 돌려준다 */
  r.post("/references/check", teamRole(repo, "viewer"), (req, res) => {
    const { urls } = z.object({ urls: z.array(z.string().max(4000)).max(500) }).parse(req.body);
    const dups = repo.findDuplicates(req.teamId!, urls);
    const out: DuplicateInfo[] = [...dups.entries()].map(([imageUrl, existing]) => ({ imageUrl, existing }));
    res.json(out);
  });

  r.post("/references", teamRole(repo, "editor"), (req, res) => {
    const teamId = req.teamId!;
    const user = req.user!;
    enforceLimit(`refs-add:${user.id}`, 2000, 60 * 60_000);
    const list = z.array(RefInput).max(500).parse(Array.isArray(req.body) ? req.body : [req.body]);
    const created: Reference[] = [];
    const duplicates: DuplicateInfo[] = [];
    const unused: string[] = [];
    repo.db.tx(() => {
      for (const raw of list) {
        const input = { ...raw, ...resolveImage(repo, teamId, raw.imageUrl, raw.originalUrl) };
        const dups = repo.findDuplicates(teamId, [input.imageUrl, input.originalUrl].filter((u): u is string => !!u));
        const existing = dups.get(input.imageUrl) ?? (input.originalUrl ? dups.get(input.originalUrl) : undefined);
        if (existing) {
          // 이미 있는 이미지면 방금 올린 사본은 쓰지 않는다
          if (input.fileId && input.fileId !== existing.fileId) unused.push(input.fileId);
          // 중복은 새로 만들지 않고, 새 태그만 기존 항목에 더한다
          const tags = mergeTags(existing.tags, input.tags);
          const updated = tags.length !== existing.tags.length ? repo.updateRef(teamId, existing.id, { tags }, user.id)! : existing;
          duplicates.push({ imageUrl: input.imageUrl, existing: { ...updated, createdByName: existing.createdByName, createdAt: existing.createdAt } });
          continue;
        }
        created.push(repo.insertRef(teamId, input, user.id));
      }
      if (created.length) repo.log(teamId, user.id, "ref.add", `레퍼런스 ${created.length}개 추가${duplicates.length ? ` (중복 ${duplicates.length}개)` : ""}`);
    });
    removeKeys(store, repo.releaseFiles(unused));
    changed(teamId, user.id, "refs");
    res.json({ created, duplicates });
  });

  r.patch("/references/:id", teamRole(repo, "editor"), (req, res) => {
    const teamId = req.teamId!;
    const { originalUrl, ...patch } = RefPatch.parse(req.body);
    const before = repo.getRef(teamId, String(req.params.id));
    if (!before) throw new HttpError(404, "레퍼런스를 찾을 수 없어요.");
    // 이미지를 바꾸면 파일 연결도 새 주소 기준으로 (예전 파일은 더 쓰는 곳이 없으면 지운다)
    const next = patch.imageUrl && patch.imageUrl !== before.imageUrl ? { ...patch, ...resolveImage(repo, teamId, patch.imageUrl, originalUrl) } : patch;
    const ref = repo.updateRef(teamId, before.id, next, req.user!.id)!;
    if (before.fileId && before.fileId !== ref.fileId) removeKeys(store, repo.releaseFiles([before.fileId]));
    changed(teamId, req.user!.id, "refs");
    res.json(ref);
  });

  r.post("/references/bulk", teamRole(repo, "editor"), (req, res) => {
    const teamId = req.teamId!;
    const user = req.user!;
    const body = z
      .object({
        ids: z.array(z.string().max(40)).max(2000),
        addTags: tagList.optional(),
        removeTags: tagList.optional(),
        caseId: z.string().max(40).nullable().optional(),
        kind: z.enum(["image", "logo"]).optional(),
        delete: z.boolean().optional(),
      })
      .parse(req.body);
    repo.db.tx(() => {
      if (body.delete) {
        // 올린 이미지 · 사본은 레퍼런스와 함께 지운다
        const { count, fileIds } = repo.deleteRefs(teamId, body.ids);
        const keys = repo.releaseFiles(fileIds);
        removeKeys(store, keys);
        repo.log(teamId, user.id, "ref.delete", `레퍼런스 ${count}개 삭제${keys.length ? ` (저장한 이미지 ${keys.length / 2}개 포함)` : ""}`);
        return;
      }
      const remove = new Set((body.removeTags ?? []).map((t) => t.toLowerCase()));
      for (const id of body.ids) {
        const cur = repo.getRef(teamId, id);
        if (!cur) continue;
        let tags = cur.tags;
        if (body.addTags) tags = mergeTags(tags, body.addTags);
        if (remove.size) tags = tags.filter((t) => !remove.has(t.toLowerCase()));
        repo.updateRef(teamId, id, { tags, ...(body.caseId !== undefined ? { caseId: body.caseId } : {}), ...(body.kind ? { kind: body.kind } : {}) }, user.id);
      }
      if (body.addTags?.length) repo.log(teamId, user.id, "ref.tag", `${body.ids.length}개에 태그 추가: ${body.addTags.join(", ")}`);
    });
    changed(teamId, user.id, "refs");
    res.json({ references: repo.listRefs(teamId) });
  });

  r.post("/tags/rename", teamRole(repo, "editor"), (req, res) => {
    const { from, to } = z.object({ from: z.string().min(1).max(60), to: z.string().trim().max(60) }).parse(req.body);
    repo.renameTag(req.teamId!, from, to, req.user!.id);
    repo.log(req.teamId!, req.user!.id, "tag.rename", to ? `태그 '${from}' → '${to}'` : `태그 '${from}' 삭제`);
    changed(req.teamId!, req.user!.id, "refs");
    res.json({ references: repo.listRefs(req.teamId!), cases: repo.listCases(req.teamId!) });
  });

  // 동의어 병합: 여러 태그 → 하나
  r.post("/tags/merge", teamRole(repo, "editor"), (req, res) => {
    const { from, to } = z.object({ from: z.array(z.string().min(1).max(60)).min(1).max(100), to: z.string().trim().min(1).max(60) }).parse(req.body);
    repo.mergeTags(req.teamId!, from, to, req.user!.id);
    repo.log(req.teamId!, req.user!.id, "tag.merge", `태그 ${from.map((f) => `'${f}'`).join(", ")} → '${to}' 병합`);
    changed(req.teamId!, req.user!.id, "refs");
    res.json({ references: repo.listRefs(req.teamId!), cases: repo.listCases(req.teamId!) });
  });

  r.post("/tags/delete", teamRole(repo, "editor"), (req, res) => {
    const { tags } = z.object({ tags: z.array(z.string().min(1).max(60)).min(1).max(200) }).parse(req.body);
    repo.mergeTags(req.teamId!, tags, "", req.user!.id);
    repo.log(req.teamId!, req.user!.id, "tag.delete", `태그 ${tags.length}개 삭제: ${tags.slice(0, 10).join(", ")}${tags.length > 10 ? " …" : ""}`);
    changed(req.teamId!, req.user!.id, "refs");
    res.json({ references: repo.listRefs(req.teamId!), cases: repo.listCases(req.teamId!) });
  });

  r.post("/cases", teamRole(repo, "editor"), (req, res) => {
    const c = repo.insertCase(req.teamId!, CaseInput.parse(req.body), req.user!.id);
    repo.log(req.teamId!, req.user!.id, "case.create", `케이스 '${c.name}' 생성`, { type: "case", id: c.id });
    changed(req.teamId!, req.user!.id, "cases");
    res.json(c);
  });

  r.patch("/cases/:id", teamRole(repo, "editor"), (req, res) => {
    const c = repo.updateCase(req.teamId!, String(req.params.id), CasePatch.parse(req.body), req.user!.id);
    if (!c) throw new HttpError(404, "케이스를 찾을 수 없어요.");
    changed(req.teamId!, req.user!.id, "cases");
    res.json(c);
  });

  r.delete("/cases/:id", teamRole(repo, "editor"), (req, res) => {
    const c = repo.getCase(req.teamId!, String(req.params.id));
    if (!c) throw new HttpError(404, "케이스를 찾을 수 없어요.");
    repo.deleteCase(req.teamId!, c.id);
    repo.log(req.teamId!, req.user!.id, "case.delete", `케이스 '${c.name}' 삭제`);
    changed(req.teamId!, req.user!.id, "cases");
    res.json({ ok: true });
  });

  r.get("/backup", teamRole(repo, "admin"), (req, res) => {
    const teamId = req.teamId!;
    const team = repo.getTeam(teamId)!;
    const documents = repo.listDocs(teamId).map((d) => repo.getDoc(teamId, d.id));
    repo.security("backup_export", req.user!.id, req.ip, teamId);
    res.set("content-disposition", `attachment; filename="refboard-${encodeURIComponent(team.name)}-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ version: 2, team: team.name, references: repo.listRefs(teamId), cases: repo.listCases(teamId), documents });
  });

  r.post("/backup", teamRole(repo, "admin"), (req, res) => {
    const body = z
      .object({
        references: z.array(z.record(z.string(), z.unknown())).max(20000).default([]),
        cases: z.array(z.record(z.string(), z.unknown())).max(5000).default([]),
        documents: z.array(z.record(z.string(), z.unknown())).max(2000).default([]),
      })
      .parse(req.body?.data ?? req.body);
    const parsed = z.array(RefInput.extend({ id: z.string().optional() }).passthrough()).parse(body.references.filter((x) => typeof x.imageUrl === "string"));
    // 저장한 이미지는 이 팀 파일일 때만 (다른 팀 백업의 업로드 이미지는 파일이 없어서 건너뛴다)
    let skipped = 0;
    const refs = parsed.flatMap((x) => {
      try {
        const { fileId: _f, thumbUrl: _t, ...rest } = x as typeof x & { fileId?: string; thumbUrl?: string };
        return [{ ...rest, ...resolveImage(repo, req.teamId!, x.imageUrl, x.originalUrl) }];
      } catch {
        skipped++;
        return [];
      }
    });
    const counts = repo.importData(req.teamId!, req.user!.id, { ...body, references: refs } as never);
    repo.log(
      req.teamId!,
      req.user!.id,
      "backup.import",
      `백업 가져오기: 레퍼런스 ${counts.references} · 케이스 ${counts.cases} · 문서 ${counts.documents}${skipped ? ` (이 팀에 파일이 없는 업로드 이미지 ${skipped}개 제외)` : ""}`,
    );
    changed(req.teamId!, req.user!.id, "refs");
    res.json({ ...counts, skipped });
  });

  return r;
}
