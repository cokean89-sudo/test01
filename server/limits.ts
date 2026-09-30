// 사용 한도 — 모든 확인은 여기 한 곳에서 한다.
//
//   · 요금제(PLANS): 지금은 '베타' 하나. 나중에 요금제별 한도가 생기면 PLANS 에 추가하고 planOf() 가
//     사용자 정보(예: users.plan)를 보고 고르게만 바꾸면 된다.
//   · 사용자별 조정(user_limits): 관리자가 특정 사용자의 한도를 올리거나 내린 값 — 요금제 기본값 위에 덮어쓴다.
//   · 관리자(서비스 운영자)는 개인 한도(AI 글쓰기 · 태그 제안 · 개인 저장 공간)에서 빠진다.
//     서비스를 지키는 한도(전체 저장 공간 · 월 AI 예산)는 모두에게 적용된다.
//   · 모든 값은 환경변수로 바꿀 수 있고, 요청마다 읽는다 (재시작 없이 테스트 · 조정 가능).

import type { LimitOverrides, MyUsage, UsageLimits } from "../shared/types";
import { withObject } from "../shared/usage";
import { ADMIN_EMAILS, teamStorageLimit } from "./config";
import { sendBudgetAlertMail } from "./mail";
import type { TokenUsage } from "./pricing";
import { isAdminUser, type Repo, type UserRow } from "./repo";
import { HttpError } from "./security";
import { aiCount, monthCost, monthKey, nextMonthStart, recordUsage, totalStorageBytes, userStorageBytes, type AiKind } from "./usage";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

