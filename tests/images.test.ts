// 업로드 이미지 처리 · 저장소 — 방향(EXIF) 반영, 긴 변 2000px, WebP, 썸네일, 메타데이터 제거 · 디스크 저장 · S3 서명

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_EDGE, processImage, sniffType, THUMB_EDGE } from "../server/images";
import { assertKey, createStore, DiskStore, S3Store, signV4 } from "../server/storage";

/** 가로 3000 × 세로 1000 사진인데 EXIF 에 '시계 방향 90° 돌려서 보기' + 위치 · 카메라 정보 */
async function phoneJpeg() {
  return sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#c33" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "TestCam", Model: "X1" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "37/1 33/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "126/1 58/1 0/1" },
    })
    .toBuffer();
}

describe("이미지 최적화", () => {
  it("사진 방향을 반영하고, 긴 변 2000px WebP 로 줄이고, 위치 · 카메라 정보를 지운다", async () => {
    const src = await phoneJpeg();
    const before = await sharp(src).metadata();
    expect(before.orientation).toBe(6);
    expect(src.includes(Buffer.from("TestCam"))).toBe(true);

    const out = await processImage(src);
    const m = await sharp(out.full).metadata();
    expect(m.format).toBe("webp");
    // 돌려서 보면 세로로 긴 사진 → 1000×3000 을 긴 변 2000 에 맞춤
    expect([m.width, m.height]).toEqual([667, MAX_EDGE]);
    expect([out.width, out.height]).toEqual([667, MAX_EDGE]);
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
    expect(out.full.includes(Buffer.from("TestCam"))).toBe(false);
    expect(out.full.includes(Buffer.from("GPS"))).toBe(false);
  });

  it("목록용 썸네일은 따로, 긴 변 480px", async () => {
    const out = await processImage(await phoneJpeg());
    const t = await sharp(out.thumb).metadata();
    expect(t.format).toBe("webp");
    expect(Math.max(t.width!, t.height!)).toBe(THUMB_EDGE);
    expect(out.thumb.length).toBeLessThan(out.full.length);
  });

  it("작은 이미지는 키우지 않는다 · PNG/GIF 도 WebP 로", async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: "#0af8" } }).png().toBuffer();
    const a = await processImage(png);
    expect([a.width, a.height]).toEqual([300, 200]);
    const gif = await sharp({ create: { width: 120, height: 90, channels: 3, background: "#0a0" } }).gif().toBuffer();
    const g = await processImage(gif);
    expect((await sharp(g.full).metadata()).format).toBe("webp");
  });

  it("같은 파일은 같은 해시 (두 번 올리면 알아본다)", async () => {
    const src = await phoneJpeg();
    expect((await processImage(src)).hash).toBe((await processImage(Buffer.from(src))).hash);
  });

  it("JPG · PNG · WebP · GIF 만 — SVG · 텍스트 · 가짜 확장자는 거부", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expect(processImage(svg)).rejects.toMatchObject({ status: 415 });
    await expect(processImage(Buffer.from("hello world, not an image"))).rejects.toMatchObject({ status: 415 });
    expect(sniffType(Buffer.from("GIF89a" + "x".repeat(20)))).toBe("image/gif");
  });

  it("20MB 를 넘으면 거부 · 깨진 파일은 쉬운 오류", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff], 0);
    await expect(processImage(big)).rejects.toMatchObject({ status: 413 });
    const broken = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    await expect(processImage(broken)).rejects.toMatchObject({ status: 400 });
  });
});

