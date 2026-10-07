// 올린 이미지 최적화 — 사진 방향(EXIF) 반영 → 긴 변 2000px → WebP, 목록용 썸네일은 따로.
// 위치(GPS) · 카메라 정보 등 메타데이터는 모두 뺀다 (sharp 는 따로 요청하지 않으면 메타데이터를 쓰지 않는다).

import crypto from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { AVATAR_EDGE, AVATAR_MAX_BYTES } from "../shared/profile";
import { HttpError } from "./security";

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_EDGE = 2000;
export const THUMB_EDGE = 480;
/** 압축 폭탄 방지 — 1억 화소(예: 10000×10000) 넘는 이미지는 받지 않는다 */
const MAX_PIXELS = 100_000_000;

sharp.cache(false);
sharp.concurrency(2);

/** 파일 앞부분으로 실제 형식을 판별 (확장자 · content-type 은 믿지 않는다) */
export function sniffType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp" && /^(avif|avis)$/.test(buf.subarray(8, 12).toString("ascii"))) return "image/avif";
  return null;
}

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  /** 원본 파일의 해시 — 같은 파일을 두 번 올리면 알아본다 */
  hash: string;
  animated: boolean;
}

// 한 번에 너무 많은 이미지를 풀지 않게 (큰 PNG 한 장이 수백 MB 메모리를 쓸 수 있다)
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/**
 * @param allowed 받을 형식 — 업로드는 JPG/PNG/WebP/GIF, 링크 사본은 AVIF 도
 */
export async function processImage(input: Buffer, allowed: readonly string[] = UPLOAD_TYPES): Promise<ProcessedImage> {
  if (input.length > UPLOAD_MAX_BYTES) throw new HttpError(413, "파일당 20MB까지 올릴 수 있어요.", "file_too_large");
  const type = sniffType(input);
  if (!type || !allowed.includes(type)) throw new HttpError(415, "JPG · PNG · WebP · GIF 이미지만 올릴 수 있어요.", "unsupported_file");
  return slot(async () => {
    let meta: Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw new HttpError(400, "이미지 파일을 읽을 수 없어요. 파일이 손상됐는지 확인해 주세요.", "invalid_image");
    }
    if ((meta.width ?? 0) * (meta.pageHeight ?? meta.height ?? 0) > MAX_PIXELS) throw new HttpError(413, "이미지가 너무 커요 (1억 화소 이하).", "file_too_large");
    const animated = (meta.pages ?? 1) > 1 && (type === "image/gif" || type === "image/webp");
    try {
      // 움직이는 GIF · WebP 는 움직임을 살려 WebP 로, 나머지는 방향을 바로잡고 줄인다
      const base = sharp(input, { limitInputPixels: MAX_PIXELS, animated });
      const oriented = animated ? base : base.autoOrient();
      const { data: full, info } = await oriented
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const thumb = await sharp(full, { pages: 1 })
        .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 72, effort: 4 })
        .toBuffer();
      return {
        full,
        thumb,
        width: info.width,
        height: info.pageHeight ?? info.height,
        hash: crypto.createHash("sha256").update(input).digest("hex"),
        animated,
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "이미지를 변환하지 못했어요. 다른 파일로 시도해 주세요.", "invalid_image");
    }
  });
}

/**
 * 프로필 사진 — 화면에서 원형으로 잘라 보낸 이미지를 다시 검사해 512×512 WebP 로 저장한다.
 * (브라우저가 이미 잘랐지만 형식 · 크기 · 메타데이터는 서버가 다시 정한다. 움직이는 이미지는 첫 장면만)
 */
export async function processAvatar(input: Buffer, edge = AVATAR_EDGE): Promise<Buffer> {
  if (input.length > AVATAR_MAX_BYTES) throw new HttpError(413, "프로필 사진은 5MB까지 올릴 수 있어요.", "file_too_large");
  const type = sniffType(input);
  if (!type || !(UPLOAD_TYPES as readonly string[]).includes(type)) throw new HttpError(415, "JPG · PNG · WebP · GIF 이미지만 올릴 수 있어요.", "unsupported_file");
  return slot(async () => {
    try {
      const meta = await sharp(input, { limitInputPixels: MAX_PIXELS }).metadata();
      if ((meta.width ?? 0) * (meta.pageHeight ?? meta.height ?? 0) > MAX_PIXELS) throw new HttpError(413, "이미지가 너무 커요 (1억 화소 이하).", "file_too_large");
      return await sharp(input, { limitInputPixels: MAX_PIXELS, pages: 1 })
        .autoOrient()
        .resize({ width: edge, height: edge, fit: "cover", position: "centre" })
        .webp({ quality: 84, effort: 4 })
        .toBuffer();
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "이미지 파일을 읽을 수 없어요. 다른 파일로 시도해 주세요.", "invalid_image");
    }
  });
}
