// 팀 라이브러리: 레퍼런스(중복 확인 포함)·케이스·태그, 백업

import { Router } from "express";
import { z } from "zod";
import type { DuplicateInfo, Reference } from "../../shared/types";
import { teamRole } from "../context";
import { publish } from "../events";
import type { Repo } from "../repo";
import { sampleData } from "../sample";
import { enforceLimit, HttpError } from "../security";

const tagList = z.array(z.string().trim().min(1).max(60)).max(50);

const RefInput = z.object({
  imageUrl: z.string().trim().min(1).max(4000),
  sourceUrl: z.string().max(4000).optional(),
  title: z.string().max(500).optional(),
  note: z.string().max(5000).optional(),
  tags: tagList.default([]),
  caseId: z.string().max(40).optional(),
  kind: z.enum(["image", "logo"]).default("image"),
  logoLabel: z.string().max(100).optional(),
  width: z.number().positive().max(100000).optional(),
  height: z.number().positive().max(100000).optional(),
  source: z.enum(["pinterest", "web", "image", "manual", "sample"]).default("manual"),
});

const RefPatch = RefInput.partial().extend({ caseId: z.string().max(40).nullable().optional() });

const CaseInput = z.object({
  name: z.string().trim().min(1).max(200),
  subtitle: z.string().max(300).optional(),
  highlight: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  tags: tagList.default([]),
});

/** 이미지 주소가 http(s) 또는 앱 내부 경로(/samples/…)인지 — javascript: 등 차단 */
function safeImageUrl(url: string) {
  if (/^https?:\/\//i.test(url) || /^\/samples\/[\w.-]+$/.test(url)) return url;
  throw new HttpError(400, "이미지 주소는 http(s) 링크여야 합니다.");
}

function mergeTags(a: string[], b: string[]) {
  const out = [...a];
  for (const t of b) if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

export function libraryRouter(repo: Repo): Router {
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
    repo.db.tx(() => {
      for (const input of list) {
        safeImageUrl(input.imageUrl);
        const existing = repo.findDuplicates(teamId, [input.imageUrl]).get(input.imageUrl);
        if (existing) {
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
    changed(teamId, user.id, "refs");
    res.json({ created, duplicates });
  });

  r.patch("/references/:id", teamRole(repo, "editor"), (req, res) => {
    const patch = RefPatch.parse(req.body);
    if (patch.imageUrl) safeImageUrl(patch.imageUrl);
    const ref = repo.updateRef(req.teamId!, String(req.params.id), patch, req.user!.id);
    if (!ref) throw new HttpError(404, "레퍼런스를 찾을 수 없습니다.");
    changed(req.teamId!, req.user!.id, "refs");
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
        const n = repo.deleteRefs(teamId, body.ids);
        repo.log(teamId, user.id, "ref.delete", `레퍼런스 ${n}개 삭제`);
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

  r.post("/cases", teamRole(repo, "editor"), (req, res) => {
    const c = repo.insertCase(req.teamId!, CaseInput.parse(req.body), req.user!.id);
    repo.log(req.teamId!, req.user!.id, "case.create", `케이스 '${c.name}' 생성`, { type: "case", id: c.id });
    changed(req.teamId!, req.user!.id, "cases");
    res.json(c);
  });

  r.patch("/cases/:id", teamRole(repo, "editor"), (req, res) => {
    const c = repo.updateCase(req.teamId!, String(req.params.id), CaseInput.partial().parse(req.body), req.user!.id);
    if (!c) throw new HttpError(404, "케이스를 찾을 수 없습니다.");
    changed(req.teamId!, req.user!.id, "cases");
    res.json(c);
  });

  r.delete("/cases/:id", teamRole(repo, "editor"), (req, res) => {
    const c = repo.getCase(req.teamId!, String(req.params.id));
    if (!c) throw new HttpError(404, "케이스를 찾을 수 없습니다.");
    repo.deleteCase(req.teamId!, c.id);
    repo.log(req.teamId!, req.user!.id, "case.delete", `케이스 '${c.name}' 삭제`);
    changed(req.teamId!, req.user!.id, "cases");
    res.json({ ok: true });
  });

  r.post("/sample", teamRole(repo, "editor"), (req, res) => {
    const teamId = req.teamId!;
    const sample = sampleData();
    const counts = repo.importData(teamId, req.user!.id, sample);
    changed(teamId, req.user!.id, "refs");
    res.json({ added: counts.references });
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
    const refs = z.array(RefInput.extend({ id: z.string().optional() }).passthrough()).parse(body.references.filter((x) => typeof x.imageUrl === "string"));
    for (const x of refs) safeImageUrl(x.imageUrl);
    const counts = repo.importData(req.teamId!, req.user!.id, { ...body, references: refs } as never);
    repo.log(req.teamId!, req.user!.id, "backup.import", `백업 가져오기: 레퍼런스 ${counts.references} · 케이스 ${counts.cases} · 문서 ${counts.documents}`);
    changed(req.teamId!, req.user!.id, "refs");
    res.json(counts);
  });

  return r;
}
