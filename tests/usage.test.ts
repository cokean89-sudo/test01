// 사용량 측정 · 개인별 한도 · 예산 — AI 호출은 가짜로 바꾸고(토큰 수만 알려 줌) 실제 HTTP 로 확인한다.

import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAxes } from "../shared/tags";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "refboard-usage-"));
process.env.ADMIN_EMAILS = "usage-admin@example.com";
const logs: string[] = [];
vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));

// 글쓰기 = Opus 5.5 입력 2000 · 출력 500 토큰 → $0.018, 태그 = Haiku 4.5 입력 1000 · 출력 200 · 캐시 읽기 500 → $0.00205
vi.mock("../server/ai", async (orig) => {
  const real = await orig<typeof import("../server/ai")>();
  return {
    ...real,
    aiStatus: () => ({ ai: true, model: "claude-opus-5-5", tagModel: "claude-haiku-4-5" }),
    analyzePage: async (req: Parameters<typeof real.analyzePage>[0], opts: Parameters<typeof real.analyzePage>[1]) => {
      opts?.onUsage?.({ model: "claude-opus-5-5", tokens: { input: 2000, output: 500 } });
      return { ...real.heuristicAnalysis(req), engine: "ai" };
    },
    suggestTags: async (_req: unknown, opts: Parameters<typeof real.suggestTags>[1]) => {
      opts?.onUsage?.({ model: "claude-haiku-4-5-20251001", tokens: { input: 1000, output: 200, cacheRead: 500 } });
      return { axes: emptyAxes(), tags: ["브랜드"], engine: "ai" };
    },
  };
});

let base = "";
let ctx: { repo: import("../server/repo").Repo };
let close: () => void;

beforeAll(async () => {
  const { Database } = await import("../server/db");
  const { createApp } = await import("../server/app");
  const created = createApp(new Database(":memory:"));
  ctx = created;
  const server = created.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close?.());

const ENV_KEYS = ["AI_WRITE_MONTHLY", "AI_WRITE_DAILY", "AI_TAG_MONTHLY", "AI_TAG_DAILY", "USER_STORAGE_LIMIT_MB", "TOTAL_STORAGE_LIMIT_GB", "AI_MONTHLY_BUDGET_USD"];
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

class Client {
  cookies = new Map<string, string>();
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(raw ? {} : { "content-type": "application/json" }),
        "x-refboard": "1",
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? new Uint8Array(body as Buffer) : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      this.cookies.set(k.trim(), v);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b?: unknown) => this.req("POST", u, b ?? {});
  put = (u: string, b?: unknown) => this.req("PUT", u, b ?? {});
  write = (team: string, instruction = "") => this.post("/api/ai/analyze", { kind: "reference", images: [], teamId: team, instruction });
  tag = (team: string) => this.post("/api/ai/tags", { imageUrl: "https://img.example.com/a.jpg", teamId: team });
  upload = (team: string, data: Buffer) => this.req("POST", `/api/teams/${team}/uploads`, data, { "content-type": "image/webp", "x-file-name": "noise.webp" });
}

let seq = 0;
async function signup(name: string, email = `usage${++seq}-${Date.now()}@example.com`) {
  (await import("../server/security")).limiter.clear();
  const c = new Client();
  const r = await c.post("/api/auth/signup", { email, password: "Refboard!2026", name });
  const v = await c.post("/api/auth/verify", { token: String(r.json.devLink).split("/verify/")[1] });
  expect(v.status).toBe(200);
  return { c, id: v.json.user.id as string, team: v.json.teams[0].id as string };
}

const noise = (w = 1200, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: "#888", noise: { type: "gaussian", mean: 128, sigma: 60 } } }).webp({ quality: 95 }).toBuffer();

