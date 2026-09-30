// 사용량 기록 · 집계 — 횟수와 수치만 남긴다 (글 · 이미지 내용은 저장하지 않음).
// 월 · 일은 한국 시간(UTC+9, 서머타임 없음) 기준 → 매월 1일 0시(KST)에 월간 사용량이 새로 시작된다.

import type { UsageDashboard, UsageTeamRow, UsageUserRow } from "../shared/types";
import type { Database } from "./db";
import { costUsd, type TokenUsage } from "./pricing";

export type UsageKind = "ai" | "upload" | "doc" | "export";
export type AiKind = "write" | "tag" | "other";
export type ExportKind = "pdf" | "pptx" | "html" | "json";

const KST = 9 * 60 * 60 * 1000;

/** 한국 시간 YYYY-MM */
export const monthKey = (t = Date.now()) => new Date(t + KST).toISOString().slice(0, 7);
/** 한국 시간 YYYY-MM-DD */
export const dayKey = (t = Date.now()) => new Date(t + KST).toISOString().slice(0, 10);

/** 다음 달 1일 0시(한국 시간) — 월간 사용량이 다시 채워지는 때 */
export function nextMonthStart(t = Date.now()): { date: string; ts: number; label: string } {
  const k = new Date(t + KST);
  const y = k.getUTCFullYear();
  const m = k.getUTCMonth() + 1; // 다음 달 (0 기준 +1)
  const ts = Date.UTC(y, m, 1) - KST;
  const d = new Date(ts + KST);
  return { date: d.toISOString().slice(0, 10), ts, label: `${d.getUTCMonth() + 1}월 1일` };
}

export interface UsageEvent {
  userId: string | null;
  teamId?: string | null;
  kind: UsageKind;
  detail: string;
  model?: string;
  tokens?: TokenUsage;
  bytes?: number;
  at?: number;
}

/** 기록하고, AI 면 예상 비용(USD)을 돌려준다 */
export function recordUsage(db: Database, e: UsageEvent): number {
  const at = e.at ?? Date.now();
  const cost = e.model && e.tokens ? costUsd(e.model, e.tokens) : 0;
  db.run(
    `INSERT INTO usage_events (user_id, team_id, kind, detail, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, bytes, month, day, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.userId,
    e.teamId ?? null,
    e.kind,
    e.detail,
    e.model ?? null,
    e.tokens?.input ?? 0,
    e.tokens?.output ?? 0,
    (e.tokens?.cacheWrite5m ?? 0) + (e.tokens?.cacheWrite1h ?? 0),
    e.tokens?.cacheRead ?? 0,
    cost,
    e.bytes ?? 0,
    monthKey(at),
    dayKey(at),
    at,
  );
  return cost;
}

/** 한 사용자의 AI 호출 수 — 이번 달 또는 오늘 */
export function aiCount(db: Database, userId: string, kind: AiKind, period: "month" | "day", t = Date.now()): number {
  const col = period === "month" ? "month" : "day";
  const key = period === "month" ? monthKey(t) : dayKey(t);
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM usage_events WHERE user_id = ? AND kind = 'ai' AND detail = ? AND ${col} = ?`, userId, kind, key)?.n ?? 0;
}

/** 서비스 전체 이번 달 AI 예상 비용 */
export function monthCost(db: Database, month = monthKey()): number {
  return db.get<{ c: number | null }>("SELECT SUM(cost_usd) AS c FROM usage_events WHERE month = ? AND kind = 'ai'", month)?.c ?? 0;
}

/** 올린 사람 기준 저장 용량 (지금 남아 있는 파일) */
export function userStorageBytes(db: Database, userId: string): number {
  return db.get<{ b: number | null }>("SELECT SUM(bytes) AS b FROM files WHERE created_by = ?", userId)?.b ?? 0;
}

export function totalStorageBytes(db: Database): number {
  return db.get<{ b: number | null }>("SELECT SUM(bytes) AS b FROM files")?.b ?? 0;
}

// ─── 관리자 대시보드 ─────────────────────────────────────────

const FEATURES: { key: string; label: string; kind: UsageKind; detail?: string }[] = [
  { key: "ai.write", label: "AI 글쓰기", kind: "ai", detail: "write" },
  { key: "ai.tag", label: "AI 태그 제안", kind: "ai", detail: "tag" },
  { key: "ai.other", label: "AI 기타", kind: "ai", detail: "other" },
  { key: "upload", label: "이미지 올리기 · 사본", kind: "upload" },
  { key: "export", label: "내보내기", kind: "export" },
  { key: "doc", label: "문서 만들기", kind: "doc" },
];

type Agg = { id: string | null; kind: string; detail: string; n: number; input: number; output: number; cost: number; bytes: number };