describe("저장소", () => {
  it("디스크: 넣고 · 읽고 · 지운다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rb-store-"));
    const store = new DiskStore(dir);
    await store.put("team1/f1.webp", Buffer.from("abc"), "image/webp");
    expect(fs.readdirSync(path.join(dir, "team1"))).toEqual(["f1.webp"]); // 임시 파일이 남지 않음
    expect(await store.get("team1/f1.webp")).toEqual({ data: Buffer.from("abc"), contentType: "image/webp" });
    await store.delete("team1/f1.webp");
    expect(await store.get("team1/f1.webp")).toBeNull();
    expect(await store.freeBytes()).toBeGreaterThan(0);
  });

  it("경로 조작(../) 키는 거부", async () => {
    expect(() => assertKey("../etc/passwd")).toThrow();
    expect(() => assertKey("team/../../x.webp")).toThrow();
    expect(() => assertKey("/abs.webp")).toThrow();
    const store = new DiskStore(fs.mkdtempSync(path.join(os.tmpdir(), "rb-store-")));
    await expect(store.put("a/../../b.webp", Buffer.from("x"), "image/webp")).rejects.toThrow();
  });

  it("S3 서명 V4 — AWS 문서의 예제(GET Object)와 같은 서명", () => {
    const h = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      date: new Date("2013-05-24T00:00:00Z"),
    });
    expect(h.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("S3 호환 저장소(R2 흉내 서버): 서명한 요청으로 넣고 · 읽고 · 지운다", async () => {
    const objects = new Map<string, { data: Buffer; type: string }>();
    const problems: string[] = [];
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks);
      const url = new URL(req.url!, `http://${req.headers.host}`);
      // 보낸 헤더로 서명을 다시 계산해 같은지 본다 (서명한 헤더 = 실제로 보낸 헤더)
      const auth = String(req.headers.authorization);
      const signed = /SignedHeaders=([^,]+)/.exec(auth)![1].split(";");
      const headers = Object.fromEntries(signed.filter((h) => !["host", "x-amz-date", "x-amz-content-sha256"].includes(h)).map((h) => [h, String(req.headers[h])]));
      const again = signV4({
        method: req.method!,
        url,
        headers,
        payloadHash: String(req.headers["x-amz-content-sha256"]),
        accessKeyId: "key",
        secretAccessKey: "secret",
        region: "auto",
        date: new Date(String(req.headers["x-amz-date"]).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z")),
      });
      if (again.authorization !== auth) problems.push("서명 불일치 " + req.method);
      if (crypto.createHash("sha256").update(body).digest("hex") !== req.headers["x-amz-content-sha256"]) problems.push("본문 해시 불일치");
      if (!url.pathname.startsWith("/bucket/")) problems.push("경로 방식 아님 " + url.pathname);
      const key = url.pathname.slice("/bucket/".length);
      if (req.method === "PUT") objects.set(key, { data: body, type: String(req.headers["content-type"]) });
      if (req.method === "DELETE") objects.delete(key);
      if (req.method === "GET") {
        const o = objects.get(key);
        if (!o) return res.writeHead(404).end();
        return res.writeHead(200, { "content-type": o.type }).end(o.data);
      }
      res.writeHead(200).end();
    });
    server.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const store = createStore(
        { STORAGE_DRIVER: "s3", S3_BUCKET: "bucket", S3_ACCESS_KEY_ID: "key", S3_SECRET_ACCESS_KEY: "secret", S3_REGION: "auto", S3_ENDPOINT: `http://127.0.0.1:${(server.address() as AddressInfo).port}` },
        "/data",
      );
      await store.put("team1/f1.webp", Buffer.from("webp-bytes"), "image/webp");
      expect(await store.get("team1/f1.webp")).toEqual({ data: Buffer.from("webp-bytes"), contentType: "image/webp" });
      await store.delete("team1/f1.webp");
      expect(await store.get("team1/f1.webp")).toBeNull();
      expect(await store.freeBytes()).toBeNull();
      expect(problems).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("환경변수로 저장소 고르기 — R2 는 경로 방식, AWS 는 버킷 도메인", () => {
    expect(createStore({}, "/data").where).toBe(path.join("/data", "uploads"));
    const r2 = createStore(
      { STORAGE_DRIVER: "s3", S3_BUCKET: "refboard", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com", S3_REGION: "auto" },
      "/data",
    ) as S3Store;
    expect(r2.kind).toBe("s3");
    expect(r2.objectUrl("t1/a.webp").href).toBe("https://acc.r2.cloudflarestorage.com/refboard/t1/a.webp");
    const aws = createStore({ STORAGE_DRIVER: "s3", S3_BUCKET: "rb", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", S3_REGION: "ap-northeast-2" }, "/data") as S3Store;
    expect(aws.objectUrl("t1/a.webp").href).toBe("https://rb.s3.ap-northeast-2.amazonaws.com/t1/a.webp");
    expect(() => createStore({ STORAGE_DRIVER: "s3" }, "/data")).toThrow(/S3_BUCKET/);
  });
});