describe("AI 개인 한도", () => {
  it("하루 한도를 넘으면 쉬운 말로 막는다 — 글쓰기와 태그 제안은 따로 센다", async () => {
    process.env.AI_WRITE_DAILY = "2";
    const { c, team } = await signup("하루");
    expect((await c.write(team)).status).toBe(200);
    expect((await c.write(team)).status).toBe(200);
    const third = await c.write(team);
    expect(third.status).toBe(429);
    expect(third.json.code).toBe("limit_ai_write_day");
    expect(third.json.error).toBe("오늘 AI 글쓰기를 모두 사용했어요 (하루 2회). 내일 다시 쓸 수 있어요.");
    expect((await c.tag(team)).status).toBe(200); // 태그 제안은 별도
  });

  it("월 한도: 다음 달 1일에 다시 채워진다고 알려 준다", async () => {
    process.env.AI_TAG_MONTHLY = "1";
    const { c, team } = await signup("한달");
    expect((await c.tag(team)).status).toBe(200);
    const next = await c.tag(team);
    expect(next.status).toBe(429);
    expect(next.json.code).toBe("limit_ai_tag_month");
    expect(next.json.error).toMatch(/^이번 달 AI 태그 제안을 모두 사용했어요 \(월 1회\)/);
    expect(next.json.error).toMatch(/\d+월 1일에 다시 채워져요/);
  });

  it("내 계정: 이번 달 사용량 · 한도 · 초기화 날짜 (베타 기간 사용 한도)", async () => {
    const { c, team } = await signup("내사용량");
    await c.write(team);
    await c.tag(team);
    await c.tag(team);
    const me = (await c.get("/api/usage/me")).json;
    expect(me.planLabel).toBe("베타 기간 사용 한도");
    expect(me.exempt).toBe(false);
    expect(me.resetDate).toMatch(/^\d{4}-\d{2}-01$/);
    const m = Object.fromEntries(me.meters.map((x: any) => [x.key, x]));
    expect(m.aiWrite).toMatchObject({ used: 1, limit: 50, daily: { used: 1, limit: 15 } });
    expect(m.aiTag).toMatchObject({ used: 2, limit: 300, daily: { used: 2, limit: 80 } });
    expect(m.storage).toMatchObject({ used: 0, limit: 500 * 1024 ** 2 });
  });

  it("관리자(운영자)는 개인 한도에서 빠진다", async () => {
    process.env.AI_WRITE_DAILY = "1";
    const admin = await signup("운영자", "usage-admin@example.com");
    for (let i = 0; i < 3; i++) expect((await admin.c.write(admin.team)).status).toBe(200);
    const me = (await admin.c.get("/api/usage/me")).json;
    expect(me.exempt).toBe(true);
    expect(me.meters[0].limit).toBeNull();
  });

  it("관리자가 사용자별로 한도를 올리고 내리고, 기본값으로 되돌린다", async () => {
    process.env.AI_WRITE_DAILY = "1";
    const u = await signup("조정");
    const admin = await signup("관리", "usage-admin@example.com").catch(async () => {
      // 이미 가입한 관리자면 로그인
      const c = new Client();
      await c.post("/api/auth/login", { email: "usage-admin@example.com", password: "Refboard!2026" });
      return { c, id: "", team: "" };
    });
    expect((await u.c.put(`/api/admin/users/${u.id}/limits`, { aiWriteDaily: 5 })).status).toBe(403);
    const up = await admin.c.put(`/api/admin/users/${u.id}/limits`, { aiWriteDaily: 3 });
    expect(up.status).toBe(200);
    expect(up.json.limits.aiWriteDaily).toBe(3);
    for (let i = 0; i < 3; i++) expect((await u.c.write(u.team)).status).toBe(200);
    expect((await u.c.write(u.team)).status).toBe(429);
    const reset = await admin.c.put(`/api/admin/users/${u.id}/limits`, { aiWriteDaily: null });
    expect(reset.json.overrides).toBeNull();
    expect(reset.json.limits.aiWriteDaily).toBe(1);
  });
});

