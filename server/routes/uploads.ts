// 이미지 파일 올리기 · 링크 사본 저장 · 저장 공간 · 파일 보기
//
//   POST   /teams/:teamId/uploads               이미지 파일(본문 = 파일 바이트, content-type = image/*)
//   POST   /teams/:teamId/uploads/from-url      { url } — 링크 이미지를 서버에 사본으로
//   DELETE /teams/:teamId/uploads/:fileId       올렸다가 저장하지 않은 파일 지우기
//   POST   /teams/:teamId/references/:id/copy   이미 저장한 링크 레퍼런스를 사본으로 바꾸기
//   POST   /teams/:teamId/references/delete-check  지우기 전에: 함께 지워질 파일 · 그 이미지를 쓰는 문서
//   GET    /teams/:teamId/storage               팀 저장 공간 (사용 중 / 한도)
//   GET    /files/<id>.webp · <id>.thumb.webp    파일 보기 — 그 팀 멤버만

import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { fileThumbUrl, fileUrl } from "../../shared/files";
import type { StorageUsage, StoredFile } from "../../shared/types";
import { storageReserve, teamStorageLimit } from "../config";
import { hasRole, requireUser, teamRole } from "../context";
import { newId } from "../db";
import { publish } from "../events";
import { processImage, UPLOAD_MAX_BYTES, UPLOAD_TYPES, type ProcessedImage } from "../images";
import { fetchImage } from "../net";
import { assertStorageAllowed, assertStorageNotFull } from "../limits";
import type { FileRow, Repo, UserRow } from "../repo";
import { enforceLimit, HttpError } from "../security";
import type { FileStore } from "../storage";
import { recordUsage } from "../usage";

const HOUR = 60 * 60_000;
/** 올려 두고 레퍼런스로 저장하지 않은 파일은 이 시간이 지나면 정리 */
export const STALE_UPLOAD_MS = 6 * HOUR;