/** 환경변수 숫자 — 비었거나 잘못된 값이면 기본값 */
function num(raw: string | undefined, def: number): number {
  if (raw === undefined || raw.trim() === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

// ─── 요금제 ────────────────────────────────────────────────

export const PLANS = {
  beta: {
    label: "베타 기간 사용 한도",
    limits: (): UsageLimits => ({
      aiWriteMonthly: num(process.env.AI_WRITE_MONTHLY, 50),
      aiWriteDaily: num(process.env.AI_WRITE_DAILY, 15),
      aiTagMonthly: num(process.env.AI_TAG_MONTHLY, 300),
      aiTagDaily: num(process.env.AI_TAG_DAILY, 80),
      userStorageBytes: num(process.env.USER_STORAGE_LIMIT_MB, 500) * MB,
    }),
  },
} as const;
export type PlanKey = keyof typeof PLANS;

/** 사용자의 요금제 — 지금은 모두 베타 */
export function planOf(_user: UserRow): PlanKey {
  return "beta";
}

/** 서비스 전체 한도 */
export function serviceLimits() {
  return {
    teamStorageBytes: teamStorageLimit(),
    totalStorageBytes: num(process.env.TOTAL_STORAGE_LIMIT_GB, 8) * GB,
    aiBudgetUsd: num(process.env.AI_MONTHLY_BUDGET_USD, 20),
  };
}

// ─── 사용자별 조정 ─────────────────────────────────────────

const OVERRIDE_KEYS = ["aiWriteMonthly", "aiWriteDaily", "aiTagMonthly", "aiTagDaily", "userStorageMb"] as const;

export function getOverrides(repo: Repo, userId: string): LimitOverrides | null {
  const r = repo.db.get<{ overrides_json: string }>("SELECT overrides_json FROM user_limits WHERE user_id = ?", userId);
  if (!r) return null;
  try {
    return JSON.parse(r.overrides_json) as LimitOverrides;
  } catch {
    return null;
  }
}

/** null 인 값은 요금제 기본값으로 되돌린다. 모두 비면 조정 기록을 지운다 */
export function setOverrides(repo: Repo, userId: string, patch: Partial<Record<keyof LimitOverrides, number | null>>, byUserId: string): LimitOverrides | null {
  const next: LimitOverrides = { ...(getOverrides(repo, userId) ?? {}) };
  for (const k of OVERRIDE_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === undefined) delete next[k];
    else next[k] = Math.max(0, Math.round(v));
  }
  if (!Object.keys(next).length) {
    repo.db.run("DELETE FROM user_limits WHERE user_id = ?", userId);
    return null;
  }
  repo.db.run(
    "INSERT INTO user_limits (user_id, overrides_json, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET overrides_json = excluded.overrides_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
    userId,
    JSON.stringify(next),
    byUserId,
    Date.now(),
  );
  return next;
}

/** 이 사용자에게 적용되는 한도 (요금제 + 조정). exempt = 관리자 */
export function limitsFor(repo: Repo, user: UserRow): { plan: PlanKey; label: string; exempt: boolean; limits: UsageLimits; overrides: LimitOverrides | null } {
  const plan = planOf(user);
  const base = PLANS[plan].limits();
  const o = getOverrides(repo, user.id);
  const limits: UsageLimits = {
    aiWriteMonthly: o?.aiWriteMonthly ?? base.aiWriteMonthly,
    aiWriteDaily: o?.aiWriteDaily ?? base.aiWriteDaily,
    aiTagMonthly: o?.aiTagMonthly ?? base.aiTagMonthly,
    aiTagDaily: o?.aiTagDaily ?? base.aiTagDaily,
    userStorageBytes: o?.userStorageMb !== undefined ? o.userStorageMb * MB : base.userStorageBytes,
  };
  return { plan, label: PLANS[plan].label, exempt: isAdminUser(user), limits, overrides: o };
}

// ─── AI ────────────────────────────────────────────────────

const AI_LABEL: Record<AiKind, string> = { write: "AI 글쓰기", tag: "AI 태그 제안", other: "AI 기능" };


/** 이번 달 서비스 AI 예산 */
export function aiBudget(repo: Repo, t = Date.now()) {
  const spent = monthCost(repo.db, monthKey(t));
  const budget = serviceLimits().aiBudgetUsd;
  const resume = nextMonthStart(t);
  return {
    spent,
    budget,
    paused: spent >= budget,
    reason: `이번 달 AI 사용량이 서비스 예산에 도달해서 AI 기능을 잠시 쉬어요. ${resume.label}에 다시 켜져요.`,
  };
}

/** AI 를 부르기 전에: 개인 하루 · 월 한도 (예산은 aiBudget 으로 따로 본다) */
export function assertAiAllowed(repo: Repo, user: UserRow, kind: AiKind, t = Date.now()) {
  const { exempt, limits } = limitsFor(repo, user);
  if (exempt || kind === "other") return;
  const monthly = kind === "write" ? limits.aiWriteMonthly : limits.aiTagMonthly;
  const daily = kind === "write" ? limits.aiWriteDaily : limits.aiTagDaily;
  const label = AI_LABEL[kind];
  if (aiCount(repo.db, user.id, kind, "month", t) >= monthly) {
    throw new HttpError(429, `이번 달 ${withObject(label)} 모두 사용했어요 (월 ${monthly}회). ${nextMonthStart(t).label}에 다시 채워져요. 더 필요하면 '내 계정 → 이번 달 사용량'에서 한도를 요청해 주세요.`, `limit_ai_${kind}_month`);
  }
  if (aiCount(repo.db, user.id, kind, "day", t) >= daily) {
    throw new HttpError(429, `오늘 ${withObject(label)} 모두 사용했어요 (하루 ${daily}회). 내일 다시 쓸 수 있어요.`, `limit_ai_${kind}_day`);
  }
}

/**
 * AI 를 부르기 전에: 이번 달 예산을 봐서 쉬는 중이면 그대로 알려 준다.
 * 예산에 처음 닿은 걸 알게 된 순간(호출 기록 뒤 또는 관리자가 예산을 낮춘 뒤 첫 요청) 관리자에게 한 달에 한 번 메일을 보낸다.
 */
export function checkAiBudget(repo: Repo, t = Date.now()) {
  const b = aiBudget(repo, t);
  const month = monthKey(t);
  const flag = `ai_budget_alert:${month}`;
  if (b.paused && !repo.db.getMeta(flag)) {
    repo.db.setMeta(flag, String(Date.now()));
    for (const to of ADMIN_EMAILS) {
      void sendBudgetAlertMail(to, { month, spentUsd: b.spent, budgetUsd: b.budget, resumes: nextMonthStart(t).label }).catch((err) =>
        console.error("예산 알림 메일 실패", (err as Error).message),
      );
    }
  }
  return b;
}

/** AI 를 부른 뒤: 토큰 · 예상 비용 기록, 예산을 넘으면 관리자에게 한 번 알린다 */
export function recordAiUsage(repo: Repo, user: UserRow, teamId: string | null, kind: AiKind, model: string, tokens: TokenUsage) {
  recordUsage(repo.db, { userId: user.id, teamId, kind: "ai", detail: kind, model, tokens });
  checkAiBudget(repo);
}

// ─── 저장 공간 ─────────────────────────────────────────────

const gb = (n: number) => `${(n / GB).toFixed(1).replace(/\.0$/, "")}GB`;
const mb = (n: number) => (n >= GB ? gb(n) : `${Math.round(n / MB)}MB`);

/** 새 파일을 저장하기 전에: 팀 → 개인 → 서비스 전체 */
export function assertStorageAllowed(repo: Repo, user: UserRow, teamId: string, addBytes: number) {
  const svc = serviceLimits();
  if (repo.storageUsage(teamId).used + addBytes > svc.teamStorageBytes) {
    throw new HttpError(413, `팀 저장 공간(${gb(svc.teamStorageBytes)})이 가득 찼어요. 쓰지 않는 레퍼런스를 지우면 공간이 생겨요.`, "storage_full");
  }
  const { exempt, limits } = limitsFor(repo, user);
  if (!exempt && userStorageBytes(repo.db, user.id) + addBytes > limits.userStorageBytes) {
    throw new HttpError(
      413,
      `내 저장 공간(${mb(limits.userStorageBytes)})을 모두 사용했어요. 내가 올린 레퍼런스 중 쓰지 않는 것을 지우거나, '내 계정 → 이번 달 사용량'에서 한도를 요청해 주세요.`,
      "user_storage_full",
    );
  }
  if (totalStorageBytes(repo.db) + addBytes > svc.totalStorageBytes) {
    throw new HttpError(507, "서비스 전체 저장 공간이 가득 찼어요. 관리자에게 알려 주세요.", "total_storage_full");
  }
}

/** 파일을 받기 전에 이미 꽉 찼는지만 본다 (큰 요청을 끝까지 읽지 않게) */
export function assertStorageNotFull(repo: Repo, user: UserRow, teamId: string) {
  assertStorageAllowed(repo, user, teamId, 1);
}

// ─── 내 계정 ───────────────────────────────────────────────

export function myUsage(repo: Repo, user: UserRow, t = Date.now()): MyUsage {
  const { label, exempt, limits } = limitsFor(repo, user);
  const lim = (v: number) => (exempt ? null : v);
  return {
    planLabel: label,
    exempt,
    month: monthKey(t),
    resetDate: nextMonthStart(t).date,
    aiPaused: aiBudget(repo, t).paused,
    meters: [
      {
        key: "aiWrite",
        label: "AI 글쓰기",
        used: aiCount(repo.db, user.id, "write", "month", t),
        limit: lim(limits.aiWriteMonthly),
        daily: { used: aiCount(repo.db, user.id, "write", "day", t), limit: lim(limits.aiWriteDaily) },
      },
      {
        key: "aiTag",
        label: "AI 태그 제안",
        used: aiCount(repo.db, user.id, "tag", "month", t),
        limit: lim(limits.aiTagMonthly),
        daily: { used: aiCount(repo.db, user.id, "tag", "day", t), limit: lim(limits.aiTagDaily) },
      },
      { key: "storage", label: "저장 공간", used: userStorageBytes(repo.db, user.id), limit: lim(limits.userStorageBytes) },
    ],
  };
}
