// 웹 서버 통합 테스트 — 메모리 DB 로 실제 HTTP 요청을 보낸다.

import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "refboard-test-"));
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

  it("javascript: 같은 위험한 이미지 주소는 거부", async () => {
    const a = await signup("xss");
    const r = await a.c.post(`/api/teams/${a.personalTeam.id}/references`, [{ imageUrl: "javascript:alert(1)" }]);
    expect(r.status).toBe(400);
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
