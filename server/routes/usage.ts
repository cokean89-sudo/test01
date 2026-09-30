// 사용량 — 내 사용량 · 내보내기 기록 · 관리자 대시보드 · 사용자별 한도 조정
//
//   GET  /usage/me                  이번 달 내 사용량 (내 계정 화면)
//   POST /usage/export              내보내기 한 번 기록 { kind: pdf|pptx|html|json, docId }
//   GET  /admin/usage?month=YYYY-MM 사용자별 · 팀별 월간 사용량, 기능별 비율, 모델별 비용, 예산
//   PUT  /admin/users/:id/limits    특정 사용자의 한도 조정 (null = 기본값으로)

import { Router, type Request } from "express";
import { z } from "zod";
import { hasRole, requireUser } from "../context";
import { aiBudget, limitsFor, myUsage, PLANS, serviceLimits, setOverrides } from "../limits";
import { isAdminUser, type Repo } from "../repo";
import { enforceLimit, HttpError } from "../security";
import { monthKey, recordUsage, usageDashboard } from "../usage";

function requireAdmin(req: Request) {
  const user = requireUser(req);
  if (!isAdminUser(user)) throw new HttpError(403, "관리자만 볼 수 있어요.", "forbidden");
  return user;
}

export function usageRouter(repo: Repo): Router {
  const r = Router();

  r.get("/me", (req, res) => {
    res.json(myUsage(repo, requireUser(req)));
  });

  r.post("/export", (req, res) => {
    const user = requireUser(req);
    enforceLimit(`export:${user.id}`, 300, 60 * 60_000);
    const { kind, docId } = z.object({ kind: z.enum(["pdf", "pptx", "html", "json"]), docId: z.string().max(40) }).parse(req.body);
    const teamId = repo.docTeam(docId);
    // 볼 수 있는 문서만 기록 (다른 팀 문서 id 로 기록을 늘리지 못하게)
    if (!teamId || !hasRole(repo.getRole(teamId, user.id), "viewer")) throw new HttpError(404, "문서를 찾을 수 없어요.", "not_found");
    recordUsage(repo.db, { userId: user.id, teamId, kind: "export", detail: kind });
    res.json({ ok: true });
  });

  return r;
}

const LimitPatch = z
  .object({
    aiWriteMonthly: z.number().int().min(0).max(100000).nullable(),
    aiWriteDaily: z.number().int().min(0).max(10000).nullable(),
    aiTagMonthly: z.number().int().min(0).max(100000).nullable(),
    aiTagDaily: z.number().int().min(0).max(10000).nullable(),
    userStorageMb: z.number().int().min(0).max(1_000_000).nullable(),
  })
  .partial();

export function usageAdminRouter(repo: Repo): Router {
  const r = Router();

  r.get("/usage", (req, res) => {
    requireAdmin(req);
    const month = z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .default(monthKey())
      .parse(req.query.month ?? undefined);
    const svc = serviceLimits();
    const budget = aiBudget(repo);
    res.json(
      usageDashboard(repo.db, month, {
        budgetUsd: svc.aiBudgetUsd,
        paused: month === monthKey() && budget.paused,
        storageLimit: svc.totalStorageBytes,
        teamStorageLimit: svc.teamStorageBytes,
        defaults: PLANS.beta.limits(),
        limitsOf: (id) => {
          const u = repo.getUser(id)!;
          const l = limitsFor(repo, u);
          return { limits: l.limits, overrides: l.overrides, isAdmin: l.exempt };
        },
      }),
    );
  });

  r.put("/users/:id/limits", (req, res) => {
    const admin = requireAdmin(req);
    const target = repo.getUser(String(req.params.id));
    if (!target) throw new HttpError(404, "사용자를 찾을 수 없어요.", "not_found");
    const patch = LimitPatch.parse(req.body ?? {});
    const overrides = setOverrides(repo, target.id, patch, admin.id);
    repo.security("limits_changed", admin.id, req.ip, `${target.email ?? target.id}: ${JSON.stringify(overrides ?? "기본값")}`);
    res.json({ overrides, limits: limitsFor(repo, target).limits });
  });

  return r;
}
