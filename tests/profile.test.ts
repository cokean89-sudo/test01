// 프로필 — 기본 이모지 · 색 배정, 개인 · 팀 프로필 사진(512px WebP, 저장 용량 제외), 권한, 마이그레이션

import fs from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AVATAR_URL, EMOJI_CATEGORIES, EMOJIS, initialOf, isEmojiId, isProfileColor, PROFILE_COLORS, randomUserLook, stableIndex, teamProfileOf, userProfileOf } from "../shared/profile";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "refboard-profile-"));
vi.spyOn(console, "log").mockImplementation(() => {});

let base = "";
const UPLOADS = path.join(process.env.DATA_DIR!, "uploads");
let close: () => void;
let photo: Buffer; // 1600×1200 JPEG

beforeAll(async () => {
  const { Database } = await import("../server/db");
  const { createApp } = await import("../server/app");
  const created = createApp(new Database(":memory:"));
  const server = created.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
  photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#468" } }).jpeg({ quality: 90 }).toBuffer();
});
afterAll(() => close?.());

class Client {
  cookies = new Map<string, string>();
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(base + url, {
      method,
      redirect: "manual",
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
    const buf = Buffer.from(await res.arrayBuffer());
    let json: any = null;
    try {
      json = buf.length ? JSON.parse(buf.toString("utf8")) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, buf, headers: res.headers };
  }
  get = (u: string) => this.req("GET", u);
  post = (u: string, b?: unknown) => this.req("POST", u, b ?? {});
  patch = (u: string, b?: unknown) => this.req("PATCH", u, b ?? {});
  del = (u: string) => this.req("DELETE", u, {});
  image = (u: string, data: Buffer, type = "image/jpeg") => this.req("POST", u, data, { "content-type": type });
}

const PW = "Refboard!2026";
let seq = 0;
async function signup(name: string) {
  (await import("../server/security")).limiter.clear();
  const c = new Client();
  const email = `pf${++seq}-${Date.now()}@example.com`;
  const r = await c.post("/api/auth/signup", { email, password: PW, name });
  const token = String(r.json.devLink).split("/verify/")[1];
  const v = await c.post("/api/auth/verify", { token });
  expect(v.status).toBe(200);
  return { c, user: v.json.user, team: v.json.teams[0] };
}

/** 팀을 만들고 초대 코드로 다른 사람을 넣는다 */
async function teamWith(owner: Client, role: "admin" | "editor" | "viewer", other: Client, name = "디자인팀") {
  const t = await owner.post("/api/teams", { name });
  const inv = await owner.post(`/api/teams/${t.json.id}/invites/code`, { role, password: "join-2026" });
  const j = await other.post("/api/invites/join", { code: inv.json.code, password: "join-2026" });
  expect(j.status).toBe(200);
  return t.json.id as string;
}

const stored = (avatarUrl: string) => fs.existsSync(path.join(UPLOADS, "avatars", avatarUrl.split("/").pop()!));
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("기본 프로필", () => {
  it("가입하면 이모지 · 배경색 · 사용자 고유 색이 정해지고, 개인 작업공간에도 팀 색이 있다", async () => {
    const { user, team } = await signup("새사람");
    expect(isEmojiId(user.profile.emoji)).toBe(true);
    expect(isProfileColor(user.profile.bg)).toBe(true);
    expect(isProfileColor(user.profile.color)).toBe(true);
    expect(user.profile.image).toBeUndefined();
    expect(isProfileColor(team.profile.color)).toBe(true);
    expect(team.profile.image).toBeUndefined();
  });

  it("내 계정에서 이모지 · 배경색 · 내 색 · 이름을 바꾼다 — 목록에 없는 값은 받지 않는다", async () => {
    const { c } = await signup("바꾸기");
    const r = await c.patch("/api/profile", { emoji: "penguin", bg: "teal", color: "violet", name: "바꾼이름" });
    expect(r.status).toBe(200);
    expect(r.json.user).toMatchObject({ name: "바꾼이름", profile: { emoji: "penguin", bg: "teal", color: "violet" } });
    // 일부만 바꾸면 나머지는 그대로
    const r2 = await c.patch("/api/profile", { bg: "pink" });
    expect(r2.json.user.profile).toMatchObject({ emoji: "penguin", bg: "pink", color: "violet" });
    for (const bad of [{ emoji: "apple-grinning" }, { emoji: "../x" }, { bg: "#ff0000" }, { color: "gold" }, { name: "" }]) {
      expect((await c.patch("/api/profile", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await c.get("/api/auth/me")).json.user.profile).toMatchObject({ emoji: "penguin", bg: "pink", color: "violet" });
  });

  it("로그인하지 않았거나 CSRF 헤더가 없으면 바꿀 수 없다", async () => {
    const anon = new Client();
    expect((await anon.patch("/api/profile", { emoji: "cat" })).status).toBe(401);
    const { c } = await signup("헤더");
    expect((await c.req("PATCH", "/api/profile", { emoji: "cat" }, { "x-refboard": "" })).status).toBe(403);
  });
});

describe("개인 프로필 사진", () => {
  it("올리면 512×512 WebP 로 저장되고, 저장 용량 한도 계산에는 들어가지 않는다", async () => {
    const { c, team } = await signup("사진주인");
    const up = await c.image("/api/profile/avatar", photo);
    expect(up.status).toBe(200);
    const url = up.json.user.profile.image as string;
    expect(url).toMatch(AVATAR_URL);
    expect(stored(url)).toBe(true);

    const img = await c.get(url);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    const meta = await sharp(img.buf).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
    expect(meta.exif).toBeUndefined();

    // 팀 · 개인 저장 공간은 그대로 0
    expect((await c.get(`/api/teams/${team.id}/storage`)).json.used).toBe(0);
    const usage = (await c.get("/api/usage/me")).json as { meters: { key: string; used: number }[] };
    expect(usage.meters.find((m) => m.key === "storage")!.used).toBe(0);
    // 이모지 · 색은 지워지지 않는다 (사진을 지우면 다시 보인다)
    expect(isEmojiId(up.json.user.profile.emoji)).toBe(true);
  });

  it("다시 올리면 주소가 바뀌고 이전 사진은 지워진다 — 지우면 기본 이모지로", async () => {
    const { c } = await signup("교체");
    const a = (await c.image("/api/profile/avatar", photo)).json.user.profile.image as string;
    const png = await sharp({ create: { width: 300, height: 900, channels: 4, background: "#f00a" } }).png().toBuffer();
    const b = (await c.image("/api/profile/avatar", png, "image/png")).json.user.profile.image as string;
    expect(b).not.toBe(a);
    await settle();
    expect(stored(a)).toBe(false);
    expect(stored(b)).toBe(true);
    expect((await c.get(a)).status).toBe(404);

    const d = await c.del("/api/profile/avatar");
    expect(d.status).toBe(200);
    expect(d.json.user.profile.image).toBeUndefined();
    await settle();
    expect(stored(b)).toBe(false);
  });

  it("이미지가 아니거나 너무 크면 받지 않는다", async () => {
    const { c } = await signup("거절");
    expect((await c.image("/api/profile/avatar", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/svg+xml")).status).toBe(415);
    expect((await c.image("/api/profile/avatar", Buffer.alloc(0))).status).toBe(400);
    const big = Buffer.concat([photo, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await c.image("/api/profile/avatar", big)).status).toBe(413);
  });

  it("사진은 본인과 같은 팀 사람만 볼 수 있다", async () => {
    const owner = await signup("보여주기");
    const stranger = await signup("모르는사람");
    const url = (await owner.c.image("/api/profile/avatar", photo)).json.user.profile.image as string;
    expect((await new Client().get(url)).status).toBe(401);
    expect((await stranger.c.get(url)).status).toBe(404);
    await teamWith(owner.c, "viewer", stranger.c);
    expect((await stranger.c.get(url)).status).toBe(200);
    // 팀원 목록에도 사진 · 고유 색이 실린다
    const teams = (await stranger.c.get("/api/teams")).json as { id: string; personal: boolean }[];
    const shared = teams.find((t) => !t.personal)!;
    const detail = (await stranger.c.get(`/api/teams/${shared.id}`)).json;
    const m = detail.members.find((x: { userId: string }) => x.userId === owner.user.id);
    expect(m.profile).toMatchObject({ image: url, color: owner.user.profile.color });
  });
});

describe("팀 프로필", () => {
  it("관리자만 팀 사진을 올리고 바꾸고 지울 수 있다 — 저장 용량에 들어가지 않는다", async () => {
    const owner = await signup("팀장");
    const editor = await signup("팀원");
    const teamId = await teamWith(owner.c, "editor", editor.c, "브랜드팀");

    expect((await editor.c.image(`/api/teams/${teamId}/avatar`, photo)).status).toBe(403);
    expect((await editor.c.patch(`/api/teams/${teamId}`, { color: "blue" })).status).toBe(403);

    const up = await owner.c.image(`/api/teams/${teamId}/avatar`, photo);
    expect(up.status).toBe(200);
    const url = up.json.profile.image as string;
    expect(url).toMatch(AVATAR_URL);
    expect((await owner.c.get(`/api/teams/${teamId}/storage`)).json.used).toBe(0);
    // 팀원은 팀 목록에서 사진을 보고, 받을 수 있다
    const list = (await editor.c.get("/api/teams")).json as { id: string; profile: { image?: string } }[];
    expect(list.find((t) => t.id === teamId)!.profile.image).toBe(url);
    expect((await editor.c.get(url)).status).toBe(200);
    // 팀 밖 사람은 못 본다
    const outsider = await signup("바깥");
    expect((await outsider.c.get(url)).status).toBe(404);

    expect((await editor.c.del(`/api/teams/${teamId}/avatar`)).status).toBe(403);
    const del = await owner.c.del(`/api/teams/${teamId}/avatar`);
    expect(del.json.profile.image).toBeUndefined();
    await settle();
    expect(stored(url)).toBe(false);
    // 활동 기록에 남는다
    const act = (await owner.c.get(`/api/teams/${teamId}/activity`)).json as { action: string }[];
    expect(act.filter((a) => a.action === "team.profile").length).toBe(2);
  });

  it("팀 색은 팔레트에서만 고르고, 이름만 바꿔도 색은 그대로다", async () => {
    const { c } = await signup("색바꾸기");
    const t = (await c.post("/api/teams", { name: "색팀" })).json;
    expect(isProfileColor(t.profile.color)).toBe(true);
    const r = await c.patch(`/api/teams/${t.id}`, { color: "grape" });
    expect(r.json.profile.color).toBe("grape");
    expect((await c.patch(`/api/teams/${t.id}`, { color: "#123456" })).status).toBe(400);
    const n = await c.patch(`/api/teams/${t.id}`, { name: "새 색팀" });
    expect(n.json).toMatchObject({ name: "새 색팀", profile: { color: "grape" } });
  });

  it("팀을 지우면 팀 사진도 저장소에서 지워진다", async () => {
    const { c } = await signup("팀삭제");
    const t = (await c.post("/api/teams", { name: "지울팀" })).json;
    const url = (await c.image(`/api/teams/${t.id}/avatar`, photo)).json.profile.image as string;
    expect(stored(url)).toBe(true);
    expect((await c.req("DELETE", `/api/teams/${t.id}`, { confirm: "지울팀" })).status).toBe(200);
    await settle();
    expect(stored(url)).toBe(false);
  });

  it("활동 기록에 한 사람의 프로필 · 고유 색이 함께 실린다", async () => {
    const { c, user } = await signup("기록");
    const t = (await c.post("/api/teams", { name: "기록팀" })).json;
    const act = (await c.get(`/api/teams/${t.id}/activity`)).json;
    expect(act[0]).toMatchObject({ userId: user.id, userProfile: { color: user.profile.color, emoji: user.profile.emoji } });
  });
});

describe("마이그레이션 · 기본값", () => {
  it("DB v7: 프로필 칸이 생기고, 예전 계정 · 팀은 서버 시작 때 무작위 기본값으로 채워진다", async () => {
    const { Database, MIGRATIONS } = await import("../server/db");
    const { Repo } = await import("../server/repo");
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "refboard-mig7-")), "old.sqlite");
    const raw = new DatabaseSync(file);
    for (let v = 0; v < 6; v++) raw.exec(MIGRATIONS[v]);
    raw.exec("PRAGMA user_version = 6");
    raw.exec("INSERT INTO users (id, email, name, created_at) VALUES ('u1', 'a@e.com', '가', 0), ('u2', 'b@e.com', '나', 0)");
    raw.exec("INSERT INTO teams (id, name, created_by, created_at) VALUES ('t1', '팀', 'u1', 0)");
    raw.close();

    const db = new Database(file);
    expect(db.get<{ user_version: number }>("PRAGMA user_version")!.user_version).toBe(MIGRATIONS.length);
    const repo = new Repo(db);
    expect(repo.fillProfiles()).toEqual({ users: 2, teams: 1 });
    for (const u of db.all<{ avatar_emoji: string; avatar_bg: string; color: string; avatar_id: string | null }>("SELECT * FROM users")) {
      expect(isEmojiId(u.avatar_emoji) && isProfileColor(u.avatar_bg) && isProfileColor(u.color)).toBe(true);
      expect(u.avatar_id).toBeNull();
    }
    expect(isProfileColor(db.get<{ color: string }>("SELECT color FROM teams")!.color)).toBe(true);
    // 두 번째부터는 바꾸지 않는다
    expect(repo.fillProfiles()).toEqual({ users: 0, teams: 0 });
    db.close();
  });

  it("저장된 값이 없거나 목록에서 빠진 값이면 id 로 늘 같은 기본값", () => {
    const a = userProfileOf("u-123", { color: null, avatar_emoji: "removed-emoji", avatar_bg: "magenta", avatar_id: null });
    expect(a).toEqual(userProfileOf("u-123", {}));
    expect(isEmojiId(a.emoji) && isProfileColor(a.color) && isProfileColor(a.bg)).toBe(true);
    expect(userProfileOf("u-1", { color: "red", avatar_emoji: "cat", avatar_bg: "blue", avatar_id: "abcd1234" })).toEqual({
      color: "red",
      emoji: "cat",
      bg: "blue",
      image: "/api/avatars/abcd1234.webp",
    });
    expect(teamProfileOf("t-1", { color: "lime" })).toEqual({ color: "lime" });
    expect(stableIndex("same", 12)).toBe(stableIndex("same", 12));
  });

  it("무작위 배정은 늘 목록 안의 값", () => {
    for (const r of [0, 0.5, 0.999999, 1]) {
      const look = randomUserLook(() => r);
      expect(isEmojiId(look.emoji) && isProfileColor(look.color) && isProfileColor(look.bg)).toBe(true);
    }
  });

  it("팀 기본 이미지 글자: 공백 · 기호를 건너뛴 첫 글자", () => {
    expect(initialOf("  [디자인] 팀")).toBe("디");
    expect(initialOf("brand team")).toBe("B");
    expect(initialOf("🎨 2팀")).toBe("2");
    expect(initialOf("")).toBe("?");
  });
});

describe("이모지 · 팔레트", () => {
  const root = new URL("../", import.meta.url);
  const read = (p: string) => fs.readFileSync(new URL(p, root));

  it("카테고리별로 30~50개, id 는 겹치지 않는다", () => {
    expect(EMOJIS.length).toBeGreaterThanOrEqual(30);
    expect(EMOJIS.length).toBeLessThanOrEqual(50);
    expect(new Set(EMOJIS.map((e) => e.id)).size).toBe(EMOJIS.length);
    expect(EMOJI_CATEGORIES.map((c) => c.label)).toEqual(expect.arrayContaining(["동물", "표정", "사물"]));
    for (const e of EMOJIS) expect(e.id).toMatch(/^[a-z0-9-]+$/);
  });

  it("그림은 Microsoft Fluent Emoji 3D(MIT) — 모든 이모지 파일과 라이선스가 들어 있다", async () => {
    const license = read("public/emoji/LICENSE").toString("utf8");
    expect(license).toContain("MIT License");
    expect(license).toContain("Microsoft Corporation");
    const notice = read("public/emoji/README.md").toString("utf8");
    expect(notice).toContain("fluentui-emoji");
    expect(notice.toLowerCase()).not.toContain("apple");
    for (const e of EMOJIS) {
      const meta = await sharp(read(`public/emoji/${e.id}.webp`)).metadata();
      expect([meta.format, meta.width, meta.height], e.id).toEqual(["webp", 160, 160]);
    }
    const files = fs.readdirSync(new URL("public/emoji/", root)).filter((f) => f.endsWith(".webp"));
    expect(files.length).toBe(EMOJIS.length);
  });

  it("팔레트의 모든 색에 진한 색 · 연한 색 토큰이 있다", () => {
    const css = read("src/tokens.css").toString("utf8");
    for (const c of PROFILE_COLORS) {
      expect(css, c.key).toMatch(new RegExp(`--color-profile-${c.key}:\\s*#`));
      expect(css, c.key).toMatch(new RegExp(`--color-profile-${c.key}-soft:\\s*#`));
    }
  });
});
