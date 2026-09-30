// 이미지 업로드 통합 테스트 — 실제 HTTP 로 올리고, 저장 · 권한 · 용량 · 삭제 · 링크 사본을 확인한다.

import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "refboard-up-"));
// 링크 사본 테스트용 이미지 서버가 127.0.0.1 이라 사설망 차단을 이 파일에서만 끈다
process.env.ALLOW_PRIVATE_FETCH = "1";
vi.spyOn(console, "log").mockImplementation(() => {});

let base = "";
let imgBase = "";
const UPLOADS = path.join(process.env.DATA_DIR!, "uploads");
let appCtx: { repo: import("../server/repo").Repo; store: import("../server/storage").FileStore };
const closers: (() => void)[] = [];

let photo: Buffer; // 1600×1200 JPEG
let wide: Buffer; // 4000×1000 PNG

beforeAll(async () => {
  const { Database } = await import("../server/db");
  const { createApp } = await import("../server/app");
  const created = createApp(new Database(":memory:"));
  appCtx = created;
  const server = created.app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closers.push(() => server.close());

  photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#468" } }).jpeg({ quality: 90 }).toBuffer();
  wide = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#e93" } }).png().toBuffer();
  // 외부 이미지 서버 흉내 (링크 사본)
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
  const imgServer = http.createServer((req, res) => {
    if (req.url === "/photo.jpg") return res.writeHead(200, { "content-type": "image/jpeg" }).end(photo);
    if (req.url === "/logo.svg") return res.writeHead(200, { "content-type": "image/svg+xml" }).end(svg);
    res.writeHead(404).end();
  });
  imgServer.listen(0, "127.0.0.1");
  await new Promise((r) => imgServer.once("listening", r));
  imgBase = `http://127.0.0.1:${(imgServer.address() as AddressInfo).port}`;
  closers.push(() => imgServer.close());
});
afterAll(() => closers.forEach((c) => c()));

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
  get = (u: string, h?: Record<string, string>) => this.req("GET", u, undefined, h);
  post = (u: string, b?: unknown) => this.req("POST", u, b ?? {});
  del = (u: string) => this.req("DELETE", u, {});
  upload = (teamId: string, data: Buffer, type = "image/jpeg", name = "사진.jpg") =>
    this.req("POST", `/api/teams/${teamId}/uploads`, data, { "content-type": type, "x-file-name": encodeURIComponent(name) });
}

const PW = "Refboard!2026";
let seq = 0;
async function signup(name: string) {
  (await import("../server/security")).limiter.clear();
  const c = new Client();
  const email = `up${++seq}-${Date.now()}@example.com`;
  const r = await c.post("/api/auth/signup", { email, password: PW, name });
  const token = String(r.json.devLink).split("/verify/")[1];
  const v = await c.post("/api/auth/verify", { token });
  expect(v.status).toBe(200);
  return { c, team: v.json.teams[0].id as string };
}

const stored = (key: string) => fs.existsSync(path.join(UPLOADS, key));

