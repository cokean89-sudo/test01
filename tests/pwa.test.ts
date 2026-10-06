// 홈 화면 추가(PWA) · 휴대폰 공유 메뉴(Web Share Target)
//   · manifest · 아이콘 파일이 맞는지
//   · 서비스 워커(public/sw.js)를 가짜 워커 환경에서 돌려 공유를 받아 두는지 → 앱(src/lib/share.ts)이 한 번만 꺼내는지
//   · 서비스 워커가 없을 때 서버가 안내 화면으로 보내는지

import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const tokens = JSON.parse(read("tokens.json"));

describe("manifest · 아이콘", () => {
  it("홈 화면에 추가할 수 있는 설정 (이름 · 시작 주소 · 단독 화면 · 색)", () => {
    expect(manifest).toMatchObject({ name: expect.stringContaining("RefBoard"), short_name: "RefBoard", start_url: "/#/library", scope: "/", display: "standalone", lang: "ko" });
    expect(manifest.background_color).toBe(tokens.color.grey["100"].$value);
    expect(manifest.theme_color).toBe(tokens.color.white.$value);
  });

  it("아이콘 파일이 있고 크기가 맞다 (192 · 512 · 마스커블 · iOS)", async () => {
    for (const icon of manifest.icons.filter((i: { type: string }) => i.type === "image/png")) {
      const meta = await sharp(path.join(root, "public", icon.src)).metadata();
      expect(`${meta.width}x${meta.height}`, icon.src).toBe(icon.sizes);
    }
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
    expect((await sharp(path.join(root, "public/icons/apple-touch-icon.png")).metadata()).width).toBe(180);
  });

  it("공유 메뉴: 이미지 · 링크를 POST multipart 로 받는다", () => {
    expect(manifest.share_target).toMatchObject({ action: "/share-target", method: "POST", enctype: "multipart/form-data", params: { url: "url", text: "text" } });
    expect(manifest.share_target.params.files[0].name).toBe("images");
    expect(manifest.share_target.params.files[0].accept).toContain("image/jpeg");
  });

  it("index.html 이 manifest · 아이콘을 연결한다", () => {
    const html = read("index.html");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain("viewport-fit=cover");
  });
});

/** Cache Storage 흉내 */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: RequestInfo | URL) => new URL(typeof r === "string" ? r : r instanceof URL ? r.href : r.url, "https://refboard.test").pathname;
  return {
    stores,
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name)!;
      return {
        put: async (r: RequestInfo, res: Response) => void m.set(keyOf(r), res),
        match: async (r: RequestInfo) => m.get(keyOf(r))?.clone(),
        delete: async (r: RequestInfo) => m.delete(keyOf(r)),
        keys: async () => [...m.keys()].map((k) => ({ url: "https://refboard.test" + k })),
      };
    },
  };
}

/** public/sw.js 를 서비스 워커처럼 실행하고 fetch 처리기를 돌려준다 */
function loadWorker(caches: ReturnType<typeof fakeCaches>) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const self = { addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn), location: new URL("https://refboard.test/"), skipWaiting() {}, clients: { claim: async () => {} } };
  vm.runInNewContext(read("public/sw.js"), { self, caches, Response, URL, String, Date, Math, Promise, JSON });
  return async (req: Request) => {
    let responded: Promise<Response> | undefined;
    handlers.fetch({ request: req, respondWith: (p: Promise<Response>) => (responded = p) });
    return responded;
  };
}

describe("서비스 워커: 공유 받기", () => {
  const caches = fakeCaches();
  const fetchEvent = loadWorker(caches);
  let shareId = "";

  it("이미지 2장 + 링크를 받아 두고 /#/share/<id> 로 연다 (이미지가 아닌 파일은 버린다)", async () => {
    const form = new FormData();
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#3182f6" } }).png().toBuffer();
    form.append("images", new File([new Uint8Array(png)], "a.png", { type: "image/png" }));
    form.append("images", new File([new Uint8Array(png)], "b.png", { type: "image/png" }));
    form.append("images", new File(["hello"], "note.txt", { type: "text/plain" }));
    form.append("url", "https://www.pinterest.com/pin/123/");
    form.append("text", "성수 팝업 레퍼런스");
    const res = await fetchEvent(new Request("https://refboard.test/share-target", { method: "POST", body: form }));
    expect(res?.status).toBe(303);
    const loc = res!.headers.get("location")!;
    expect(loc).toMatch(/^https:\/\/refboard\.test\/#\/share\/[a-z0-9]{6,40}$/);
    shareId = loc.split("/").pop()!;
    const saved = [...caches.stores.get("rb-share")!.keys()];
    expect(saved.sort()).toEqual([`/__share/${shareId}/0`, `/__share/${shareId}/1`, `/__share/${shareId}/meta`]);
  });

  it("다른 요청은 건드리지 않는다 (화면 · API 는 캐시하지 않음)", async () => {
    expect(await fetchEvent(new Request("https://refboard.test/api/teams"))).toBeUndefined();
    expect(await fetchEvent(new Request("https://refboard.test/share-target"))).toBeUndefined();
    expect(await fetchEvent(new Request("https://other.example/share-target", { method: "POST", body: "x" }))).toBeUndefined();
  });

  it("앱이 한 번만 꺼내고 지운다 → 레퍼런스 추가 창에 넣을 파일 · 링크", async () => {
    (globalThis as { caches?: unknown }).caches = caches;
    const { takeShared } = await import("../src/lib/share");
    const shared = await takeShared(shareId);
    expect(shared?.files.map((f) => [f.name, f.type, f.size > 0])).toEqual([
      ["a.png", "image/png", true],
      ["b.png", "image/png", true],
    ]);
    expect(shared?.text).toBe("https://www.pinterest.com/pin/123/\n성수 팝업 레퍼런스");
    expect(caches.stores.get("rb-share")!.size).toBe(0);
    expect(await takeShared(shareId)).toBeNull();
    expect(await takeShared("../../etc")).toBeNull();
  });
});

describe("서버", () => {
  let base = "";
  let close: () => void;
  beforeAll(async () => {
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "refboard-pwa-"));
    const { Database } = await import("../server/db");
    const { createApp } = await import("../server/app");
    const server = createApp(new Database(":memory:")).app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close?.());

  it("서비스 워커가 아직 없을 때 공유가 오면 안내 화면으로 (내용은 저장하지 않음)", async () => {
    const form = new FormData();
    form.append("url", "https://example.com/a.jpg");
    const res = await fetch(base + "/share-target", { method: "POST", body: form, redirect: "manual" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/#/share/nosw");
  });
});
