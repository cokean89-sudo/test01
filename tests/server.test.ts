// 웹 서버 통합 테스트 — 메모리 DB 로 실제 HTTP 요청을 보낸다.

import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "refboard-test-"));
process.env.ADMIN_EMAILS = "fb-admin@example.com,fb-admin2@example.com";
vi.spyOn(console, "log").mockImplementation(() => {});

let base = "";
let close: () => void;

beforeAll(async () => {
  const { Database } = await import("../server/db");
  const { createApp } = await import("../server/app");
  const { app } = createApp(new Database(":memory:"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close?.());

class Client {
  cookies = new Map<string, string>();
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + url, {
      method,
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        "x-refboard": "1",
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, v] = pair.split("=");
      if (attrs.some((a) => a.trim() === "Max-Age=0")) this.cookies.delete(k.trim());
      else this.cookies.set(k.trim(), v);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b?: unknown) => this.req("POST", u, b ?? {});
  put = (u: string, b?: unknown) => this.req("PUT", u, b ?? {});
  patch = (u: string, b?: unknown) => this.req("PATCH", u, b ?? {});
  del = (u: string, b?: unknown) => this.req("DELETE", u, b ?? {});
}

const PW = "Refboard!2026";
let seq = 0;

/** 가입 + 메일 인증(개발 링크) → 로그인된 클라이언트 */
async function signup(name: string, email = `user${++seq}-${Date.now()}@example.com`) {
  // 테스트는 모두 같은 IP 에서 가입하므로 IP 단위 가입 제한을 비운다
  (await import("../server/security")).limiter.clear();
  const c = new Client();
  const r = await c.post("/api/auth/signup", { email, password: PW, name });
  expect(r.status).toBe(200);
  const token = String(r.json.devLink).split("/verify/")[1];
  const v = await c.post("/api/auth/verify", { token });
  expect(v.status).toBe(200);
  return { c, email, user: v.json.user, personalTeam: v.json.teams[0] };
}

describe("인증", () => {
  it("가입 → 인증 전에는 로그인 불가 → 인증 후 로그인", async () => {
    const c = new Client();
    const email = `verify-${Date.now()}@example.com`;
    const s = await c.post("/api/auth/signup", { email, password: PW, name: "홍길동" });
    expect(s.json.devLink).toMatch(/#\/verify\//);
    const l1 = await c.post("/api/auth/login", { email, password: PW });
    expect(l1.status).toBe(403);
    expect(l1.json.code).toBe("unverified");
    await c.post("/api/auth/verify", { token: s.json.devLink.split("/verify/")[1] });
    const me = await c.get("/api/auth/me");
    expect(me.json.user.email).toBe(email);
    expect(me.json.teams[0].personal).toBe(true);
    // 인증 링크는 한 번만
    const again = await c.post("/api/auth/verify", { token: s.json.devLink.split("/verify/")[1] });
    expect(again.status).toBe(400);
  });

  it("약한 비밀번호 거부", async () => {
    const r = await new Client().post("/api/auth/signup", { email: "weak@example.com", password: "short", name: "a" });
    expect(r.status).toBe(400);
    const r2 = await new Client().post("/api/auth/signup", { email: "weak@example.com", password: "aaaaaaaaaaaa", name: "a" });
    expect(r2.status).toBe(400);
  });

  it("이미 가입된 메일로 가입해도 가입 여부를 드러내지 않는다", async () => {
    const { email } = await signup("기존");
    const r = await new Client().post("/api/auth/signup", { email, password: PW, name: "다른 사람" });
    expect(r.status).toBe(200);
    expect(r.json.devLink).toBeUndefined();
  });

  it("틀린 비밀번호 5회면 계정이 잠시 잠긴다", async () => {
    const { email } = await signup("잠금");
    const c = new Client();
    for (let i = 0; i < 5; i++) expect((await c.post("/api/auth/login", { email, password: "Wrong-password1" })).status).toBe(401);
    const locked = await c.post("/api/auth/login", { email, password: PW });
    expect(locked.status).toBe(429);
    expect(locked.json.code).toBe("locked");
  });

  it("로그아웃하면 세션이 무효가 된다", async () => {
    const { c } = await signup("로그아웃");
    const cookie = [...c.cookies][0];
    await c.post("/api/auth/logout");
    const stolen = new Client();
    stolen.cookies.set(cookie[0], cookie[1]);
    expect((await stolen.get("/api/auth/me")).status).toBe(401);
  });

  it("세션 쿠키는 HttpOnly·SameSite=Lax", async () => {
    const c = new Client();
    const email = `cookie-${Date.now()}@example.com`;
    const s = await c.post("/api/auth/signup", { email, password: PW, name: "쿠키" });
    const res = await fetch(base + "/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-refboard": "1" },
      body: JSON.stringify({ token: s.json.devLink.split("/verify/")[1] }),
    });
    const cookie = res.headers.getSetCookie()[0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("비밀번호 재설정 → 기존 세션 모두 해제", async () => {
    const { c, email } = await signup("재설정");
    const f = await new Client().post("/api/auth/forgot", { email });
    const token = String(f.json.devLink).split("/reset/")[1];
    const other = new Client();
    const r = await other.post("/api/auth/reset", { token, password: "New-password-2026" });
    expect(r.status).toBe(200);
    expect((await c.get("/api/auth/me")).status).toBe(401);
    expect((await new Client().post("/api/auth/login", { email, password: "New-password-2026" })).status).toBe(200);
  });

  it("로그인 상태 유지: 끄면 브라우저 세션 쿠키, 켜면 SESSION_MAX_DAYS 동안 유지", async () => {
    const { email } = await signup("유지");
    const cookieOf = async (remember?: boolean) => {
      const res = await fetch(base + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-refboard": "1" },
        body: JSON.stringify({ email, password: PW, ...(remember === undefined ? {} : { remember }) }),
      });
      expect(res.status).toBe(200);
      return res.headers.getSetCookie()[0];
    };
    const session = await cookieOf(false);
    expect(session).toMatch(/HttpOnly/);
    expect(session).not.toMatch(/Max-Age/);
    expect(await cookieOf()).not.toMatch(/Max-Age/); // 기본은 유지 안 함
    const { auth } = await import("../server/config");
    expect(await cookieOf(true)).toMatch(new RegExp(`Max-Age=${auth.sessionMaxDays * 24 * 3600}`));
  });

  it("브라우저 세션(유지 안 함)은 서버에서도 무활동 12시간 뒤 만료", async () => {
    const { Database } = await import("../server/db");
    const { Repo } = await import("../server/repo");
    const repo = new Repo(new Database(":memory:"));
    const u = repo.createUser({ email: "idle@example.com", name: "idle", verified: true });
    const shortToken = repo.createSession(u.id, undefined, undefined, false);
    const longToken = repo.createSession(u.id, undefined, undefined, true);
    expect(repo.resolveSession(shortToken)?.id).toBe(u.id);
    // 13시간 전으로 돌린다
    const past = Date.now() - 13 * 60 * 60 * 1000;
    const db = (repo as unknown as { db: { run: (sql: string, ...p: unknown[]) => void } }).db;
    db.run("UPDATE sessions SET created_at = ?, last_seen_at = ?, expires_at = ? WHERE persistent = 0", past, past, past + 12 * 60 * 60 * 1000);
    db.run("UPDATE sessions SET created_at = ?, last_seen_at = ? WHERE persistent = 1", past, past);
    expect(repo.resolveSession(shortToken)).toBeUndefined();
    expect(repo.resolveSession(longToken)?.id).toBe(u.id);
  });

  it("다른 기기 모두 로그아웃 — 지금 기기는 유지", async () => {
    const { c, email } = await signup("다른기기");
    const laptop = new Client();
    expect((await laptop.post("/api/auth/login", { email, password: PW })).status).toBe(200);
    const r = await c.post("/api/auth/logout-others");
    expect(r.json.removed).toBe(1);
    expect((await laptop.get("/api/auth/me")).status).toBe(401);
    expect((await c.get("/api/auth/me")).status).toBe(200);
  });
});

describe("보안 기본값", () => {
  it("로그인 없이 API 사용 불가", async () => {
    const c = new Client();
    expect((await c.get("/api/teams")).status).toBe(401);
    expect((await c.get("/api/proxy?url=https://example.com/a.png")).status).toBe(401);
    expect((await c.post("/api/scrape", { url: "https://example.com" })).status).toBe(401);
  });

  it("CSRF: 사용자 정의 헤더 없거나 다른 출처면 거부", async () => {
    const { c } = await signup("csrf");
    const noHeader = await c.req("POST", "/api/teams", { name: "x" }, { "x-refboard": "" });
    expect(noHeader.status).toBe(403);
    const foreign = await c.req("POST", "/api/teams", { name: "x" }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
  });

  it("헬스 체크는 로그인 없이 응답", async () => {
    const r = await new Client().get("/api/health");
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it("보안 헤더", async () => {
    const r = await new Client().get("/api/auth/providers");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-powered-by")).toBeNull();
  });
});

describe("팀 · 초대 · 권한", () => {
  it("다른 팀 데이터에는 접근할 수 없다", async () => {
    const a = await signup("A");
    const b = await signup("B");
    const t = await a.c.post("/api/teams", { name: "브랜드전략팀" });
    expect((await b.c.get(`/api/teams/${t.json.id}`)).status).toBe(404);
    expect((await b.c.get(`/api/teams/${t.json.id}/library`)).status).toBe(404);
    expect((await b.c.post(`/api/teams/${t.json.id}/references`, [{ imageUrl: "https://x.com/a.jpg" }])).status).toBe(404);
  });

  it("메일 초대는 초대받은 메일 계정만 수락할 수 있다", async () => {
    const a = await signup("팀장");
    const b = await signup("팀원");
    const c = await signup("제3자");
    const t = await a.c.post("/api/teams", { name: "초대팀" });
    const inv = await a.c.post(`/api/teams/${t.json.id}/invites/email`, { email: b.email, role: "editor" });
    expect(inv.status).toBe(200);
    const token = inv.json.link.split("/invite/")[1];
    const wrong = await c.c.post("/api/invites/accept", { token });
    expect(wrong.status).toBe(403);
    const ok = await b.c.post("/api/invites/accept", { token });
    expect(ok.json.teamId).toBe(t.json.id);
    const detail = await b.c.get(`/api/teams/${t.json.id}`);
    expect(detail.json.role).toBe("editor");
    // 한 번 쓴 초대는 다시 못 씀
    expect((await c.c.post("/api/invites/accept", { token })).status).toBeGreaterThanOrEqual(400);
  });

  it("코드 + 비밀번호 초대, 비밀번호 10회 오류 시 잠김", async () => {
    const a = await signup("관리자");
    const t = await a.c.post("/api/teams", { name: "코드팀" });
    const inv = await a.c.post(`/api/teams/${t.json.id}/invites/code`, { role: "viewer", password: "brand-2026", maxUses: 5 });
    expect(inv.json.code).toMatch(/^[A-Z2-9]{10}$/);
    const b = await signup("참여자");
    expect((await b.c.post("/api/invites/join", { code: inv.json.code, password: "wrong" })).status).toBe(400);
    const ok = await b.c.post("/api/invites/join", { code: inv.json.code.toLowerCase(), password: "brand-2026" });
    expect(ok.json.teamId).toBe(t.json.id);
    // 보기 전용은 레퍼런스를 추가할 수 없다
    expect((await b.c.post(`/api/teams/${t.json.id}/references`, [{ imageUrl: "https://x.com/v.jpg" }])).status).toBe(403);

    const inv2 = await a.c.post(`/api/teams/${t.json.id}/invites/code`, { role: "editor" });
    expect(inv2.json.password).toHaveLength(8);
    const attackers = await Promise.all([1, 2, 3, 4].map((i) => signup("공격" + i)));
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await attackers[i % 4].c.post("/api/invites/join", { code: inv2.json.code, password: "guess" + i })).status;
    expect(last).toBe(423);
    // 잠긴 뒤에는 올바른 비밀번호도 거부
    const late = await signup("늦은참여자");
    expect((await late.c.post("/api/invites/join", { code: inv2.json.code, password: inv2.json.password })).status).toBe(423);
  });

  it("관리자는 자신보다 높은 권한으로 초대할 수 없고, 마지막 소유자는 나갈 수 없다", async () => {
    const a = await signup("소유자");
    const t = await a.c.post("/api/teams", { name: "권한팀" });
    expect((await a.c.post(`/api/teams/${t.json.id}/invites/code`, { role: "owner" })).status).toBe(400);
    expect((await a.c.del(`/api/teams/${t.json.id}/members/${a.user.id}`)).status).toBe(400);
  });

  it("팀 기본 문서 설정 저장", async () => {
    const a = await signup("설정");
    const t = await a.c.post("/api/teams", { name: "설정팀" });
    const defaults = { ...t.json.defaults, footer: { ...t.json.defaults.footer, left: "EMART BRAND STRATEGY" } };
    const r = await a.c.put(`/api/teams/${t.json.id}/defaults`, { defaults });
    expect(r.json.defaults.footer.left).toBe("EMART BRAND STRATEGY");
    const act = await a.c.get(`/api/teams/${t.json.id}/activity`);
    expect(act.json.map((x: { action: string }) => x.action)).toContain("team.defaults");
  });
});

describe("라이브러리 · 문서", () => {
  it("중복 이미지는 새로 만들지 않고 누가 언제 추가했는지 알려주며 태그는 합친다", async () => {
    const a = await signup("김기획");
    const t = await a.c.post("/api/teams", { name: "중복팀" });
    const inv = await a.c.post(`/api/teams/${t.json.id}/invites/code`, { role: "editor", password: "join-now-1" });
    const b = await signup("이디자");
    await b.c.post("/api/invites/join", { code: inv.json.code, password: "join-now-1" });

    const url = "https://i.pinimg.com/736x/ab/cd/ef/0123abcd.jpg";
    const first = await a.c.post(`/api/teams/${t.json.id}/references`, [{ imageUrl: url, tags: ["조형물"] }]);
    expect(first.json.created).toHaveLength(1);
    const check = await b.c.post(`/api/teams/${t.json.id}/references/check`, { urls: ["https://i.pinimg.com/236x/ab/cd/ef/0123abcd.jpg"] });
    expect(check.json[0].existing.createdByName).toBe("김기획");
    const dup = await b.c.post(`/api/teams/${t.json.id}/references`, [{ imageUrl: "https://i.pinimg.com/originals/ab/cd/ef/0123abcd.jpg", tags: ["별"] }]);
    expect(dup.json.created).toHaveLength(0);
    expect(dup.json.duplicates[0].existing.tags).toEqual(["조형물", "별"]);
    expect(dup.json.duplicates[0].existing.createdByName).toBe("김기획");
    const lib = await b.c.get(`/api/teams/${t.json.id}/library`);
    expect(lib.json.references).toHaveLength(1);
    expect(lib.json.references[0].updatedByName).toBe("이디자");
  });

  it("태그 병합(동의어)·일괄 삭제", async () => {
    const { c, personalTeam } = await signup("태그정리");
    const T = `/api/teams/${personalTeam.id}`;
    await c.post(`${T}/references`, [
      { imageUrl: "https://example.com/t1.jpg", tags: ["야간조명", "pinterest"] },
      { imageUrl: "https://example.com/t2.jpg", tags: ["야간 조명", "레드"] },
    ]);
    const m = await c.post(`${T}/tags/merge`, { from: ["야간조명", "야간 조명"], to: "야간조명" });
    expect(m.status).toBe(200);
    const all = m.json.references.flatMap((r: { tags: string[] }) => r.tags);
    expect(all.filter((t: string) => t === "야간조명")).toHaveLength(2);
    expect(all).not.toContain("야간 조명");
    const d = await c.post(`${T}/tags/delete`, { tags: ["pinterest"] });
    expect(d.json.references.flatMap((r: { tags: string[] }) => r.tags)).not.toContain("pinterest");
  });

  it("'미분류' 태그: 태그 없이 저장하면 붙고, 다른 태그가 생기면 빠지고, 다 지우면 다시 붙는다", async () => {
    const { c, personalTeam } = await signup("미분류");
    const T = `/api/teams/${personalTeam.id}`;
    const add = await c.post(`${T}/references`, [{ imageUrl: "https://example.com/u1.jpg" }, { imageUrl: "https://example.com/u2.jpg", tags: [] }, { imageUrl: "https://example.com/u3.jpg", tags: ["패키지"] }]);
    const [u1, u2, u3] = add.json.created;
    expect([u1.tags, u2.tags, u3.tags]).toEqual([["미분류"], ["미분류"], ["패키지"]]);
    // 직접 태그를 붙이면 '미분류'는 빠진다 (PATCH · 일괄 추가 · 중복 저장으로 태그 더하기)
    expect((await c.patch(`${T}/references/${u1.id}`, { tags: ["미분류", "팝업스토어"] })).json.tags).toEqual(["팝업스토어"]);
    const b = await c.post(`${T}/references/bulk`, { ids: [u2.id], addTags: ["레드"] });
    expect(b.json.references.find((r: { id: string }) => r.id === u2.id).tags).toEqual(["레드"]);
    // 태그를 모두 빼면 다시 '미분류'
    const rm = await c.post(`${T}/references/bulk`, { ids: [u2.id], removeTags: ["레드"] });
    expect(rm.json.references.find((r: { id: string }) => r.id === u2.id).tags).toEqual(["미분류"]);
    const del = await c.post(`${T}/tags/delete`, { tags: ["패키지"] });
    expect(del.json.references.find((r: { id: string }) => r.id === u3.id).tags).toEqual(["미분류"]);
    // 중복 이미지로 태그만 더할 때도
    const dup = await c.post(`${T}/references`, [{ imageUrl: "https://example.com/u3.jpg", tags: ["경쟁사"] }]);
    expect(dup.json.duplicates[0].existing.tags).toEqual(["경쟁사"]);
    // '미분류' 이름을 바꾸면 그 이미지들이 한 번에 새 태그로 정리된다
    const ren = await c.post(`${T}/tags/rename`, { from: "미분류", to: "정리중" });
    expect(ren.json.references.find((r: { id: string }) => r.id === u2.id).tags).toEqual(["정리중"]);
  });

  it("예전에 태그 없이 저장된 레퍼런스는 업데이트 때 '미분류'가 붙는다 (DB v6)", async () => {
    const { Database } = await import("../server/db");
    const db = new Database(":memory:");
    db.raw.exec("PRAGMA user_version = 5");
    db.raw.exec("INSERT INTO teams (id, name, created_by, created_at) VALUES ('t1', 'T', 'u', 0)");
    const cols = "id, team_id, image_url, url_key, tags_json, kind, source, created_by, created_at, updated_by, updated_at";
    db.raw.exec(`INSERT INTO refs (${cols}) VALUES ('r1', 't1', 'https://e.com/1.jpg', 'k1', '[]', 'image', 'web', 'u', 0, 'u', 0)`);
    db.raw.exec(`INSERT INTO refs (${cols}) VALUES ('r2', 't1', 'https://e.com/2.jpg', 'k2', '["패키지"]', 'image', 'web', 'u', 0, 'u', 0)`);
    db.raw.exec("PRAGMA user_version = 5");
    const reopened = db as unknown as { migrate: () => void };
    reopened.migrate();
    expect(db.all<{ id: string; tags_json: string }>("SELECT id, tags_json FROM refs ORDER BY id")).toEqual([
      { id: "r1", tags_json: '["미분류"]' },
      { id: "r2", tags_json: '["패키지"]' },
    ]);
  });

  it("일부만 수정(PATCH)해도 태그·유형은 그대로 (이미지 크기 기록 등)", async () => {
    const { c, personalTeam } = await signup("부분수정");
    const T = `/api/teams/${personalTeam.id}`;
    const add = await c.post(`${T}/references`, [{ imageUrl: "https://example.com/p1.jpg", tags: ["야간조명", "게이트"], kind: "logo", source: "pinterest" }]);
    const ref = add.json.created[0];
    const p = await c.patch(`${T}/references/${ref.id}`, { width: 1600, height: 900 });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ tags: ["야간조명", "게이트"], kind: "logo", source: "pinterest", width: 1600, height: 900 });
    const cs = await c.post(`${T}/cases`, { name: "케이스", tags: ["스타디움"] });
    const cp = await c.patch(`${T}/cases/${cs.json.id}`, { name: "새 이름" });
    expect(cp.json).toMatchObject({ name: "새 이름", tags: ["스타디움"] });
  });

  it("AI 가 없으면 태그를 추측해 붙이지 않고 안내만 한다", async () => {
    const { c } = await signup("태그AI");
    process.env.DISABLE_AI = "1";
    const r = await c.post("/api/ai/tags", { imageUrl: "https://example.com/x.jpg", title: "Stadium night lights pinterest" });
    delete process.env.DISABLE_AI;
    expect(r.json.engine).toBe("off");
    expect(r.json.tags).toEqual([]);
  });

  it("javascript: 같은 위험한 이미지 주소는 거부", async () => {
    const a = await signup("xss");
    const r = await a.c.post(`/api/teams/${a.personalTeam.id}/references`, [{ imageUrl: "javascript:alert(1)" }]);
    expect(r.status).toBe(400);
  });

  it("임시 보관함이 저장되고, 동시에 넣은 항목은 모두 남으며, 위험한 주소는 걸러진다", async () => {
    const a = await signup("보관함");
    const T = `/api/teams/${a.personalTeam.id}`;
    const { defaultSettings } = await import("../src/lib/defaults");
    const created = await a.c.post(`${T}/documents`, { title: "보관함 문서", settings: defaultSettings(), pages: [{ id: "p1", kind: "blank", layout: { mode: "grid", columns: 3, rows: 0, gap: 6, seed: 0 }, area: { x: 0, y: 0, w: 100, h: 100 }, elements: [] }] });
    const doc = created.json;
    const item = (id: string, src: string) => ({ id, src, addedAt: 1 });
    const s1 = await a.c.put(`${T}/documents/${doc.id}`, { doc: { ...doc, tray: [item("t1", "https://img.example.com/1.jpg"), item("bad", "javascript:alert(1)")] }, baseVersion: 1 });
    expect(s1.status).toBe(200);
    // 같은 버전(1)을 기준으로 다른 사람이 다른 항목을 넣음 → 병합
    const s2 = await a.c.put(`${T}/documents/${doc.id}`, { doc: { ...doc, tray: [item("t2", "https://img.example.com/2.jpg")] }, baseVersion: 1 });
    expect(s2.json.merged).toBe(true);
    const got = await a.c.get(`/api/documents/${doc.id}`);
    expect(got.json.tray.map((t: { id: string }) => t.id).sort()).toEqual(["t1", "t2"]);
    // 보관함을 모르는 예전 클라이언트가 저장해도 보관함은 유지
    const { tray: _omit, ...legacy } = got.json;
    await a.c.put(`${T}/documents/${doc.id}`, { doc: legacy, baseVersion: got.json.version });
    const again = await a.c.get(`/api/documents/${doc.id}`);
    expect(again.json.tray).toHaveLength(2);
  });

  it("동시 편집: 서로 다른 페이지·요소 변경이 모두 반영된다", async () => {
    const a = await signup("편집1");
    const teamId = a.personalTeam.id;
    const { defaultSettings } = await import("../src/lib/defaults");
    const page = (id: string, text: string) => ({
      id,
      kind: "blank",
      layout: { mode: "grid", columns: 3, rows: 0, gap: 6, seed: 0 },
      area: { x: 0, y: 0, w: 100, h: 100 },
      elements: [{ id: id + "t", type: "text", role: "title", text, x: 0, y: 0, w: 10, h: 10 }],
    });
    const created = await a.c.post(`/api/teams/${teamId}/documents`, { title: "공동 문서", settings: defaultSettings(), pages: [page("p1", "A"), page("p2", "B")] });
    const doc = created.json;
    expect(doc.version).toBe(1);

    const mine = structuredClone(doc);
    mine.pages[0].elements[0].text = "A (편집1)";
    const theirs = structuredClone(doc);
    theirs.pages[1].elements[0].text = "B (편집2)";
    theirs.pages.push(page("p3", "C"));

    const s1 = await a.c.put(`/api/teams/${teamId}/documents/${doc.id}`, { doc: theirs, baseVersion: 1 });
    expect(s1.json).toMatchObject({ version: 2, merged: false });
    const s2 = await a.c.put(`/api/teams/${teamId}/documents/${doc.id}`, { doc: mine, baseVersion: 1 });
    expect(s2.json.merged).toBe(true);
    expect(s2.json.version).toBe(3);
    expect(s2.json.doc.pages.map((p: { elements: { text: string }[] }) => p.elements[0].text)).toEqual(["A (편집1)", "B (편집2)", "C"]);

    const versions = await a.c.get(`/api/teams/${teamId}/documents/${doc.id}/versions`);
    expect(versions.json[0].version).toBe(3);
    const restored = await a.c.post(`/api/teams/${teamId}/documents/${doc.id}/versions/1/restore`);
    expect(restored.json.pages).toHaveLength(2);
    expect(restored.json.version).toBe(4);
  });
});

describe("의견 보내기", () => {
  const PNG = "data:image/png;base64," + Buffer.from("89504e470d0a1a0a0000000d4948445200000001", "hex").toString("base64");
  const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const send = (c: Client, body: Record<string, unknown>) =>
    c.req("POST", "/api/feedback", { kind: "bug", message: "버튼이 안 눌려요", pageUrl: "http://localhost/#/library", screenshots: [], ...body }, { "user-agent": CHROME });

  it("로그인하지 않으면 보낼 수 없다", async () => {
    const r = await send(new Client(), {});
    expect(r.status).toBe(401);
  });

  it("DB 에 저장되고(메일 미설정이어도) 관리자만 목록·스크린샷을 본다", async () => {
    const { c, email } = await signup("의견1");
    const r = await send(c, { pageUrl: "http://localhost/#/reset/SECRET-TOKEN?code=abc", viewport: "1440×900", screenshots: [{ name: "../../etc/passwd.png", dataUrl: PNG }] });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    await new Promise((res) => setTimeout(res, 20));

    expect((await c.get("/api/admin/feedback")).status).toBe(403);

    const admin = await signup("관리자", "fb-admin@example.com");
    expect(admin.user.isAdmin).toBe(true);
    const list = await admin.c.get("/api/admin/feedback");
    expect(list.status).toBe(200);
    const fb = list.json.items.find((x: { id: string }) => x.id === r.json.id);
    expect(fb).toMatchObject({ kind: "bug", message: "버튼이 안 눌려요", userEmail: email, mailStatus: "skipped", status: "open" });
    expect(fb.pageUrl).not.toContain("SECRET-TOKEN");
    expect(fb.pageUrl).toContain("#/reset/***");
    expect(fb.pageUrl).not.toContain("abc");
    expect(fb.browser).toBe("Chrome 131 · Windows 10/11 · 화면 1440×900");
    expect(fb.files).toHaveLength(1);
    expect(fb.files[0].name).toBe("etcpasswd.png");

    const file = await admin.c.get(`/api/admin/feedback/${fb.id}/files/${fb.files[0].id}`);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await c.get(`/api/admin/feedback/${fb.id}/files/${fb.files[0].id}`)).status).toBe(403);

    const done = await admin.c.patch(`/api/admin/feedback/${fb.id}`, { status: "done" });
    expect(done.json.status).toBe("done");
    const open = await admin.c.get("/api/admin/feedback?status=open");
    expect(open.json.items.some((x: { id: string }) => x.id === fb.id)).toBe(false);
  });

  it("보낸 사람이 쓰던 앱 버전이 함께 기록된다 (형식이 이상하면 버린다)", async () => {
    const { c } = await signup("의견버전");
    const ok = await send(c, { viewport: "1280×800", appVersion: "0.8.0" });
    const bad = await send(c, { appVersion: "<b>1</b>" });
    expect([ok.status, bad.status]).toEqual([200, 200]);
    const admin = await signup("관리자2", "fb-admin2@example.com");
    const items = (await admin.c.get("/api/admin/feedback")).json.items as { id: string; browser: string }[];
    expect(items.find((x) => x.id === ok.json.id)?.browser).toBe("Chrome 131 · Windows 10/11 · 화면 1280×800 · 앱 v0.8.0");
    expect(items.find((x) => x.id === bad.json.id)?.browser).toBe("Chrome 131 · Windows 10/11");
  });

  it("스크린샷: 이미지가 아닌 파일·3장 초과·5MB 초과는 거부", async () => {
    const { c } = await signup("의견2");
    const fake = "data:image/png;base64," + Buffer.from("<script>alert(1)</script>").toString("base64");
    expect((await send(c, { screenshots: [{ name: "x.png", dataUrl: fake }] })).status).toBe(400);
    expect((await send(c, { screenshots: Array.from({ length: 4 }, () => ({ name: "a.png", dataUrl: PNG })) })).status).toBe(400);
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    Buffer.from("89504e470d0a1a0a", "hex").copy(big);
    const r = await send(c, { screenshots: [{ name: "big.png", dataUrl: "data:image/png;base64," + big.toString("base64") }] });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("5MB");
    expect((await send(c, { message: "   " })).status).toBe(400);
  });

  it("사용자당 한 시간에 5번까지", async () => {
    const { c } = await signup("의견3");
    for (let i = 0; i < 5; i++) expect((await send(c, { message: `의견 ${i}` })).status).toBe(200);
    const r = await send(c, { message: "여섯 번째" });
    expect(r.status).toBe(429);
    expect(r.json.error).toContain("한 시간에 5번");
  });
});
