// 데이터 접근 계층 — 모든 쿼리는 팀(team_id) 범위로 제한한다.

import fs from "node:fs";
import path from "node:path";
import type { FeedbackItem, FeedbackKind } from "../shared/feedback";
import type {
  ActivityItem,
  AssignmentState,
  CaseStudy,
  DocActivity,
  DocActivityItem,
  DocSettings,
  DocumentData,
  DocumentSummary,
  InviteInfo,
  Member,
  Reference,
  Role,
  TeamDetail,
  TeamSummary,
  UserInfo,
  VersionInfo,
} from "../shared/types";
import { fileThumbUrl } from "../shared/files";
import type { DocContent } from "../shared/collab";
import { randomColor, randomUserLook, teamProfileOf, userProfileOf, type ProfileColor } from "../shared/profile";
import { withUnclassified } from "../shared/tags";
import { urlKey } from "../shared/urlKey";
import { defaultSettings } from "../src/lib/defaults";
import { ADMIN_EMAILS, auth, DATA_DIR } from "./config";
import { type Database, newId, now, parseJson } from "./db";
import { randomToken, sha256 } from "./security";

export interface UserRow {
  id: string;
  email: string | null;
  name: string;
  password_hash: string | null;
  email_verified_at: number | null;
  failed_logins: number;
  locked_until: number | null;
  created_at: number;
  last_login_at: number | null;
  avatar_id: string | null;
  avatar_emoji: string | null;
  avatar_bg: string | null;
  color: string | null;
}

/** 프로필 사진 저장소 키 — 팀 파일(<팀ID>/…)과 겹치지 않는 avatars/ 아래 */
export const avatarKey = (avatarId: string) => `avatars/${avatarId}.webp`;

const DAY = 24 * 60 * 60 * 1000;
/** 같은 사람이 이 시간 안에 이어서 고치면 버전 기록 한 줄로 */
export const VERSION_BURST_MS = 60_000;
/** 같은 사람이 같은 페이지에서 이 시간 안에 한 수정은 활동 기록 한 줄로 */
export const ACTIVITY_MERGE_MS = 2 * 60_000;

/** 활동 항목 합치기 — 같은 요소 · 같은 동작은 한 번만, 최근 것이 앞에 */
export function mergeActivityItems(prev: DocActivityItem[], next: DocActivityItem[]): DocActivityItem[] {
  const key = (i: DocActivityItem) => `${i.el ?? ""}|${i.label}|${i.action}`;
  const out = new Map<string, DocActivityItem>();
  for (const i of [...next].reverse()) out.set(key(i), i);
  for (const i of prev) if (!out.has(key(i))) out.set(key(i), i);
  return [...out.values()].slice(0, 30);
}

/** 관리자: ADMIN_EMAILS 에 있는 메일이면서 메일 인증을 마친 계정 */
export function isAdminUser(u: Pick<UserRow, "email" | "email_verified_at">): boolean {
  return !!u.email && !!u.email_verified_at && ADMIN_EMAILS.includes(u.email.toLowerCase());
}

/** 로그인 상태 유지를 끈 세션: 무활동 12시간 / 최대 1일 */
export const BROWSER_SESSION_IDLE = 12 * 60 * 60 * 1000;
export const BROWSER_SESSION_MAX = 24 * 60 * 60 * 1000;

export class Repo {
  constructor(readonly db: Database) {}

  // ─── users ────────────────────────────────────────────────

  getUser(id: string) {
    return this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", id);
  }

  findUserByEmail(email: string) {
    return this.db.get<UserRow>("SELECT * FROM users WHERE email = ? COLLATE NOCASE", email.trim());
  }

  createUser(input: { email: string | null; name: string; passwordHash?: string | null; verified: boolean }): UserRow {
    return this.db.tx(() => {
      const id = newId("u");
      const t = now();
      // 가입하면 기본 이모지 · 배경색 · 사용자 고유 색을 무작위로 정한다 (내 계정에서 바꿀 수 있음)
      const look = randomUserLook();
      this.db.run(
        "INSERT INTO users (id, email, name, password_hash, email_verified_at, created_at, avatar_emoji, avatar_bg, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        input.email?.trim().toLowerCase() ?? null,
        input.name.trim(),
        input.passwordHash ?? null,
        input.verified ? t : null,
        t,
        look.emoji,
        look.bg,
        look.color,
      );
      const teamId = this.createTeam(`${input.name.trim()}의 작업공간`, id, true);
      this.importLegacyOnce(teamId, id);
      return this.getUser(id)!;
    });
  }