export const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1).replace(/\.0$/, "")}GB`;

export function fileView(f: FileRow): StoredFile {
  return {
    id: f.id,
    url: fileUrl(f.id),
    thumbUrl: fileThumbUrl(f.id),
    width: f.width ?? 0,
    height: f.height ?? 0,
    bytes: f.bytes,
    name: f.name ?? undefined,
    originalUrl: f.original_url ?? undefined,
  };
}

export function usageOf(repo: Repo, teamId: string): StorageUsage {
  return { ...repo.storageUsage(teamId), limit: teamStorageLimit() };
}

/** 저장소에서 지운다 — 실패해도 요청은 끝낸다 (기록은 이미 지웠으니 나중에 다시 지울 필요 없음) */
export function removeKeys(store: FileStore, keys: string[]) {
  for (const k of keys) store.delete(k).catch((err) => console.error("저장소 파일 삭제 실패", k, (err as Error).message));
}

/** 같은 팀에 같은 파일을 동시에 올릴 때(여러 장 끌어놓기 등) 두 번 저장하지 않도록, 저장 중인 것을 기다렸다가 함께 쓴다 */
const inflight = new Map<string, Promise<FileRow>>();

/** 변환한 이미지를 저장소에 넣고 기록 — 같은 팀에 같은 파일이 있으면 그것을 돌려준다 */
export async function saveProcessed(
  repo: Repo,
  store: FileStore,
  teamId: string,
  user: UserRow,
  img: ProcessedImage,
  meta: { origin: "upload" | "copy"; name?: string; originalUrl?: string },
): Promise<FileRow> {
  const key = `${teamId}:${img.hash}`;
  const pending = inflight.get(key);
  if (pending) await pending.catch(() => undefined);
  const job = storeOnce(repo, store, teamId, user, img, meta);
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    if (inflight.get(key) === job) inflight.delete(key);
  }
}

async function storeOnce(
  repo: Repo,
  store: FileStore,
  teamId: string,
  user: UserRow,
  img: ProcessedImage,
  meta: { origin: "upload" | "copy"; name?: string; originalUrl?: string },
): Promise<FileRow> {
  const same = repo.findFileByHash(teamId, img.hash);
  if (same) {
    if (!repo.fileInUse(same.id)) repo.touchFile(same.id);
    return same;
  }
  const bytes = img.full.length + img.thumb.length;
  // 팀 → 내(올린 사람) → 서비스 전체 저장 공간 (한도 확인은 limits.ts 한 곳에서)
  assertStorageAllowed(repo, user, teamId, bytes);
  const free = await store.freeBytes();
  if (free !== null && free - bytes < storageReserve()) {
    throw new HttpError(507, "서버 저장 공간이 부족해요. 관리자에게 디스크 용량을 늘려 달라고 알려 주세요.", "disk_full");
  }
  const id = newId("f");
  const key = `${teamId}/${id}.webp`;
  const thumbKey = `${teamId}/${id}.thumb.webp`;
  await store.put(key, img.full, "image/webp");
  try {
    await store.put(thumbKey, img.thumb, "image/webp");
  } catch (err) {
    await store.delete(key).catch(() => undefined);
    throw err;
  }
  recordUsage(repo.db, { userId: user.id, teamId, kind: "upload", detail: meta.origin === "copy" ? "copy" : "file", bytes });
  return repo.insertFile({
    id,
    team_id: teamId,
    key,
    thumb_key: thumbKey,
    bytes,
    width: img.width,
    height: img.height,
    hash: img.hash,
    origin: meta.origin,
    original_url: meta.originalUrl ?? null,
    name: meta.name?.slice(0, 200) ?? null,
    created_by: user.id,
  });
}

/** 링크 이미지를 받아 사본으로 저장 (사설망 차단 등 기존 안전장치를 그대로 쓴다) */
async function copyFromUrl(repo: Repo, store: FileStore, teamId: string, user: UserRow, url: string): Promise<FileRow> {
  const { data } = await fetchImage(url, UPLOAD_MAX_BYTES).catch((err: Error & { status?: number }) => {
    throw new HttpError(err.status === 413 ? 413 : 422, err.status === 413 ? "원본 이미지가 20MB 보다 커서 사본을 저장할 수 없어요." : `원본 이미지를 가져오지 못했어요: ${err.message}`, "copy_failed");
  });
  const img = await processImage(data, [...UPLOAD_TYPES, "image/avif"]).catch((err: HttpError) => {
    if (err.status === 415) throw new HttpError(415, "이 형식(SVG 등)은 사본으로 저장할 수 없어요.", "unsupported_file");
    throw err;
  });
  return saveProcessed(repo, store, teamId, user, img, { origin: "copy", originalUrl: url });
}

export function uploadsRouter(repo: Repo, store: FileStore): Router {
  const r = Router({ mergeParams: true });

  r.get("/storage", teamRole(repo, "viewer"), (req, res) => {
    res.json(usageOf(repo, req.teamId!));
  });

  // 파일을 받기 전에 권한 · 크기 · 남은 공간부터 본다 (큰 요청을 끝까지 읽지 않게)
  const precheck = (req: Request, _res: Response, next: NextFunction) => {
    const user = requireUser(req);
    enforceLimit(`upload:${user.id}`, 600, HOUR, "업로드가 너무 많아요. 잠시 후 다시 시도해 주세요.");
    if (Number(req.get("content-length") ?? 0) > UPLOAD_MAX_BYTES) throw new HttpError(413, "파일당 20MB까지 올릴 수 있어요.", "file_too_large");
    assertStorageNotFull(repo, user, req.teamId!);
    next();
  };
  const raw = express.raw({ type: () => true, limit: UPLOAD_MAX_BYTES });
  const readBody = (req: Request, res: Response, next: NextFunction) =>
    raw(req, res, (err?: unknown) => {
      if ((err as { type?: string })?.type === "entity.too.large") return next(new HttpError(413, "파일당 20MB까지 올릴 수 있어요.", "file_too_large"));
      next(err);
    });

  r.post("/uploads", teamRole(repo, "editor"), precheck, readBody, async (req, res) => {
    const user = req.user!;
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, "파일이 비어 있어요.", "invalid_input");
    let name: string | undefined;
    try {
      name = decodeURIComponent(req.get("x-file-name") ?? "") || undefined;
    } catch {
      name = undefined;
    }
    const img = await processImage(body);
    const file = await saveProcessed(repo, store, req.teamId!, user, img, { origin: "upload", name });
    res.json({ file: fileView(file), usage: usageOf(repo, req.teamId!) });
  });

  r.post("/uploads/from-url", teamRole(repo, "editor"), async (req, res) => {
    const user = req.user!;
    enforceLimit(`upload:${user.id}`, 600, HOUR, "업로드가 너무 많아요. 잠시 후 다시 시도해 주세요.");
    const { url } = z.object({ url: z.string().trim().min(1).max(4000) }).parse(req.body);
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, "http(s) 링크만 사본으로 저장할 수 있어요.", "invalid_input");
    assertStorageNotFull(repo, user, req.teamId!);
    const file = await copyFromUrl(repo, store, req.teamId!, user, url);
    res.json({ file: fileView(file), usage: usageOf(repo, req.teamId!) });
  });

  r.delete("/uploads/:fileId", teamRole(repo, "editor"), (req, res) => {
    const f = repo.getFile(String(req.params.fileId));
    if (!f || f.team_id !== req.teamId) throw new HttpError(404, "파일을 찾을 수 없어요.", "not_found");
    // 레퍼런스가 쓰고 있으면 지우지 않는다 (레퍼런스를 지울 때 함께 지워진다)
    removeKeys(store, repo.releaseFiles([f.id]));
    res.json({ ok: true, usage: usageOf(repo, req.teamId!) });
  });

  r.post("/references/:id/copy", teamRole(repo, "editor"), async (req, res) => {
    const teamId = req.teamId!;
    const user = req.user!;
    enforceLimit(`upload:${user.id}`, 600, HOUR, "업로드가 너무 많아요. 잠시 후 다시 시도해 주세요.");
    const ref = repo.getRef(teamId, String(req.params.id));
    if (!ref) throw new HttpError(404, "레퍼런스를 찾을 수 없어요.", "not_found");
    if (ref.fileId) {
      res.json(ref);
      return;
    }
    if (!/^https?:\/\//i.test(ref.imageUrl)) throw new HttpError(400, "링크 이미지만 사본으로 저장할 수 있어요.", "invalid_input");
    assertStorageNotFull(repo, user, teamId);
    const file = await copyFromUrl(repo, store, teamId, user, ref.imageUrl);
    const updated = repo.updateRef(
      teamId,
      ref.id,
      { imageUrl: fileUrl(file.id), fileId: file.id, originalUrl: ref.imageUrl, width: file.width ?? ref.width, height: file.height ?? ref.height },
      user.id,
    )!;
    repo.log(teamId, user.id, "ref.copy", `레퍼런스 '${ref.title ?? "제목 없음"}' 이미지 사본 저장`);
    publish(teamId, "library", { kind: "refs" }, user.id);
    res.json(updated);
  });

  r.post("/references/delete-check", teamRole(repo, "editor"), (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string().max(40)).max(2000) }).parse(req.body);
    const fileIds = [...new Set(ids.map((id) => repo.getRef(req.teamId!, id)?.fileId).filter((x): x is string => !!x))];
    res.json({ files: fileIds.length, docs: repo.docsUsingFiles(req.teamId!, fileIds) });
  });

  return r;
}

/** /api/files/<id>.webp · <id>.thumb.webp — 팀 멤버만. 주소가 바뀌지 않으니 브라우저가 오래 캐시해도 된다 */
export function filesRouter(repo: Repo, store: FileStore): Router {
  const r = Router();
  r.get("/:name", async (req, res) => {
    const user = requireUser(req);
    const m = /^([A-Za-z0-9_-]{4,40})(\.thumb)?\.webp$/.exec(String(req.params.name));
    const f = m ? repo.getFile(m[1]) : undefined;
    // 다른 팀 파일은 있는지조차 알려 주지 않는다
    if (!m || !f || !hasRole(repo.getRole(f.team_id, user.id), "viewer")) throw new HttpError(404, "파일을 찾을 수 없어요.", "not_found");
    const thumb = !!m[2];
    const etag = `"${f.id}${thumb ? "-t" : ""}"`;
    res.set({
      "cache-control": "private, max-age=31536000, immutable",
      etag,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    });
    if (req.get("if-none-match") === etag) {
      res.status(304).end();
      return;
    }
    const obj = await store.get(thumb ? f.thumb_key : f.key);
    if (!obj) throw new HttpError(404, "파일을 찾을 수 없어요.", "not_found");
    res.type("image/webp").send(obj.data);
  });
  return r;
}

/** 올려 두고 저장하지 않은 파일 정리 */
export function cleanupStaleUploads(repo: Repo, store: FileStore, olderThanMs = STALE_UPLOAD_MS): number {
  const keys = repo.releaseFiles(repo.staleFileIds(olderThanMs));
  removeKeys(store, keys);
  return keys.length / 2;
}
