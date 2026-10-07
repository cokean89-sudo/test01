// 프로필 — 개인 프로필(이름 · 기본 이모지 · 배경색 · 고유 색 · 사진)과 프로필 사진 보기
//
//   PATCH  /profile               { name?, emoji?, bg?, color? }
//   POST   /profile/avatar        사진 (본문 = 이미지 바이트, 화면에서 원형으로 잘라 512px 로 보낸 것)
//   DELETE /profile/avatar        사진 지우기 → 기본 이모지로
//   GET    /avatars/<id>.webp     사진 보기 — 본인 · 같은 팀 사람(개인), 그 팀 멤버(팀)만
//   (팀 사진은 routes/teams.ts — 팀 관리자만)
//
// 사진은 저장소 모듈(디스크 · R2 · S3)의 avatars/<id>.webp 에 두고 files 표에는 기록하지 않는다 → 저장 용량 한도에서 빠진다.
// 바꾸거나 지우면 이전 사진은 저장소에서 바로 지운다.

import express, { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AVATAR_MAX_BYTES, isEmojiId, isProfileColor, type ProfileColor } from "../../shared/profile";
import { storageReserve } from "../config";
import { requireUser } from "../context";
import { newId } from "../db";
import { publish } from "../events";
import { processAvatar } from "../images";
import { avatarKey, type Repo, type UserRow } from "../repo";
import { enforceLimit, HttpError } from "../security";
import type { FileStore } from "../storage";
import { sessionInfo } from "./auth";

const HOUR = 60 * 60_000;

export const profileColor = z.string().refine(isProfileColor, "팔레트에 있는 색만 고를 수 있어요.") as unknown as z.ZodType<ProfileColor>;
const emoji = z.string().refine(isEmojiId, "목록에 있는 이모지만 고를 수 있어요.");

/** 큰 본문을 끝까지 읽기 전에 횟수 · 크기부터 본다 */
export function avatarPrecheck(req: Request, _res: Response, next: NextFunction) {
  const user = requireUser(req);
  enforceLimit(`avatar:${user.id}`, 30, HOUR, "프로필 사진을 너무 자주 바꿨어요. 잠시 후 다시 시도해 주세요.");
  if (Number(req.get("content-length") ?? 0) > AVATAR_MAX_BYTES) throw new HttpError(413, "프로필 사진은 5MB까지 올릴 수 있어요.", "file_too_large");
  next();
}

const raw = express.raw({ type: () => true, limit: AVATAR_MAX_BYTES });
export function readAvatarBody(req: Request, res: Response, next: NextFunction) {
  raw(req, res, (err?: unknown) => {
    if ((err as { type?: string })?.type === "entity.too.large") return next(new HttpError(413, "프로필 사진은 5MB까지 올릴 수 있어요.", "file_too_large"));
    next(err);
  });
}

/** 받은 이미지를 512px WebP 로 바꿔 저장소에 넣고 새 사진 id 를 돌려준다 (기록은 부르는 쪽에서) */
export async function storeAvatar(store: FileStore, body: unknown): Promise<string> {
  if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, "파일이 비어 있어요.", "invalid_input");
  const webp = await processAvatar(body);
  const free = await store.freeBytes();
  if (free !== null && free - webp.length < storageReserve()) {
    throw new HttpError(507, "서버 저장 공간이 부족해요. 관리자에게 디스크 용량을 늘려 달라고 알려 주세요.", "disk_full");
  }
  const id = newId("a");
  await store.put(avatarKey(id), webp, "image/webp");
  return id;
}

/** 이전 사진 지우기 — 실패해도 요청은 끝낸다 (기록에서는 이미 빠졌다) */
export function dropAvatar(store: FileStore, avatarId: string | null) {
  if (avatarId) store.delete(avatarKey(avatarId)).catch((err) => console.error("프로필 사진 삭제 실패", avatarId, (err as Error).message));
}

/** 내 프로필이 바뀌면 내가 속한 팀 화면(팀원 목록 등)에 알린다 */
function announce(repo: Repo, user: UserRow) {
  for (const teamId of repo.userTeamIds(user.id)) publish(teamId, "team", {}, user.id);
}

export function profileRouter(repo: Repo, store: FileStore): Router {
  const r = Router();

  r.patch("/", (req, res) => {
    const user = requireUser(req);
    const body = z
      .object({
        name: z.string().trim().min(1, "이름을 입력하세요.").max(40).optional(),
        emoji: emoji.optional(),
        bg: profileColor.optional(),
        color: profileColor.optional(),
      })
      .parse(req.body);
    if (body.name) repo.setName(user.id, body.name);
    repo.setUserLook(user.id, { emoji: body.emoji, bg: body.bg, color: body.color });
    announce(repo, user);
    res.json(sessionInfo(repo, repo.getUser(user.id)!));
  });

  r.post("/avatar", avatarPrecheck, readAvatarBody, async (req, res) => {
    const user = req.user!;
    const id = await storeAvatar(store, req.body);
    dropAvatar(store, repo.setUserAvatar(user.id, id));
    announce(repo, user);
    res.json(sessionInfo(repo, repo.getUser(user.id)!));
  });

  r.delete("/avatar", (req, res) => {
    const user = requireUser(req);
    dropAvatar(store, repo.setUserAvatar(user.id, null));
    announce(repo, user);
    res.json(sessionInfo(repo, repo.getUser(user.id)!));
  });

  return r;
}

/** /api/avatars/<id>.webp — 주소가 사진마다 달라서(바꾸면 새 id) 브라우저가 오래 캐시해도 된다 */
export function avatarsRouter(repo: Repo, store: FileStore): Router {
  const r = Router();
  r.get("/:name", async (req, res) => {
    const user = requireUser(req);
    const m = /^([A-Za-z0-9_-]{4,40})\.webp$/.exec(String(req.params.name));
    if (!m || !repo.canSeeAvatar(user.id, m[1])) throw new HttpError(404, "사진을 찾을 수 없어요.", "not_found");
    const etag = `"${m[1]}"`;
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
    const obj = await store.get(avatarKey(m[1]));
    if (!obj) throw new HttpError(404, "사진을 찾을 수 없어요.", "not_found");
    res.type("image/webp").send(obj.data);
  });
  return r;
}