  userInfo(u: UserRow): UserInfo {
    const providers = this.db.all<{ provider: string }>("SELECT provider FROM identities WHERE user_id = ?", u.id).map((r) => r.provider);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      emailVerified: !!u.email_verified_at,
      hasPassword: !!u.password_hash,
      providers,
      isAdmin: isAdminUser(u),
      createdAt: u.created_at,
      profile: userProfileOf(u.id, u),
    };
  }

  // ─── 프로필 ───────────────────────────────────────────────

  /** 기본 이모지 · 이모지 배경색 · 사용자 고유 색 (값 검사는 라우트에서) */
  setUserLook(userId: string, look: { emoji?: string; bg?: ProfileColor; color?: ProfileColor }) {
    this.db.run(
      "UPDATE users SET avatar_emoji = COALESCE(?, avatar_emoji), avatar_bg = COALESCE(?, avatar_bg), color = COALESCE(?, color) WHERE id = ?",
      look.emoji ?? null,
      look.bg ?? null,
      look.color ?? null,
      userId,
    );
  }

  /** 프로필 사진 바꾸기 · 지우기(null) — 이전 사진 id 를 돌려준다 (저장소에서 지우라고) */
  setUserAvatar(userId: string, avatarId: string | null): string | null {
    return this.db.tx(() => {
      const old = this.getUser(userId)?.avatar_id ?? null;
      this.db.run("UPDATE users SET avatar_id = ? WHERE id = ?", avatarId, userId);
      return old;
    });
  }

  setTeamColor(teamId: string, color: ProfileColor) {
    this.db.run("UPDATE teams SET color = ? WHERE id = ?", color, teamId);
  }

  setTeamAvatar(teamId: string, avatarId: string | null): string | null {
    return this.db.tx(() => {
      const old = this.getTeam(teamId)?.avatar_id ?? null;
      this.db.run("UPDATE teams SET avatar_id = ? WHERE id = ?", avatarId, teamId);
      return old;
    });
  }

  /**
   * 이 사진을 볼 수 있는지 — 개인 사진: 본인 또는 같은 팀 사람, 팀 사진: 그 팀 멤버.
   * 없는 사진과 볼 수 없는 사진을 구별하지 않는다 (있는지조차 알려 주지 않게)
   */
  canSeeAvatar(viewerId: string, avatarId: string): boolean {
    const owner = this.db.get<{ id: string }>("SELECT id FROM users WHERE avatar_id = ?", avatarId);
    if (owner) {
      if (owner.id === viewerId) return true;
      return !!this.db.get("SELECT 1 FROM memberships a JOIN memberships b ON a.team_id = b.team_id WHERE a.user_id = ? AND b.user_id = ? LIMIT 1", viewerId, owner.id);
    }
    const team = this.db.get<{ id: string }>("SELECT id FROM teams WHERE avatar_id = ?", avatarId);
    return !!team && !!this.getRole(team.id, viewerId);
  }

  /** 내가 속한 팀 — 프로필을 바꾸면 팀원 화면에 알린다 */
  userTeamIds(userId: string): string[] {
    return this.db.all<{ team_id: string }>("SELECT team_id FROM memberships WHERE user_id = ?", userId).map((r) => r.team_id);
  }

  allAvatarKeys(): string[] {
    return this.db
      .all<{ avatar_id: string }>("SELECT avatar_id FROM users WHERE avatar_id IS NOT NULL UNION ALL SELECT avatar_id FROM teams WHERE avatar_id IS NOT NULL")
      .map((r) => avatarKey(r.avatar_id));
  }

  /** 이 기능 전에 만든 계정 · 팀(또는 목록에서 빠진 값)에 무작위 기본값 — 서버 시작 시 한 번 */
  fillProfiles(rand: () => number = Math.random): { users: number; teams: number } {
    return this.db.tx(() => {
      const users = this.db.all<{ id: string }>("SELECT id FROM users WHERE avatar_emoji IS NULL OR avatar_bg IS NULL OR color IS NULL");
      for (const u of users) {
        const look = randomUserLook(rand);
        this.db.run(
          "UPDATE users SET avatar_emoji = COALESCE(avatar_emoji, ?), avatar_bg = COALESCE(avatar_bg, ?), color = COALESCE(color, ?) WHERE id = ?",
          look.emoji,
          look.bg,
          look.color,
          u.id,
        );
      }
      const teams = this.db.all<{ id: string }>("SELECT id FROM teams WHERE color IS NULL");
      for (const t of teams) this.db.run("UPDATE teams SET color = ? WHERE id = ?", randomColor(rand), t.id);
      return { users: users.length, teams: teams.length };
    });
  }

  markVerified(userId: string) {
    this.db.run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?", now(), userId);
  }

  setPassword(userId: string, hash: string) {
    this.db.run("UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?", hash, userId);
  }

  setName(userId: string, name: string) {
    this.db.run("UPDATE users SET name = ? WHERE id = ?", name.trim(), userId);
  }

  recordLoginFailure(userId: string) {
    const u = this.getUser(userId);
    if (!u) return;
    const fails = u.failed_logins + 1;
    // 5회 실패마다 잠금 시간을 늘린다 (5회: 1분, 10회: 5분, 15회 이상: 30분)
    const lock = fails >= 15 ? 30 : fails >= 10 ? 5 : fails >= 5 ? 1 : 0;
    this.db.run("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?", fails, lock ? now() + lock * 60_000 : u.locked_until, userId);
  }

  recordLoginSuccess(userId: string) {
    this.db.run("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", now(), userId);
  }

  findIdentity(provider: string, providerUserId: string) {
    return this.db.get<{ user_id: string }>("SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?", provider, providerUserId);
  }

  linkIdentity(provider: string, providerUserId: string, userId: string, email: string | null) {
    this.db.run(
      "INSERT OR IGNORE INTO identities (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)",
      provider,
      providerUserId,
      userId,
      email,
      now(),
    );
  }

  // ─── sessions ─────────────────────────────────────────────

  /**
   * persistent=false (로그인 상태 유지 안 함): 브라우저를 닫으면 사라지는 쿠키와 함께 쓰고,
   * 서버에서도 무활동 BROWSER_SESSION_IDLE, 최대 BROWSER_SESSION_MAX 뒤 만료한다.
   */
  createSession(userId: string, ip?: string, userAgent?: string, persistent = true): string {
    const token = randomToken(32);
    const t = now();
    this.db.run(
      "INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent, persistent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      sha256(token),
      userId,
      t,
      t + (persistent ? auth.sessionDays * DAY : BROWSER_SESSION_IDLE),
      t,
      ip ?? null,
      userAgent?.slice(0, 300) ?? null,
      persistent ? 1 : 0,
    );
    return token;
  }

  /** 유효한 세션이면 사용자를 돌려주고, 사용 중이면 만료를 연장한다 */
  resolveSession(token: string): UserRow | undefined {
    const hash = sha256(token);
    const s = this.db.get<{ user_id: string; created_at: number; expires_at: number; last_seen_at: number; persistent: number }>(
      "SELECT user_id, created_at, expires_at, last_seen_at, persistent FROM sessions WHERE id_hash = ?",
      hash,
    );
    const t = now();
    if (!s) return undefined;
    const maxAge = s.persistent ? auth.sessionMaxDays * DAY : BROWSER_SESSION_MAX;
    if (s.expires_at < t || s.created_at + maxAge < t) {
      this.db.run("DELETE FROM sessions WHERE id_hash = ?", hash);
      return undefined;
    }
    // 활동이 있으면 만료를 뒤로 민다 (브라우저 세션은 10분, 유지 세션은 1시간 단위로 갱신)
    const refreshEvery = s.persistent ? 60 * 60 * 1000 : 10 * 60 * 1000;
    if (t - s.last_seen_at > refreshEvery) {
      const idle = s.persistent ? auth.sessionDays * DAY : BROWSER_SESSION_IDLE;
      this.db.run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?", t, t + idle, hash);
    }
    return this.getUser(s.user_id);
  }

  deleteSession(token: string) {
    this.db.run("DELETE FROM sessions WHERE id_hash = ?", sha256(token));
  }

  /** 세션이 아직 유효한지만 확인 (만료 연장 없음 — 실시간 연결 점검용) */
  sessionAlive(token: string): boolean {
    const t = now();
    return !!this.db.get("SELECT 1 FROM sessions WHERE id_hash = ? AND expires_at > ? AND created_at > ?", sha256(token), t, t - auth.sessionMaxDays * DAY);
  }

  deleteUserSessions(userId: string, exceptToken?: string): number {
    if (exceptToken) return this.db.run("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?", userId, sha256(exceptToken)).changes;
    return this.db.run("DELETE FROM sessions WHERE user_id = ?", userId).changes;
  }

  purgeExpired() {
    const t = now();
    this.db.run("DELETE FROM sessions WHERE expires_at < ?", t);
    this.db.run("DELETE FROM email_tokens WHERE expires_at < ?", t - DAY);
  }

  // ─── email tokens (인증·재설정) ──────────────────────────────

  createEmailToken(userId: string, purpose: "verify" | "reset", ttlMs: number): string {
    const token = randomToken(32);
    this.db.run("DELETE FROM email_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL", userId, purpose);
    this.db.run("INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, purpose, now() + ttlMs);
    return token;
  }

  /** 한 번만 쓸 수 있게 소비하고 사용자 id 를 돌려준다 */
  consumeEmailToken(token: string, purpose: "verify" | "reset"): string | null {
    const hash = sha256(token);
    const row = this.db.get<{ user_id: string }>(
      "SELECT user_id FROM email_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?",
      hash,
      purpose,
      now(),
    );
    if (!row) return null;
    const r = this.db.run("UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", now(), hash);
    return r.changes ? row.user_id : null;
  }

  // ─── teams ────────────────────────────────────────────────

  createTeam(name: string, ownerId: string, personal = false, defaults?: DocSettings): string {
    const id = newId("t");
    const t = now();
    this.db.run(
      "INSERT INTO teams (id, name, personal, defaults_json, created_by, created_at, color) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      name.trim(),
      personal,
      JSON.stringify(defaults ?? defaultSettings()),
      ownerId,
      t,
      // 팀마다 자동으로 정해지는 색 — 팀 기본 이미지(색 + 이름 첫 글자), 팀 설정에서 바꿀 수 있음
      randomColor(),
    );
    this.db.run("INSERT INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", id, ownerId, t);
    return id;
  }

  listTeams(userId: string): TeamSummary[] {
    return this.db
      .all<{ id: string; name: string; role: Role; personal: number; members: number; color: string | null; avatar_id: string | null }>(
        `SELECT t.id, t.name, m.role, t.personal, t.color, t.avatar_id, (SELECT COUNT(*) FROM memberships x WHERE x.team_id = t.id) AS members
         FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.personal DESC, t.created_at`,
        userId,
      )
      .map((r) => ({ id: r.id, name: r.name, role: r.role, personal: !!r.personal, memberCount: Number(r.members), profile: teamProfileOf(r.id, r) }));
  }

  getRole(teamId: string, userId: string): Role | undefined {
    return this.db.get<{ role: Role }>("SELECT role FROM memberships WHERE team_id = ? AND user_id = ?", teamId, userId)?.role;
  }

  getTeam(teamId: string) {
    return this.db.get<{ id: string; name: string; personal: number; defaults_json: string; created_at: number; color: string | null; avatar_id: string | null }>(
      "SELECT * FROM teams WHERE id = ?",
      teamId,
    );
  }

  teamDefaults(teamId: string): DocSettings {
    const base = defaultSettings();
    const saved = parseJson<Partial<DocSettings>>(this.getTeam(teamId)?.defaults_json, {});
    return { ...base, ...saved, footer: { ...base.footer, ...saved.footer }, header: { ...base.header, ...saved.header }, typography: { ...base.typography, ...saved.typography } };
  }

  members(teamId: string): Member[] {
    return this.db
      .all<{ user_id: string; name: string; email: string | null; role: Role; joined_at: number; color: string | null; avatar_emoji: string | null; avatar_bg: string | null; avatar_id: string | null }>(
        `SELECT m.user_id, u.name, u.email, m.role, m.joined_at, u.color, u.avatar_emoji, u.avatar_bg, u.avatar_id FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.team_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, m.joined_at`,
        teamId,
      )
      .map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, joinedAt: r.joined_at, profile: userProfileOf(r.user_id, r) }));
  }

  teamDetail(teamId: string, role: Role): TeamDetail {
    const t = this.getTeam(teamId)!;
    const members = this.members(teamId);
    return {
      id: t.id,
      name: t.name,
      role,
      personal: !!t.personal,
      memberCount: members.length,
      profile: teamProfileOf(t.id, t),
      members,
      defaults: this.teamDefaults(teamId),
      createdAt: t.created_at,
    };
  }

  renameTeam(teamId: string, name: string) {
    this.db.run("UPDATE teams SET name = ? WHERE id = ?", name.trim(), teamId);
  }

  setDefaults(teamId: string, defaults: DocSettings) {
    this.db.run("UPDATE teams SET defaults_json = ? WHERE id = ?", JSON.stringify(defaults), teamId);
  }

  deleteTeam(teamId: string) {
    this.db.run("DELETE FROM teams WHERE id = ?", teamId);
  }

  addMember(teamId: string, userId: string, role: Role): boolean {
    const r = this.db.run("INSERT OR IGNORE INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)", teamId, userId, role, now());
    return r.changes > 0;
  }

  setRole(teamId: string, userId: string, role: Role) {
    this.db.run("UPDATE memberships SET role = ? WHERE team_id = ? AND user_id = ?", role, teamId, userId);
  }

  removeMember(teamId: string, userId: string) {
    this.db.run("DELETE FROM memberships WHERE team_id = ? AND user_id = ?", teamId, userId);
  }

  ownerCount(teamId: string): number {
    return Number(this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM memberships WHERE team_id = ? AND role = 'owner'", teamId)?.n ?? 0);
  }

  // ─── invites ──────────────────────────────────────────────

  createEmailInvite(teamId: string, email: string, role: Role, by: string): { id: string; token: string } {
    const id = newId("v");
    const token = randomToken(32);
    const t = now();
    // 같은 메일로 보낸 이전 초대는 무효화
    this.db.run("UPDATE invites SET revoked_at = ? WHERE team_id = ? AND kind = 'email' AND email = ? AND revoked_at IS NULL AND uses = 0", t, teamId, email);
    this.db.run(
      "INSERT INTO invites (id, team_id, kind, email, token_hash, role, created_by, created_at, expires_at, max_uses) VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?, 1)",
      id,
      teamId,
      email.trim().toLowerCase(),
      sha256(token),
      role,
      by,
      t,
      t + 7 * DAY,
    );
    return { id, token };
  }

  createCodeInvite(teamId: string, input: { code: string; passwordHash: string; role: Role; by: string; expiresAt: number; maxUses: number }): string {
    const id = newId("v");
    this.db.run(
      "INSERT INTO invites (id, team_id, kind, code, password_hash, role, created_by, created_at, expires_at, max_uses) VALUES (?, ?, 'code', ?, ?, ?, ?, ?, ?, ?)",
      id,
      teamId,
      input.code,
      input.passwordHash,
      input.role,
      input.by,
      now(),
      input.expiresAt,
      input.maxUses,
    );
    return id;
  }

  listInvites(teamId: string): InviteInfo[] {
    const t = now();
    return this.db
      .all<InviteRow & { creator: string | null }>(
        "SELECT i.*, u.name AS creator FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.team_id = ? ORDER BY i.created_at DESC LIMIT 100",
        teamId,
      )
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        email: r.email ?? undefined,
        code: r.code ?? undefined,
        role: r.role,
        createdByName: r.creator ?? undefined,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        maxUses: r.max_uses,
        uses: r.uses,
        status: inviteStatus(r, t),
      }));
  }

  revokeInvite(teamId: string, id: string): boolean {
    return this.db.run("UPDATE invites SET revoked_at = ? WHERE id = ? AND team_id = ? AND revoked_at IS NULL", now(), id, teamId).changes > 0;
  }

  inviteByToken(token: string) {
    return this.db.get<InviteRow>("SELECT * FROM invites WHERE token_hash = ? AND kind = 'email'", sha256(token));
  }

  inviteByCode(code: string) {
    return this.db.get<InviteRow>("SELECT * FROM invites WHERE code = ? AND kind = 'code'", code.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""));
  }

  inviteFailed(id: string) {
    this.db.run("UPDATE invites SET failed_attempts = failed_attempts + 1 WHERE id = ?", id);
  }

  /** 사용 횟수를 원자적으로 올린다 (동시에 여러 명이 써도 max_uses 를 넘지 않음) */
  useInvite(id: string): boolean {
    return this.db.run("UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses AND revoked_at IS NULL AND expires_at > ?", id, now()).changes > 0;
  }

  // ─── activity & security log ──────────────────────────────

  log(teamId: string, userId: string | null, action: string, summary: string, target?: { type: string; id: string }) {
    this.db.run(
      "INSERT INTO activity (team_id, user_id, action, target_type, target_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      teamId,
      userId,
      action,
      target?.type ?? null,
      target?.id ?? null,
      summary.slice(0, 500),
      now(),
    );
  }

  activity(teamId: string, limit = 100, before?: number): ActivityItem[] {
    return this.db
      .all<{
        id: number;
        user_id: string | null;
        name: string | null;
        action: string;
        target_type: string | null;
        target_id: string | null;
        summary: string;
        created_at: number;
        color: string | null;
        avatar_emoji: string | null;
        avatar_bg: string | null;
        avatar_id: string | null;
      }>(
        `SELECT a.id, a.user_id, u.name, a.action, a.target_type, a.target_id, a.summary, a.created_at, u.color, u.avatar_emoji, u.avatar_bg, u.avatar_id
         FROM activity a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.team_id = ? AND (? IS NULL OR a.id < ?) ORDER BY a.id DESC LIMIT ?`,
        teamId,
        before ?? null,
        before ?? null,
        Math.min(limit, 500),
      )
      .map((r) => ({
        id: Number(r.id),
        userId: r.name !== null && r.user_id ? r.user_id : undefined,
        userName: r.name ?? "(알 수 없음)",
        userProfile: r.name !== null && r.user_id ? userProfileOf(r.user_id, r) : undefined,
        action: r.action,
        targetType: r.target_type ?? undefined,
        targetId: r.target_id ?? undefined,
        summary: r.summary,
        createdAt: r.created_at,
      }));
  }

  security(event: string, userId: string | null, ip: string | undefined, detail = "") {
    this.db.run("INSERT INTO security_log (user_id, event, ip, detail, created_at) VALUES (?, ?, ?, ?, ?)", userId, event, ip ?? null, detail.slice(0, 500), now());
  }

  // ─── references ───────────────────────────────────────────

  private refSelect = `SELECT r.*, cu.name AS created_by_name, uu.name AS updated_by_name FROM refs r
    LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users uu ON uu.id = r.updated_by`;

  listRefs(teamId: string): Reference[] {
    return this.db.all<RefRow>(`${this.refSelect} WHERE r.team_id = ? ORDER BY r.created_at DESC`, teamId).map(rowToRef);
  }

  getRef(teamId: string, id: string): Reference | undefined {
    const r = this.db.get<RefRow>(`${this.refSelect} WHERE r.team_id = ? AND r.id = ?`, teamId, id);
    return r ? rowToRef(r) : undefined;
  }

  /** 같은 이미지가 이미 있는지 — 링크 그대로 저장한 것과 사본으로 저장한 것(원래 링크) 모두 본다 */
  findDuplicates(teamId: string, urls: string[]): Map<string, Reference> {
    const out = new Map<string, Reference>();
    for (const url of urls) {
      const k = urlKey(url);
      const r = this.db.get<RefRow>(`${this.refSelect} WHERE r.team_id = ? AND (r.url_key = ? OR r.original_key = ?) ORDER BY r.created_at LIMIT 1`, teamId, k, k);
      if (r) out.set(url, rowToRef(r));
    }
    return out;
  }

  insertRef(teamId: string, input: RefInput, userId: string): Reference {
    const id = newId("r");
    const t = now();
    this.db.run(
      `INSERT INTO refs (id, team_id, image_url, url_key, source_url, title, note, tags_json, case_id, kind, logo_label, width, height, source,
        created_by, created_at, updated_by, updated_at, file_id, original_url, original_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      teamId,
      input.imageUrl,
      urlKey(input.imageUrl),
      input.sourceUrl,
      input.title,
      input.note,
      JSON.stringify(withUnclassified(input.tags ?? [])),
      input.caseId && this.caseExists(teamId, input.caseId) ? input.caseId : null,
      input.kind ?? "image",
      input.logoLabel,
      input.width ? Math.round(input.width) : null,
      input.height ? Math.round(input.height) : null,
      input.source ?? "manual",
      userId,
      t,
      userId,
      t,
      input.fileId ?? null,
      input.originalUrl ?? null,
      input.originalUrl ? urlKey(input.originalUrl) : null,
    );
    return this.getRef(teamId, id)!;
  }

  updateRef(teamId: string, id: string, patch: Omit<Partial<RefInput>, "caseId"> & { caseId?: string | null }, userId: string): Reference | undefined {
    const cur = this.getRef(teamId, id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch } as Reference & { caseId?: string | null };
    if (patch.caseId !== undefined && patch.caseId !== null && !this.caseExists(teamId, patch.caseId)) next.caseId = undefined;
    this.db.run(
      `UPDATE refs SET image_url = ?, url_key = ?, source_url = ?, title = ?, note = ?, tags_json = ?, case_id = ?, kind = ?, logo_label = ?,
        width = ?, height = ?, file_id = ?, original_url = ?, original_key = ?, source = ?, updated_by = ?, updated_at = ? WHERE id = ? AND team_id = ?`,
      next.imageUrl,
      urlKey(next.imageUrl),
      next.sourceUrl,
      next.title,
      next.note,
      JSON.stringify(withUnclassified(next.tags)),
      next.caseId ?? null,
      next.kind,
      next.logoLabel,
      next.width ? Math.round(next.width) : null,
      next.height ? Math.round(next.height) : null,
      next.fileId ?? null,
      next.originalUrl ?? null,
      next.originalUrl ? urlKey(next.originalUrl) : null,
      next.source,
      userId,
      now(),
      id,
      teamId,
    );
    return this.getRef(teamId, id);
  }

  /** 지운 레퍼런스가 쓰던 저장 파일 id 도 돌려준다 (더 쓰는 곳이 없으면 releaseFiles 로 지운다) */
  deleteRefs(teamId: string, ids: string[]): { count: number; fileIds: string[] } {
    let count = 0;
    const fileIds = new Set<string>();
    for (const id of ids) {
      const row = this.db.get<{ file_id: string | null }>("SELECT file_id FROM refs WHERE id = ? AND team_id = ?", id, teamId);
      if (!row) continue;
      count += this.db.run("DELETE FROM refs WHERE id = ? AND team_id = ?", id, teamId).changes;
      if (row.file_id) fileIds.add(row.file_id);
    }
    return { count, fileIds: [...fileIds] };
  }

  // ─── files (올린 이미지 · 링크 사본) ─────────────────────────

  insertFile(f: Omit<FileRow, "created_at">): FileRow {
    const row: FileRow = { ...f, created_at: now() };
    this.db.run(
      `INSERT INTO files (id, team_id, key, thumb_key, bytes, width, height, hash, origin, original_url, name, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.team_id,
      row.key,
      row.thumb_key,
      row.bytes,
      row.width,
      row.height,
      row.hash,
      row.origin,
      row.original_url,
      row.name,
      row.created_by,
      row.created_at,
    );
    return row;
  }

  getFile(id: string): FileRow | undefined {
    return this.db.get<FileRow>("SELECT * FROM files WHERE id = ?", id);
  }

  /** 같은 팀에 똑같은 파일(원본 해시)이 이미 있으면 다시 저장하지 않는다 */
  findFileByHash(teamId: string, hash: string): FileRow | undefined {
    return this.db.get<FileRow>("SELECT * FROM files WHERE team_id = ? AND hash = ? ORDER BY created_at LIMIT 1", teamId, hash);
  }

  /** 레퍼런스에 아직 안 붙은 파일을 다시 쓰면 정리 대상에서 빠지도록 시각을 새로 한다 */
  touchFile(id: string) {
    this.db.run("UPDATE files SET created_at = ? WHERE id = ?", now(), id);
  }

  storageUsage(teamId: string): { used: number; files: number } {
    const r = this.db.get<{ used: number | null; files: number }>("SELECT SUM(bytes) AS used, COUNT(*) AS files FROM files WHERE team_id = ?", teamId);
    return { used: r?.used ?? 0, files: r?.files ?? 0 };
  }

  fileInUse(fileId: string): boolean {
    return !!this.db.get("SELECT 1 FROM refs WHERE file_id = ? LIMIT 1", fileId);
  }

  /** 어떤 레퍼런스도 쓰지 않는 파일의 기록을 지우고, 저장소에서 지울 키를 돌려준다 */
  releaseFiles(fileIds: string[]): string[] {
    const keys: string[] = [];
    for (const id of fileIds) {
      if (this.fileInUse(id)) continue;
      const f = this.getFile(id);
      if (!f) continue;
      this.db.run("DELETE FROM files WHERE id = ?", id);
      keys.push(f.key, f.thumb_key);
    }
    return keys;
  }

  /** 올려 두고 레퍼런스로 저장하지 않은 채 오래된 파일 */
  staleFileIds(olderThanMs: number): string[] {
    return this.db
      .all<{ id: string }>("SELECT f.id FROM files f WHERE f.created_at < ? AND NOT EXISTS (SELECT 1 FROM refs r WHERE r.file_id = f.id)", now() - olderThanMs)
      .map((r) => r.id);
  }

  /** 이 파일들을 쓰는 문서 (페이지 · 임시 보관함) — 레퍼런스를 지우기 전에 알려 준다 */
  docsUsingFiles(teamId: string, fileIds: string[]): { id: string; title: string }[] {
    if (!fileIds.length) return [];
    const docs = this.db.all<{ id: string; title: string; data_json: string }>("SELECT id, title, data_json FROM documents WHERE team_id = ?", teamId);
    return docs.filter((d) => fileIds.some((f) => d.data_json.includes(`/api/files/${f}.`))).map((d) => ({ id: d.id, title: d.title }));
  }

  teamFileKeys(teamId: string): string[] {
    return this.db.all<{ key: string; thumb_key: string }>("SELECT key, thumb_key FROM files WHERE team_id = ?", teamId).flatMap((r) => [r.key, r.thumb_key]);
  }

  allFileKeys(): string[] {
    return this.db.all<{ key: string; thumb_key: string }>("SELECT key, thumb_key FROM files").flatMap((r) => [r.key, r.thumb_key]);
  }

  // ─── cases ────────────────────────────────────────────────

  private caseSelect = `SELECT c.*, cu.name AS created_by_name, uu.name AS updated_by_name FROM cases c
    LEFT JOIN users cu ON cu.id = c.created_by LEFT JOIN users uu ON uu.id = c.updated_by`;

  caseExists(teamId: string, id: string): boolean {
    return !!this.db.get("SELECT 1 FROM cases WHERE id = ? AND team_id = ?", id, teamId);
  }

  listCases(teamId: string): CaseStudy[] {
    return this.db.all<CaseRow>(`${this.caseSelect} WHERE c.team_id = ? ORDER BY c.created_at DESC`, teamId).map(rowToCase);
  }

  getCase(teamId: string, id: string): CaseStudy | undefined {
    const r = this.db.get<CaseRow>(`${this.caseSelect} WHERE c.team_id = ? AND c.id = ?`, teamId, id);
    return r ? rowToCase(r) : undefined;
  }

  insertCase(teamId: string, input: CaseInput, userId: string): CaseStudy {
    const id = newId("c");
    const t = now();
    this.db.run(
      "INSERT INTO cases (id, team_id, name, subtitle, highlight, description, tags_json, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      teamId,
      input.name,
      input.subtitle,
      input.highlight,
      input.description,
      JSON.stringify(input.tags ?? []),
      userId,
      t,
      userId,
      t,
    );
    return this.getCase(teamId, id)!;
  }

  updateCase(teamId: string, id: string, patch: Partial<CaseInput>, userId: string): CaseStudy | undefined {
    const cur = this.getCase(teamId, id);
    if (!cur) return undefined;
    const n = { ...cur, ...patch };
    this.db.run(
      "UPDATE cases SET name = ?, subtitle = ?, highlight = ?, description = ?, tags_json = ?, updated_by = ?, updated_at = ? WHERE id = ? AND team_id = ?",
      n.name,
      n.subtitle,
      n.highlight,
      n.description,
      JSON.stringify(n.tags),
      userId,
      now(),
      id,
      teamId,
    );
    return this.getCase(teamId, id);
  }

  deleteCase(teamId: string, id: string) {
    this.db.tx(() => {
      this.db.run("UPDATE refs SET case_id = NULL WHERE team_id = ? AND case_id = ?", teamId, id);
      this.db.run("DELETE FROM cases WHERE id = ? AND team_id = ?", id, teamId);
    });
  }

  /** 태그 이름 변경/병합/삭제 (to 가 빈 문자열이면 삭제) */
  renameTag(teamId: string, from: string, to: string, userId: string) {
    this.mergeTags(teamId, [from], to, userId);
  }

  /**
   * 여러 태그를 하나로 합친다 (동의어 병합). to 가 빈 문자열이면 모두 삭제.
   * 레퍼런스·케이스 전체를 한 트랜잭션에서 바꾼다.
   */
  mergeTags(teamId: string, from: string[], to: string, userId: string) {
    const lowers = new Set(from.map((f) => f.toLowerCase()));
    const target = to.trim();
    const apply = (tags: string[]) => {
      if (!tags.some((t) => lowers.has(t.toLowerCase()))) return null;
      const rest = tags.filter((t) => !lowers.has(t.toLowerCase()));
      return target && !rest.some((t) => t.toLowerCase() === target.toLowerCase()) ? [...rest, target] : rest;
    };
    this.db.tx(() => {
      const t = now();
      for (const r of this.db.all<{ id: string; tags_json: string }>("SELECT id, tags_json FROM refs WHERE team_id = ?", teamId)) {
        const next = apply(parseJson<string[]>(r.tags_json, []));
        // 태그를 지워서 하나도 안 남으면 '미분류', 새 이름을 받으면 '미분류'는 빠진다
        if (next) this.db.run("UPDATE refs SET tags_json = ?, updated_by = ?, updated_at = ? WHERE id = ?", JSON.stringify(withUnclassified(next)), userId, t, r.id);
      }
      for (const c of this.db.all<{ id: string; tags_json: string }>("SELECT id, tags_json FROM cases WHERE team_id = ?", teamId)) {
        const next = apply(parseJson<string[]>(c.tags_json, []));
        if (next) this.db.run("UPDATE cases SET tags_json = ?, updated_by = ?, updated_at = ? WHERE id = ?", JSON.stringify(next), userId, t, c.id);
      }
    });
  }

  // ─── documents ────────────────────────────────────────────

  listDocs(teamId: string): DocumentSummary[] {
    return this.db
      .all<{ id: string; title: string; query: string | null; page_count: number; cover: string | null; created_at: number; updated_at: number; cname: string | null; uname: string | null }>(
        `SELECT d.id, d.title, d.query, d.page_count, d.cover, d.created_at, d.updated_at, cu.name AS cname, uu.name AS uname
         FROM documents d LEFT JOIN users cu ON cu.id = d.created_by LEFT JOIN users uu ON uu.id = d.updated_by
         WHERE d.team_id = ? ORDER BY d.updated_at DESC`,
        teamId,
      )
      .map((r) => ({
        id: r.id,
        title: r.title,
        query: r.query ?? undefined,
        pageCount: Number(r.page_count),
        cover: r.cover ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        createdByName: r.cname ?? undefined,
        updatedByName: r.uname ?? undefined,
      }));
  }

  docTeam(docId: string): string | undefined {
    return this.db.get<{ team_id: string }>("SELECT team_id FROM documents WHERE id = ?", docId)?.team_id;
  }

  getDoc(teamId: string, id: string): DocumentData | undefined {
    const r = this.db.get<DocRow & { cname: string | null; uname: string | null }>(
      `SELECT d.*, cu.name AS cname, uu.name AS uname FROM documents d LEFT JOIN users cu ON cu.id = d.created_by
       LEFT JOIN users uu ON uu.id = d.updated_by WHERE d.team_id = ? AND d.id = ?`,
      teamId,
      id,
    );
    if (!r) return undefined;
    const data = parseJson<Pick<DocumentData, "settings" | "pages" | "tray">>(r.data_json, { settings: defaultSettings(), pages: [] });
    return {
      id: r.id,
      teamId: r.team_id,
      title: r.title,
      query: r.query ?? undefined,
      settings: data.settings,
      pages: data.pages,
      tray: data.tray ?? [],
      version: Number(r.version),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      createdBy: r.created_by ?? undefined,
      createdByName: r.cname ?? undefined,
      updatedByName: r.uname ?? undefined,
    };
  }

  createDoc(teamId: string, doc: DocumentData, userId: string): DocumentData {
    const id = newId("d");
    const t = now();
    const data = JSON.stringify({ settings: doc.settings, pages: doc.pages, tray: doc.tray ?? [] });
    this.db.tx(() => {
      this.db.run(
        "INSERT INTO documents (id, team_id, title, query, data_json, version, cover, page_count, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)",
        id,
        teamId,
        doc.title,
        doc.query,
        data,
        coverOf(doc),
        doc.pages.length,
        userId,
        t,
        userId,
        t,
      );
      this.db.run("INSERT INTO document_versions (doc_id, version, title, data_json, updated_by, updated_at) VALUES (?, 1, ?, ?, ?, ?)", id, doc.title, data, userId, t);
    });
    return this.getDoc(teamId, id)!;
  }

  /**
   * 저장 — 다른 사람이 먼저 저장했으면(baseVersion 이 현재 버전보다 오래됨) 3-way 병합한다.
   * 병합했으면 병합 결과를 돌려주어 클라이언트가 반영하게 한다.
   */
  /** 공동 편집 방이 쓰는 문서 정보 — Yjs 상태(없으면 null), JSON, 담당자만 편집 */
  docForCollab(docId: string) {
    const r = this.db.get<{ team_id: string; title: string; query: string | null; data_json: string; ydoc: Uint8Array | null; version: number; created_by: string | null; assign_strict: number }>(
      "SELECT team_id, title, query, data_json, ydoc, version, created_by, assign_strict FROM documents WHERE id = ?",
      docId,
    );
    if (!r) return undefined;
    const data = parseJson<Pick<DocumentData, "settings" | "pages" | "tray">>(r.data_json, { settings: defaultSettings(), pages: [] });
    const content: DocContent = { title: r.title, ...(r.query != null ? { query: r.query } : {}), settings: data.settings, pages: data.pages, tray: data.tray ?? [] };
    return { teamId: r.team_id, content, ydoc: r.ydoc, version: Number(r.version), createdBy: r.created_by, strict: !!r.assign_strict };
  }

  /** Yjs 상태만 저장 (처음 JSON 에서 만들었을 때 — 모든 사람이 같은 출발점을 쓰도록 바로 남긴다) */
  saveYState(docId: string, state: Uint8Array) {
    this.db.run("UPDATE documents SET ydoc = ? WHERE id = ?", state, docId);
  }

  /**
   * 공동 편집 방의 내용을 저장 — data_json(목록 · 뷰어 · 내보내기용) + Yjs 상태 + 버전 기록.
   * 버전 기록: 같은 사람이 1분 안에 이어서 고치면 마지막 버전을 덮어쓰고, 아니면 새 버전 (직접 저장 · 복원은 늘 새 버전).
   */
  persistCollab(docId: string, content: DocContent, state: Uint8Array, userId: string | null, opts: { forceVersion?: boolean } = {}): number | undefined {
    return this.db.tx(() => {
      const cur = this.db.get<{ version: number }>("SELECT version FROM documents WHERE id = ?", docId);
      if (!cur) return undefined;
      const t = now();
      const data = JSON.stringify({ settings: content.settings, pages: content.pages, tray: content.tray ?? [] });
      let version = Number(cur.version);
      if (userId) {
        const last = this.db.get<{ version: number; updated_by: string | null; updated_at: number }>(
          "SELECT version, updated_by, updated_at FROM document_versions WHERE doc_id = ? ORDER BY version DESC LIMIT 1",
          docId,
        );
        // (처음 만든 버전 v1 은 덮어쓰지 않는다 — 원본으로 복원할 수 있게)
        if (!opts.forceVersion && last && Number(last.version) > 1 && last.updated_by === userId && t - last.updated_at < VERSION_BURST_MS && Number(last.version) === version) {
          this.db.run("UPDATE document_versions SET title = ?, data_json = ?, updated_at = ? WHERE doc_id = ? AND version = ?", content.title, data, t, docId, last.version);
        } else {
          version += 1;
          this.db.run("INSERT INTO document_versions (doc_id, version, title, data_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)", docId, version, content.title, data, userId, t);
          if (version % 25 === 0) this.pruneVersions(docId);
        }
        this.db.run(
          "UPDATE documents SET title = ?, query = ?, data_json = ?, version = ?, cover = ?, page_count = ?, ydoc = ?, updated_by = ?, updated_at = ? WHERE id = ?",
          content.title,
          content.query ?? null,
          data,
          version,
          coverOf(content as DocumentData),
          content.pages.length,
          state,
          userId,
          t,
          docId,
        );
      } else {
        this.db.run(
          "UPDATE documents SET title = ?, query = ?, data_json = ?, cover = ?, page_count = ?, ydoc = ? WHERE id = ?",
          content.title,
          content.query ?? null,
          data,
          coverOf(content as DocumentData),
          content.pages.length,
          state,
          docId,
        );
      }
      return version;
    });
  }

  /** 예전 버전의 내용 (복원 · 예전 방식 저장의 병합 기준) */
  versionContent(docId: string, version: number): DocContent | undefined {
    const r = this.db.get<{ title: string; data_json: string }>("SELECT title, data_json FROM document_versions WHERE doc_id = ? AND version = ?", docId, version);
    if (!r) return undefined;
    const data = parseJson<Pick<DocumentData, "settings" | "pages" | "tray">>(r.data_json, { settings: defaultSettings(), pages: [] });
    return { title: r.title, ...data, tray: data.tray ?? [] };
  }

  // ─── 페이지 맡기 ──────────────────────────────────────────

  /** 담당자 — 팀을 떠난 사람은 빼고 */
  assignments(docId: string): AssignmentState {
    const doc = this.db.get<{ team_id: string; assign_strict: number }>("SELECT team_id, assign_strict FROM documents WHERE id = ?", docId);
    if (!doc) return { assignments: {}, strict: false };
    const rows = this.db.all<{ page_id: string; user_id: string; name: string; assigned_at: number; color: string | null; avatar_emoji: string | null; avatar_bg: string | null; avatar_id: string | null }>(
      `SELECT a.page_id, a.user_id, u.name, a.assigned_at, u.color, u.avatar_emoji, u.avatar_bg, u.avatar_id
       FROM page_assignments a JOIN users u ON u.id = a.user_id JOIN memberships m ON m.user_id = a.user_id AND m.team_id = ?
       WHERE a.doc_id = ?`,
      doc.team_id,
      docId,
    );
    const assignments: AssignmentState["assignments"] = {};
    for (const r of rows) assignments[r.page_id] = { userId: r.user_id, name: r.name, profile: userProfileOf(r.user_id, r), assignedAt: r.assigned_at };
    return { assignments, strict: !!doc.assign_strict };
  }

  assignPage(docId: string, pageId: string, userId: string, by: string) {
    this.db.run(
      "INSERT INTO page_assignments (doc_id, page_id, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(doc_id, page_id) DO UPDATE SET user_id = excluded.user_id, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at",
      docId,
      pageId,
      userId,
      by,
      now(),
    );
  }

  unassignPage(docId: string, pageId: string): boolean {
    return this.db.run("DELETE FROM page_assignments WHERE doc_id = ? AND page_id = ?", docId, pageId).changes > 0;
  }

  setAssignStrict(docId: string, strict: boolean) {
    this.db.run("UPDATE documents SET assign_strict = ? WHERE id = ?", strict ? 1 : 0, docId);
  }

  /** 팀을 떠난 사람의 담당 해제 — 영향을 받은 문서 id */
  dropUserAssignments(teamId: string, userId: string): string[] {
    const docs = this.db
      .all<{ doc_id: string }>("SELECT DISTINCT a.doc_id FROM page_assignments a JOIN documents d ON d.id = a.doc_id WHERE d.team_id = ? AND a.user_id = ?", teamId, userId)
      .map((r) => r.doc_id);
    if (docs.length) this.db.run("DELETE FROM page_assignments WHERE user_id = ? AND doc_id IN (SELECT id FROM documents WHERE team_id = ?)", userId, teamId);
    return docs;
  }

  /** 없어진 페이지의 담당 정리 */
  pruneAssignments(docId: string, livePageIds: Set<string>) {
    const rows = this.db.all<{ page_id: string }>("SELECT page_id FROM page_assignments WHERE doc_id = ?", docId);
    for (const r of rows) if (!livePageIds.has(r.page_id)) this.db.run("DELETE FROM page_assignments WHERE doc_id = ? AND page_id = ?", docId, r.page_id);
  }

  // ─── 문서 활동 기록 (요소 단위) ───────────────────────────────

  /**
   * 같은 사람이 같은 페이지에서 2분 안에 한 수정은 그 사람의 그 페이지 마지막 줄에 합친다
   * (사이에 다른 사람 줄이 끼어도 — 목록은 마지막으로 고친 시각 순이라 합친 줄이 위로 올라간다)
   */
  recordDocActivity(docId: string, teamId: string, userId: string, pageId: string | null, items: DocActivityItem[], t = now()) {
    if (!items.length) return;
    const last = this.db.get<{ id: number; items_json: string }>(
      "SELECT id, items_json FROM doc_activity WHERE doc_id = ? AND user_id = ? AND page_id IS ? AND updated_at >= ? ORDER BY updated_at DESC, id DESC LIMIT 1",
      docId,
      userId,
      pageId,
      t - ACTIVITY_MERGE_MS,
    );
    if (last) {
      const merged = mergeActivityItems(parseJson<DocActivityItem[]>(last.items_json, []), items);
      this.db.run("UPDATE doc_activity SET items_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(merged), t, last.id);
      return;
    }
    this.db.run(
      "INSERT INTO doc_activity (doc_id, team_id, user_id, page_id, items_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      docId,
      teamId,
      userId,
      pageId,
      JSON.stringify(mergeActivityItems([], items)),
      t,
      t,
    );
  }

  docActivity(docId: string, opts: { limit?: number; before?: number } = {}): DocActivity[] {
    const rows = this.db.all<{
      id: number;
      user_id: string | null;
      name: string | null;
      page_id: string | null;
      items_json: string;
      created_at: number;
      updated_at: number;
      color: string | null;
      avatar_emoji: string | null;
      avatar_bg: string | null;
      avatar_id: string | null;
    }>(
      `SELECT a.id, a.user_id, u.name, a.page_id, a.items_json, a.created_at, a.updated_at, u.color, u.avatar_emoji, u.avatar_bg, u.avatar_id
       FROM doc_activity a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.doc_id = ? AND (? IS NULL OR a.updated_at < ?) ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`,
      docId,
      opts.before ?? null,
      opts.before ?? null,
      Math.min(opts.limit ?? 300, 1000),
    );
    return rows.map((r) => ({
      id: Number(r.id),
      userId: r.user_id ?? undefined,
      userName: r.name ?? "(알 수 없음)",
      userProfile: r.user_id && r.name !== null ? userProfileOf(r.user_id, r) : undefined,
      pageId: r.page_id ?? undefined,
      items: parseJson<DocActivityItem[]>(r.items_json, []),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /** 오래된 활동 기록 정리 (기본 90일) */
  pruneDocActivity(olderThanMs = 90 * DAY): number {
    return this.db.run("DELETE FROM doc_activity WHERE updated_at < ?", now() - olderThanMs).changes;
  }

  getVersion(teamId: string, docId: string, version: number): DocumentData | undefined {
    const cur = this.getDoc(teamId, docId);
    const data = cur && this.versionContent(docId, version);
    return cur && data ? { ...cur, ...data, version } : undefined;
  }

  /**
   * 버전 기록 — 같은 사람이 연속으로 편집한 저장은 하나로 묶어(10분 간격) 각 묶음의 마지막 버전만 보여준다.
   */
  listVersions(docId: string): VersionInfo[] {
    const rows = this.db.all<{ version: number; title: string; updated_by: string | null; name: string | null; updated_at: number; data_json: string }>(
      `SELECT v.version, v.title, v.updated_by, u.name, v.updated_at, v.data_json FROM document_versions v LEFT JOIN users u ON u.id = v.updated_by
       WHERE v.doc_id = ? ORDER BY v.version DESC`,
      docId,
    );
    const out: VersionInfo[] = [];
    let newer: (typeof rows)[number] | undefined;
    for (const r of rows) {
      const burstEnd = !newer || newer.updated_by !== r.updated_by || newer.updated_at - r.updated_at > 10 * 60_000;
      if (burstEnd) {
        const pages = parseJson<{ pages: unknown[] }>(r.data_json, { pages: [] }).pages.length;
        out.push({ version: Number(r.version), title: r.title, updatedByName: r.name ?? "(알 수 없음)", updatedAt: r.updated_at, pageCount: pages });
      }
      newer = r;
      if (out.length >= 100) break;
    }
    return out;
  }

  /** 최근 50개 + 3일 이내 버전은 모두 두고, 그보다 오래된 버전은 묶음의 마지막만 남긴다 */
  pruneVersions(docId: string) {
    const rows = this.db.all<{ version: number; updated_by: string | null; updated_at: number }>(
      "SELECT version, updated_by, updated_at FROM document_versions WHERE doc_id = ? ORDER BY version DESC",
      docId,
    );
    const cutoff = now() - 3 * DAY;
    rows.forEach((r, i) => {
      if (i < 50 || r.updated_at > cutoff) return;
      const newer = rows[i - 1];
      const burstEnd = newer.updated_by !== r.updated_by || newer.updated_at - r.updated_at > 10 * 60_000;
      if (!burstEnd) this.db.run("DELETE FROM document_versions WHERE doc_id = ? AND version = ?", docId, r.version);
    });
  }

  deleteDoc(teamId: string, id: string): boolean {
    return this.db.run("DELETE FROM documents WHERE id = ? AND team_id = ?", id, teamId).changes > 0;
  }

  // ─── feedback (의견 보내기) ───────────────────────────────────

  insertFeedback(
    input: { userId: string; userEmail: string | null; userName: string; kind: FeedbackKind; message: string; pageUrl: string; browser: string; userAgent: string },
    files: { name: string; mime: string; data: Buffer }[],
  ): string {
    return this.db.tx(() => {
      const id = newId("fb");
      this.db.run(
        "INSERT INTO feedback (id, user_id, user_email, user_name, kind, message, page_url, browser, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        input.userId,
        input.userEmail,
        input.userName,
        input.kind,
        input.message,
        input.pageUrl,
        input.browser,
        input.userAgent,
        now(),
      );
      for (const f of files) {
        this.db.run("INSERT INTO feedback_files (id, feedback_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?, ?)", newId("ff"), id, f.name, f.mime, f.data.length, f.data);
      }
      return id;
    });
  }

  /** 최근 since(ms) 동안 이 사용자가 보낸 의견 수 — 스팸 방지 */
  countFeedback(userId: string, sinceMs: number): number {
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND created_at > ?", userId, now() - sinceMs)?.n ?? 0;
  }

  setFeedbackMail(id: string, status: FeedbackItem["mailStatus"], error?: string) {
    this.db.run("UPDATE feedback SET mail_status = ?, mail_error = ? WHERE id = ?", status, error ? error.slice(0, 500) : null, id);
  }

  setFeedbackStatus(id: string, status: FeedbackItem["status"]): boolean {
    return this.db.run("UPDATE feedback SET status = ? WHERE id = ?", status, id).changes > 0;
  }

  listFeedback(filter: { status?: FeedbackItem["status"]; limit?: number } = {}): FeedbackItem[] {
    const rows = filter.status
      ? this.db.all<FeedbackRow>("SELECT * FROM feedback WHERE status = ? ORDER BY created_at DESC LIMIT ?", filter.status, filter.limit ?? 300)
      : this.db.all<FeedbackRow>("SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?", filter.limit ?? 300);
    if (!rows.length) return [];
    const files = new Map<string, FeedbackItem["files"]>();
    const marks = rows.map(() => "?").join(",");
    for (const f of this.db.all<{ id: string; feedback_id: string; name: string; mime: string; size: number }>(
      `SELECT id, feedback_id, name, mime, size FROM feedback_files WHERE feedback_id IN (${marks}) ORDER BY rowid`,
      ...rows.map((r) => r.id),
    )) {
      const list = files.get(f.feedback_id) ?? [];
      list.push({ id: f.id, name: f.name, mime: f.mime, size: f.size });
      files.set(f.feedback_id, list);
    }
    return rows.map((r) => rowToFeedback(r, files.get(r.id) ?? []));
  }

  getFeedback(id: string): FeedbackItem | undefined {
    const r = this.db.get<FeedbackRow>("SELECT * FROM feedback WHERE id = ?", id);
    if (!r) return undefined;
    const files = this.db.all<{ id: string; name: string; mime: string; size: number }>("SELECT id, name, mime, size FROM feedback_files WHERE feedback_id = ? ORDER BY rowid", id);
    return rowToFeedback(r, files);
  }

  getFeedbackFile(feedbackId: string, fileId: string) {
    return this.db.get<{ name: string; mime: string; data: Uint8Array }>("SELECT name, mime, data FROM feedback_files WHERE id = ? AND feedback_id = ?", fileId, feedbackId);
  }

  countOpenFeedback(): number {
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM feedback WHERE status = 'open'")?.n ?? 0;
  }

  // ─── 이전(로컬) 버전 데이터 가져오기 ──────────────────────────

  /** 예전 단일 사용자 버전의 data/db.json 이 있으면 첫 가입자의 개인 작업공간으로 옮긴다 */
  private importLegacyOnce(teamId: string, userId: string) {
    const file = path.join(DATA_DIR, "db.json");
    if (this.db.getMeta("legacy_imported") || !fs.existsSync(file)) return;
    this.db.setMeta("legacy_imported", String(now()));
    const legacy = parseJson<{ references?: Reference[]; cases?: CaseStudy[]; documents?: DocumentData[] }>(fs.readFileSync(file, "utf8"), {});
    this.importData(teamId, userId, legacy);
    console.log(`  이전 데이터(data/db.json)를 첫 계정의 작업공간으로 가져왔어요.`);
  }

  /** 백업/이전 데이터 가져오기 — id 는 새로 발급하고 케이스 연결은 유지한다 */
  importData(teamId: string, userId: string, data: { references?: Reference[]; cases?: CaseStudy[]; documents?: DocumentData[] }) {
    const counts = { references: 0, cases: 0, documents: 0 };
    this.db.tx(() => {
      const caseIds = new Map<string, string>();
      for (const c of data.cases ?? []) {
        if (!c?.name) continue;
        caseIds.set(c.id, this.insertCase(teamId, { name: c.name, subtitle: c.subtitle, highlight: c.highlight, description: c.description, tags: c.tags ?? [] }, userId).id);
        counts.cases++;
      }
      const existing = new Set(this.db.all<{ url_key: string }>("SELECT url_key FROM refs WHERE team_id = ?", teamId).map((r) => r.url_key));
      for (const r of data.references ?? []) {
        if (!r?.imageUrl || existing.has(urlKey(r.imageUrl))) continue;
        existing.add(urlKey(r.imageUrl));
        this.insertRef(teamId, { ...r, caseId: r.caseId ? caseIds.get(r.caseId) : undefined }, userId);
        counts.references++;
      }
      for (const d of data.documents ?? []) {
        if (!d?.pages || !d.settings) continue;
        this.createDoc(teamId, { ...d, pages: d.pages.map((p) => ({ ...p, caseId: p.caseId ? caseIds.get(p.caseId) : undefined })) }, userId);
        counts.documents++;
      }
    });
    return counts;
  }
}

// ─── row mapping ────────────────────────────────────────────

export interface FileRow {
  id: string;
  team_id: string;
  key: string;
  thumb_key: string;
  bytes: number;
  width: number | null;
  height: number | null;
  hash: string;
  origin: "upload" | "copy";
  original_url: string | null;
  name: string | null;
  created_by: string | null;
  created_at: number;
}

export interface RefInput {
  /** 서버에 저장한 이미지면 그 파일 (라우터가 이 팀 파일인지 확인한 뒤 채운다) */
  fileId?: string;
  originalUrl?: string;
  imageUrl: string;
  sourceUrl?: string;
  title?: string;
  note?: string;
  tags: string[];
  caseId?: string;
  kind: "image" | "logo";
  logoLabel?: string;
  width?: number;
  height?: number;
  source: Reference["source"];
}

export interface CaseInput {
  name: string;
  subtitle?: string;
  highlight?: string;
  description?: string;
  tags: string[];
}

interface InviteRow {
  id: string;
  team_id: string;
  kind: "email" | "code";
  email: string | null;
  token_hash: string | null;
  code: string | null;
  password_hash: string | null;
  role: Role;
  created_by: string | null;
  created_at: number;
  expires_at: number;
  max_uses: number;
  uses: number;
  failed_attempts: number;
  revoked_at: number | null;
}

export type { InviteRow };

export const INVITE_MAX_FAILURES = 10;

export function inviteStatus(r: InviteRow, t = now()): InviteInfo["status"] {
  if (r.revoked_at) return "revoked";
  if (r.failed_attempts >= INVITE_MAX_FAILURES) return "locked";
  if (r.uses >= r.max_uses) return "used";
  if (r.expires_at < t) return "expired";
  return "active";
}

interface RefRow {
  id: string;
  image_url: string;
  source_url: string | null;
  title: string | null;
  note: string | null;
  tags_json: string;
  case_id: string | null;
  kind: "image" | "logo";
  logo_label: string | null;
  width: number | null;
  height: number | null;
  source: Reference["source"];
  file_id: string | null;
  original_url: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  created_by_name: string | null;
  updated_by_name: string | null;
}

function rowToRef(r: RefRow): Reference {
  return {
    id: r.id,
    imageUrl: r.image_url,
    sourceUrl: r.source_url ?? undefined,
    title: r.title ?? undefined,
    note: r.note ?? undefined,
    tags: parseJson<string[]>(r.tags_json, []),
    caseId: r.case_id ?? undefined,
    kind: r.kind,
    logoLabel: r.logo_label ?? undefined,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    source: r.source,
    fileId: r.file_id ?? undefined,
    thumbUrl: r.file_id ? fileThumbUrl(r.file_id) : undefined,
    originalUrl: r.original_url ?? undefined,
    createdAt: r.created_at,
    createdBy: r.created_by ?? undefined,
    createdByName: r.created_by_name ?? undefined,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name ?? undefined,
  };
}

interface FeedbackRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  kind: FeedbackKind;
  message: string;
  page_url: string | null;
  browser: string | null;
  user_agent: string | null;
  created_at: number;
  mail_status: FeedbackItem["mailStatus"];
  mail_error: string | null;
  status: FeedbackItem["status"];
}

function rowToFeedback(r: FeedbackRow, files: FeedbackItem["files"]): FeedbackItem {
  return {
    id: r.id,
    kind: r.kind,
    message: r.message,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name ?? "",
    pageUrl: r.page_url ?? "",
    browser: r.browser ?? "",
    userAgent: r.user_agent ?? "",
    createdAt: r.created_at,
    mailStatus: r.mail_status,
    mailError: r.mail_error ?? undefined,
    status: r.status,
    files,
  };
}

interface CaseRow {
  id: string;
  name: string;
  subtitle: string | null;
  highlight: string | null;
  description: string | null;
  tags_json: string;
  created_at: number;
  updated_at: number;
  created_by_name: string | null;
  updated_by_name: string | null;
}

function rowToCase(r: CaseRow): CaseStudy {
  return {
    id: r.id,
    name: r.name,
    subtitle: r.subtitle ?? undefined,
    highlight: r.highlight ?? undefined,
    description: r.description ?? undefined,
    tags: parseJson<string[]>(r.tags_json, []),
    createdAt: r.created_at,
    createdByName: r.created_by_name ?? undefined,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by_name ?? undefined,
  };
}

interface DocRow {
  id: string;
  team_id: string;
  created_by: string | null;
  title: string;
  query: string | null;
  data_json: string;
  version: number;
  created_at: number;
  updated_at: number;
}

function coverOf(doc: Pick<DocumentData, "pages">): string | null {
  for (const p of doc.pages) for (const e of p.elements) if (e.type === "image" && e.src) return e.src;
  return null;
}