describe("이미지 업로드", () => {
  it("올리면 WebP 원본(긴 변 2000px) + 썸네일이 저장되고, 레퍼런스로 저장할 수 있다", async () => {
    const { c, team } = await signup("업로더");
    const up = await c.upload(team, wide, "image/png", "배너.png");
    expect(up.status).toBe(200);
    const f = up.json.file;
    expect(f.url).toBe(`/api/files/${f.id}.webp`);
    expect(f.thumbUrl).toBe(`/api/files/${f.id}.thumb.webp`);
    expect([f.width, f.height]).toEqual([2000, 500]);
    expect(f.name).toBe("배너.png");
    expect(stored(`${team}/${f.id}.webp`) && stored(`${team}/${f.id}.thumb.webp`)).toBe(true);
    expect(up.json.usage.used).toBe(f.bytes);

    const img = await c.get(f.url);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("cache-control")).toContain("private");
    expect((await sharp(img.buf).metadata()).width).toBe(2000);
    const thumb = await c.get(f.thumbUrl);
    expect((await sharp(thumb.buf).metadata()).width).toBe(480);
    // 바뀌지 않으니 다시 받을 필요 없음
    expect((await c.get(f.url, { "if-none-match": img.headers.get("etag")! })).status).toBe(304);

    const ref = await c.post(`/api/teams/${team}/references`, [{ imageUrl: f.url, title: "배너", tags: ["업로드"], source: "upload" }]);
    expect(ref.status).toBe(200);
    const saved = ref.json.created[0];
    expect(saved).toMatchObject({ imageUrl: f.url, fileId: f.id, thumbUrl: f.thumbUrl, source: "upload" });
    const lib = await c.get(`/api/teams/${team}/library`);
    expect(lib.json.references[0].thumbUrl).toBe(f.thumbUrl);
  });

  it("같은 파일을 두 번 올리면 같은 파일 — 레퍼런스로 다시 저장하면 중복으로 알려 준다", async () => {
    const { c, team } = await signup("중복");
    const a = await c.upload(team, photo);
    const b = await c.upload(team, Buffer.from(photo));
    expect(b.json.file.id).toBe(a.json.file.id);
    await c.post(`/api/teams/${team}/references`, [{ imageUrl: a.json.file.url, tags: ["a"] }]);
    const again = await c.post(`/api/teams/${team}/references`, [{ imageUrl: b.json.file.url, tags: ["b"] }]);
    expect(again.json.created).toHaveLength(0);
    expect(again.json.duplicates[0].existing.tags).toEqual(["a", "b"]);
  });

  it("같은 파일을 동시에 여러 번 올려도 한 번만 저장한다 (여러 장 끌어놓기)", async () => {
    const { c, team } = await signup("동시");
    const same = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#135" } }).jpeg().toBuffer();
    const results = await Promise.all([1, 2, 3, 4].map(() => c.upload(team, Buffer.from(same))));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(results.map((r) => r.json.file.id)).size).toBe(1);
    expect((await c.get(`/api/teams/${team}/storage`)).json.files).toBe(1);

    // 저장소가 느려도(저장하는 사이 같은 파일이 또 들어와도) 한 번만 저장
    const { saveProcessed } = await import("../server/routes/uploads");
    const { processImage } = await import("../server/images");
    const img = await processImage(await sharp({ create: { width: 500, height: 400, channels: 3, background: "#642" } }).png().toBuffer());
    let puts = 0;
    const real = appCtx.store;
    const slow: typeof real = {
      kind: real.kind,
      where: real.where,
      get: (k) => real.get(k),
      delete: (k) => real.delete(k),
      freeBytes: () => real.freeBytes(),
      put: async () => void (puts++, await new Promise((r) => setTimeout(r, 60))),
    };
    const userId = appCtx.repo.db.get<{ id: string }>("SELECT user_id AS id FROM memberships WHERE team_id = ?", team)!.id;
    const user = appCtx.repo.getUser(userId)!;
    const rows = await Promise.all([1, 2, 3].map(() => saveProcessed(appCtx.repo, slow, team, user, img, { origin: "upload" })));
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(puts).toBe(2); // 원본 + 썸네일 한 번씩
  });

  it("JPG · PNG · WebP · GIF 만, 20MB 까지 — 쉬운 말로 거부", async () => {
    const { c, team } = await signup("형식");
    const txt = await c.upload(team, Buffer.from("just some text, definitely not an image"), "image/png", "가짜.png");
    expect(txt.status).toBe(415);
    expect(txt.json.error).toContain("JPG · PNG · WebP · GIF");
    const svg = await c.upload(team, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/svg+xml");
    expect(svg.status).toBe(415);
    const big = Buffer.alloc(20 * 1024 * 1024 + 10);
    big.set([0xff, 0xd8, 0xff], 0);
    const tooBig = await c.upload(team, big);
    expect(tooBig.status).toBe(413);
    expect(tooBig.json.error).toContain("20MB");
    const gif = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#0a0" } }).gif().toBuffer();
    expect((await c.upload(team, gif, "image/gif")).status).toBe(200);
  });

  it("파일은 그 팀 멤버만 볼 수 있고, 다른 팀 파일로 레퍼런스를 만들 수 없다", async () => {
    const a = await signup("A팀");
    const b = await signup("B팀");
    const f = (await a.c.upload(a.team, photo)).json.file;
    expect((await new Client().get(f.url)).status).toBe(401);
    expect((await b.c.get(f.url)).status).toBe(404);
    expect((await b.c.get(f.thumbUrl)).status).toBe(404);
    expect((await b.c.post(`/api/teams/${b.team}/references`, [{ imageUrl: f.url }])).status).toBe(400);
    expect((await a.c.get("/api/files/..%2F..%2Fetc%2Fpasswd")).status).toBe(404);
  });

  it("보기 전용 멤버는 올릴 수 없다 · 올리기 요청에도 CSRF 헤더가 필요하다", async () => {
    const owner = await signup("관리자");
    const t = await owner.c.post("/api/teams", { name: "보기팀" });
    const inv = await owner.c.post(`/api/teams/${t.json.id}/invites/code`, { role: "viewer", password: "view-2026" });
    const viewer = await signup("보기만");
    await viewer.c.post("/api/invites/join", { code: inv.json.code, password: "view-2026" });
    expect((await viewer.c.upload(t.json.id, photo)).status).toBe(403);
    const noCsrf = await fetch(`${base}/api/teams/${owner.team}/uploads`, {
      method: "POST",
      headers: { "content-type": "image/jpeg", cookie: [...owner.c.cookies].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: new Uint8Array(photo),
    });
    expect(noCsrf.status).toBe(403);
  });

  it("팀 저장 공간: 사용량 표시, 한도에 닿으면 안내하고 막는다", async () => {
    const { c, team } = await signup("용량");
    const first = await c.upload(team, photo);
    const usage = await c.get(`/api/teams/${team}/storage`);
    expect(usage.json).toEqual({ used: first.json.file.bytes, files: 1, limit: 2 * 1024 ** 3 });
    process.env.TEAM_STORAGE_LIMIT_GB = String(first.json.file.bytes / 1024 ** 3); // 딱 지금 사용량만큼
    try {
      const full = await c.upload(team, wide, "image/png");
      expect(full.status).toBe(413);
      expect(full.json.code).toBe("storage_full");
      expect(full.json.error).toMatch(/팀 저장 공간\(.*GB\)이 가득 찼어요/);
    } finally {
      delete process.env.TEAM_STORAGE_LIMIT_GB;
    }
  });

  it("레퍼런스를 지우면 저장한 파일도 지워진다 — 지우기 전에 그 이미지를 쓰는 문서를 알려 준다", async () => {
    const { c, team } = await signup("삭제");
    const f = (await c.upload(team, photo)).json.file;
    const ref = (await c.post(`/api/teams/${team}/references`, [{ imageUrl: f.url }])).json.created[0];
    const doc = await c.post(`/api/teams/${team}/documents`, {
      title: "업로드 문서",
      settings: {},
      pages: [{ id: "p1", elements: [{ id: "e1", type: "image", src: f.url, x: 0, y: 0, w: 10, h: 10 }] }],
    });
    expect(doc.json.pages[0].elements[0].src).toBe(f.url); // 문서에도 그대로 저장
    const check = await c.post(`/api/teams/${team}/references/delete-check`, { ids: [ref.id] });
    expect(check.json).toEqual({ files: 1, docs: [{ id: doc.json.id, title: "업로드 문서" }] });

    const del = await c.post(`/api/teams/${team}/references/bulk`, { ids: [ref.id], delete: true });
    expect(del.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(stored(`${team}/${f.id}.webp`) || stored(`${team}/${f.id}.thumb.webp`)).toBe(false);
    expect((await c.get(f.url)).status).toBe(404);
    expect((await c.get(`/api/teams/${team}/storage`)).json.used).toBe(0);
  });

  it("올려 두고 저장하지 않은 파일은 정리되고, 레퍼런스가 쓰는 파일은 남는다", async () => {
    const { c, team } = await signup("정리");
    const kept = (await c.upload(team, photo)).json.file;
    await c.post(`/api/teams/${team}/references`, [{ imageUrl: kept.url }]);
    const dropped = (await c.upload(team, wide, "image/png")).json.file;
    const { cleanupStaleUploads } = await import("../server/routes/uploads");
    expect(cleanupStaleUploads(appCtx.repo, appCtx.store, -1)).toBeGreaterThanOrEqual(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(stored(`${team}/${dropped.id}.webp`)).toBe(false);
    expect(stored(`${team}/${kept.id}.webp`)).toBe(true);
    // 창에서 뺀 파일은 바로 지울 수도 있다 (레퍼런스가 쓰는 파일은 지우지 않음)
    await c.del(`/api/teams/${team}/uploads/${kept.id}`);
    expect(stored(`${team}/${kept.id}.webp`)).toBe(true);
  });

  it("팀을 지우면 그 팀이 올린 파일도 지워진다", async () => {
    const owner = await signup("팀삭제");
    const t = await owner.c.post("/api/teams", { name: "지울팀" });
    const f = (await owner.c.upload(t.json.id, photo)).json.file;
    await owner.c.post(`/api/teams/${t.json.id}/references`, [{ imageUrl: f.url }]);
    expect((await owner.c.req("DELETE", `/api/teams/${t.json.id}`, { confirm: "지울팀" })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(stored(`${t.json.id}/${f.id}.webp`)).toBe(false);
  });
});

describe("링크 이미지 사본 저장", () => {
  it("링크 이미지를 서버에 사본으로 — 원래 링크를 기억해 같은 링크를 다시 넣으면 중복", async () => {
    const { c, team } = await signup("사본");
    const link = `${imgBase}/photo.jpg`;
    const copy = await c.post(`/api/teams/${team}/uploads/from-url`, { url: link });
    expect(copy.status).toBe(200);
    expect(copy.json.file.originalUrl).toBe(link);
    const ref = (await c.post(`/api/teams/${team}/references`, [{ imageUrl: copy.json.file.url, originalUrl: link, source: "image" }])).json.created[0];
    expect(ref).toMatchObject({ fileId: copy.json.file.id, originalUrl: link });
    const again = await c.post(`/api/teams/${team}/references`, [{ imageUrl: link }]);
    expect(again.json.duplicates).toHaveLength(1);
    expect((await c.post(`/api/teams/${team}/references/check`, { urls: [link] })).json[0].existing.id).toBe(ref.id);
  });

  it("이미 저장한 링크 레퍼런스도 '사본 저장'으로 바꿀 수 있다", async () => {
    const { c, team } = await signup("나중사본");
    const link = `${imgBase}/photo.jpg`;
    const ref = (await c.post(`/api/teams/${team}/references`, [{ imageUrl: link, title: "링크" }])).json.created[0];
    const res = await c.post(`/api/teams/${team}/references/${ref.id}/copy`);
    expect(res.status).toBe(200);
    expect(res.json.imageUrl).toMatch(/^\/api\/files\/.+\.webp$/);
    expect(res.json.originalUrl).toBe(link);
    expect((await c.get(res.json.imageUrl)).status).toBe(200);
  });

  it("SVG · 사라진 링크는 사본을 만들지 못한다고 알려 준다", async () => {
    const { c, team } = await signup("사본실패");
    const svg = await c.post(`/api/teams/${team}/uploads/from-url`, { url: `${imgBase}/logo.svg` });
    expect(svg.status).toBe(415);
    expect(svg.json.error).toContain("사본으로 저장할 수 없어요");
    const gone = await c.post(`/api/teams/${team}/uploads/from-url`, { url: `${imgBase}/missing.jpg` });
    expect(gone.status).toBe(422);
    expect((await c.post(`/api/teams/${team}/uploads/from-url`, { url: "javascript:alert(1)" })).status).toBe(400);
  });
});