describe("저장 공간 한도", () => {
  it("개인 저장 공간(올린 사람 기준)이 차면 막는다 — 관리자는 빠진다", async () => {
    const img = await noise();
    process.env.USER_STORAGE_LIMIT_MB = String(Math.max(0.01, (img.length * 0.5) / 1024 ** 2));
    const u = await signup("개인용량");
    const r = await u.c.upload(u.team, img);
    expect(r.status).toBe(413);
    expect(r.json.code).toBe("user_storage_full");
    expect(r.json.error).toMatch(/^내 저장 공간\(.+\)을 모두 사용했어요/);
    const admin = new Client();
    await admin.post("/api/auth/login", { email: "usage-admin@example.com", password: "Refboard!2026" });
    const me = (await admin.get("/api/auth/me")).json;
    expect((await admin.upload(me.teams[0].id, img)).status).toBe(200);
  });

  it("서비스 전체 저장 공간이 차면 모두에게 막는다", async () => {
    process.env.TOTAL_STORAGE_LIMIT_GB = "0.0000001"; // 약 107바이트
    const u = await signup("전체용량");
    const r = await u.c.upload(u.team, await noise(300, 200));
    expect(r.status).toBe(507);
    expect(r.json.code).toBe("total_storage_full");
  });

  it("업로드는 사용량(횟수 · 바이트)으로 기록되고, 내 계정 저장 공간에 반영된다", async () => {
    const u = await signup("업로드기록");
    const r = await u.c.upload(u.team, await noise(400, 300));
    expect(r.status).toBe(200);
    const me = (await u.c.get("/api/usage/me")).json;
    expect(me.meters.find((m: any) => m.key === "storage").used).toBe(r.json.file.bytes);
    const ev = ctx.repo.db.all<{ kind: string; detail: string; bytes: number }>("SELECT kind, detail, bytes FROM usage_events WHERE user_id = ?", u.id);
    expect(ev).toEqual([{ kind: "upload", detail: "file", bytes: r.json.file.bytes }]);
  });
});

describe("사용량 기록", () => {
  it("AI 는 팀 · 모델 · 토큰 · 예상 비용만 남기고, 글 내용은 저장하지 않는다", async () => {
    const u = await signup("기록");
    await u.c.write(u.team, "비밀 기획안 문구 — 저장되면 안 됨");
    await u.c.tag(u.team);
    const rows = ctx.repo.db.all<Record<string, unknown>>("SELECT * FROM usage_events WHERE user_id = ? ORDER BY id", u.id);
    expect(rows.map((r) => [r.kind, r.detail, r.model, r.team_id, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cost_usd])).toEqual([
      ["ai", "write", "claude-opus-5-5", u.team, 2000, 500, 0, 0.018],
      ["ai", "tag", "claude-haiku-4-5-20251001", u.team, 1000, 200, 500, 0.00205],
    ]);
    expect(JSON.stringify(ctx.repo.db.all("SELECT * FROM usage_events"))).not.toContain("비밀 기획안");
  });

  it("다른 팀 id 를 보내면 팀 없이 기록한다", async () => {
    const a = await signup("팀A");
    const b = await signup("팀B");
    await a.c.write(b.team);
    const row = ctx.repo.db.get<{ team_id: string | null }>("SELECT team_id FROM usage_events WHERE user_id = ?", a.id);
    expect(row?.team_id).toBeNull();
  });

  it("문서 만들기 · 복제, 내보내기(볼 수 있는 문서만)를 기록한다", async () => {
    const a = await signup("문서");
    const b = await signup("남");
    const doc = await a.c.post(`/api/teams/${a.team}/documents`, { title: "D", settings: {}, pages: [] });
    await a.c.post(`/api/teams/${a.team}/documents/${doc.json.id}/duplicate`);
    expect((await a.c.post("/api/usage/export", { kind: "pptx", docId: doc.json.id })).status).toBe(200);
    expect((await a.c.post("/api/usage/export", { kind: "pdf", docId: doc.json.id })).status).toBe(200);
    expect((await b.c.post("/api/usage/export", { kind: "pptx", docId: doc.json.id })).status).toBe(404);
    expect((await a.c.post("/api/usage/export", { kind: "exe", docId: doc.json.id })).status).toBe(400);
    const ev = ctx.repo.db.all<{ kind: string; detail: string }>("SELECT kind, detail FROM usage_events WHERE user_id = ? ORDER BY id", a.id);
    expect(ev).toEqual([
      { kind: "doc", detail: "create" },
      { kind: "doc", detail: "duplicate" },
      { kind: "export", detail: "pptx" },
      { kind: "export", detail: "pdf" },
    ]);
  });
});