export function usageDashboard(
  db: Database,
  month: string,
  opts: { budgetUsd: number; paused: boolean; storageLimit: number; teamStorageLimit: number; limitsOf: (userId: string) => { limits: UsageUserRow["limits"]; overrides: UsageUserRow["overrides"]; isAdmin: boolean }; defaults: UsageDashboard["defaults"] },
): UsageDashboard {
  const byUser = db.all<Agg>(
    `SELECT user_id AS id, kind, detail, COUNT(*) AS n, SUM(input_tokens + cache_write_tokens + cache_read_tokens) AS input, SUM(output_tokens) AS output, SUM(cost_usd) AS cost, SUM(bytes) AS bytes
      FROM usage_events WHERE month = ? GROUP BY user_id, kind, detail`,
    month,
  );
  const byTeam = db.all<Agg>(
    `SELECT team_id AS id, kind, detail, COUNT(*) AS n, 0 AS input, 0 AS output, SUM(cost_usd) AS cost, SUM(bytes) AS bytes
      FROM usage_events WHERE month = ? AND team_id IS NOT NULL GROUP BY team_id, kind, detail`,
    month,
  );
  const storageByUser = new Map(db.all<{ id: string; b: number }>("SELECT created_by AS id, SUM(bytes) AS b FROM files WHERE created_by IS NOT NULL GROUP BY created_by").map((r) => [r.id, r.b]));
  const storageByTeam = new Map(db.all<{ id: string; b: number }>("SELECT team_id AS id, SUM(bytes) AS b FROM files GROUP BY team_id").map((r) => [r.id, r.b]));
  const overrideUsers = db.all<{ id: string }>("SELECT user_id AS id FROM user_limits").map((r) => r.id);

  // ── 사용자별
  const userIds = new Set<string>([...byUser.map((r) => r.id).filter((x): x is string => !!x), ...storageByUser.keys(), ...overrideUsers]);
  const users: UsageUserRow[] = [];
  for (const id of userIds) {
    const u = db.get<{ name: string; email: string | null }>("SELECT name, email FROM users WHERE id = ?", id);
    if (!u) continue;
    const rows = byUser.filter((r) => r.id === id);
    const pick = (kind: string, detail?: string) => rows.filter((r) => r.kind === kind && (!detail || r.detail === detail));
    const sum = (rs: Agg[], f: keyof Agg) => rs.reduce((a, r) => a + Number(r[f] ?? 0), 0);
    const ai = pick("ai");
    const lim = opts.limitsOf(id);
    users.push({
      id,
      name: u.name,
      email: u.email,
      isAdmin: lim.isAdmin,
      aiWrite: sum(pick("ai", "write"), "n"),
      aiTag: sum(pick("ai", "tag"), "n"),
      aiOther: sum(pick("ai", "other"), "n"),
      inputTokens: sum(ai, "input"),
      outputTokens: sum(ai, "output"),
      costUsd: round(sum(ai, "cost")),
      uploads: sum(pick("upload"), "n"),
      uploadBytes: sum(pick("upload"), "bytes"),
      storageBytes: storageByUser.get(id) ?? 0,
      exports: sum(pick("export"), "n"),
      docsCreated: sum(pick("doc"), "n"),
      limits: lim.limits,
      overrides: lim.overrides,
    });
  }
  users.sort((a, b) => b.costUsd - a.costUsd || b.aiWrite + b.aiTag - (a.aiWrite + a.aiTag) || b.storageBytes - a.storageBytes);

  // ── 팀별
  const teamIds = new Set<string>([...byTeam.map((r) => r.id).filter((x): x is string => !!x), ...storageByTeam.keys()]);
  const teams: UsageTeamRow[] = [];
  for (const id of teamIds) {
    const t = db.get<{ name: string }>("SELECT name FROM teams WHERE id = ?", id);
    if (!t) continue;
    const rows = byTeam.filter((r) => r.id === id);
    const sum = (kind: string, f: keyof Agg) => rows.filter((r) => r.kind === kind).reduce((a, r) => a + Number(r[f] ?? 0), 0);
    teams.push({
      id,
      name: t.name,
      members: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE team_id = ?", id)?.n ?? 0,
      aiCalls: sum("ai", "n"),
      costUsd: round(sum("ai", "cost")),
      uploads: sum("upload", "n"),
      uploadBytes: sum("upload", "bytes"),
      storageBytes: storageByTeam.get(id) ?? 0,
      docsTotal: db.get<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE team_id = ?", id)?.n ?? 0,
      docsCreated: sum("doc", "n"),
      exports: sum("export", "n"),
    });
  }
  teams.sort((a, b) => b.costUsd - a.costUsd || b.aiCalls - a.aiCalls || b.storageBytes - a.storageBytes);

  // ── 기능별 · 모델별
  const features = FEATURES.map((f) => {
    const rs = byUser.filter((r) => r.kind === f.kind && (!f.detail || r.detail === f.detail));
    return { key: f.key, label: f.label, count: rs.reduce((a, r) => a + r.n, 0), costUsd: round(rs.reduce((a, r) => a + (r.cost ?? 0), 0)) };
  });
  const models = db
    .all<{ model: string; calls: number; input: number; output: number; cache: number; cost: number }>(
      `SELECT model, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cache_write_tokens + cache_read_tokens) AS cache, SUM(cost_usd) AS cost
        FROM usage_events WHERE month = ? AND kind = 'ai' GROUP BY model ORDER BY cost DESC`,
      month,
    )
    .map((m) => ({ model: m.model, calls: m.calls, inputTokens: m.input, outputTokens: m.output, cacheTokens: m.cache, costUsd: round(m.cost) }));

  const months = [...new Set([monthKey(), month, ...db.all<{ month: string }>("SELECT DISTINCT month FROM usage_events").map((r) => r.month)])].sort().reverse();
  return {
    month,
    months,
    budget: { spentUsd: round(monthCost(db, month)), budgetUsd: opts.budgetUsd, paused: opts.paused },
    features,
    models,
    storage: { usedBytes: totalStorageBytes(db), limitBytes: opts.storageLimit, teamLimitBytes: opts.teamStorageLimit },
    users,
    teams,
    defaults: opts.defaults,
  };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