describe("관리자 사용량 대시보드", () => {
  it("관리자만 · 사용자별 · 팀별 · 기능별 · 모델별 · 예산", async () => {
    const u = await signup("대시보드");
    await u.c.write(u.team);
    await u.c.tag(u.team);
    expect((await u.c.get("/api/admin/usage")).status).toBe(403);
    const admin = new Client();
    await admin.post("/api/auth/login", { email: "usage-admin@example.com", password: "Refboard!2026" });
    const d = (await admin.get("/api/admin/usage")).json;
    expect(d.month).toMatch(/^\d{4}-\d{2}$/);
    const row = d.users.find((x: any) => x.id === u.id);
    expect(row).toMatchObject({ name: "대시보드", aiWrite: 1, aiTag: 1, costUsd: 0.02005, inputTokens: 3500, outputTokens: 700 });
    expect(row.limits.aiWriteMonthly).toBe(50);
    const team = d.teams.find((x: any) => x.id === u.team);
    expect(team).toMatchObject({ aiCalls: 2, costUsd: 0.02005, members: 1 });
    expect(d.features.map((f: any) => f.key)).toEqual(["ai.write", "ai.tag", "ai.other", "upload", "export", "doc"]);
    expect(d.models.map((m: any) => m.model)).toContain("claude-opus-5-5");
    expect(d.budget.budgetUsd).toBe(20);
    expect(d.budget.spentUsd).toBeGreaterThan(0);
    expect(d.storage.teamLimitBytes).toBe(2 * 1024 ** 3);
    expect(d.storage.limitBytes).toBe(8 * 1024 ** 3);
    expect((await admin.get("/api/admin/usage?month=2026-13-01")).status).toBe(400);
  });
});

describe("서비스 월 AI 예산", () => {
  it("예산에 닿으면 모든 AI 를 멈추고(관리자 포함) 안내 · 관리자에게 메일은 한 번만", async () => {
    const spent = (await import("../server/usage")).monthCost(ctx.repo.db);
    process.env.AI_MONTHLY_BUDGET_USD = String(spent + 0.03); // 글쓰기 2번이면 넘는다
    const u = await signup("예산");
    logs.length = 0;
    expect((await u.c.write(u.team)).json.engine).toBe("ai");
    expect((await u.c.write(u.team)).json.engine).toBe("ai"); // 이 호출로 예산 도달
    const alerts = logs.filter((l) => l.includes("AI 예산 도달"));
    expect(alerts).toHaveLength(1);

    const paused = await u.c.write(u.team);
    expect(paused.status).toBe(200);
    expect(paused.json.engine).not.toBe("ai"); // AI 없이 기본 초안
    expect(paused.json.notice).toMatch(/서비스 예산에 도달해서 AI 기능을 잠시 쉬어요\. \d+월 1일에 다시 켜져요/);
    const tags = await u.c.tag(u.team);
    expect(tags.json).toMatchObject({ engine: "off", tags: [] });
    const status = (await u.c.get("/api/status")).json;
    expect(status).toMatchObject({ ai: false, aiPaused: true });
    expect((await u.c.get("/api/usage/me")).json.aiPaused).toBe(true);

    const admin = new Client();
    await admin.post("/api/auth/login", { email: "usage-admin@example.com", password: "Refboard!2026" });
    expect((await admin.write(u.team)).json.engine).not.toBe("ai");
    expect(logs.filter((l) => l.includes("AI 예산 도달"))).toHaveLength(1);
  });

  it("관리자가 예산을 쓴 금액보다 낮추면 다음 AI 요청 때 알림 메일을 한 번 보낸다", async () => {
    ctx.repo.db.run("DELETE FROM meta WHERE key LIKE 'ai_budget_alert:%'");
    process.env.AI_MONTHLY_BUDGET_USD = "0.001";
    const u = await signup("예산낮춤");
    logs.length = 0;
    const tags = await u.c.tag(u.team);
    expect(tags.json.engine).toBe("off");
    await u.c.write(u.team);
    expect(logs.filter((l) => l.includes("AI 예산 도달"))).toHaveLength(1);
    // 예산을 다시 올리면 바로 풀린다
    process.env.AI_MONTHLY_BUDGET_USD = "1000";
    expect((await u.c.tag(u.team)).json.engine).toBe("ai");
  });
});
