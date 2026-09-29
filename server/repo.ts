// 데이터 접근 계층 — 모든 쿼리는 팀(team_id) 범위로 제한한다.

import fs from "node:fs";
import path from "node:path";
import type { FeedbackItem, FeedbackKind } from "../shared/feedback";
import { mergeDocuments } from "../shared/merge";
import type {
  ActivityItem,
  CaseStudy,
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
}

const DAY = 24 * 60 * 60 * 1000;

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
      this.db.run(
        "INSERT INTO users (id, email, name, password_hash, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        input.email?.trim().toLowerCase() ?? null,
        input.name.trim(),
        input.passwordHash ?? null,
        input.verified ? t : null,
        t,
      );
      const teamId = this.createTeam(`${input.name.trim()}의 작업공간`, id, true);
      this.importLegacyOnce(teamId, id);
      return this.getUser(id)!;
    });
  }

  userInfo(u: UserRow): UserInfo {
    const providers = this.db.all<{ provider: string }>("SELECT provider FROM identities WHERE user_id = ?", u.id).map((r) => r.provider);
    return { id: u.id, email: u.email, name: u.name, emailVerified: !!u.email_verified_at, hasPassword: !!u.password_hash, providers, isAdmin: isAdminUser(u), createdAt: u.created_at };
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
      "INSERT INTO teams (id, name, personal, defaults_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      name.trim(),
      personal,
      JSON.stringify(defaults ?? defaultSettings()),
      ownerId,
      t,
    );
    this.db.run("INSERT INTO memberships (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)", id, ownerId, t);
    return id;
  }

  listTeams(userId: string): TeamSummary[] {
    return this.db
      .all<{ id: string; name: string; role: Role; personal: number; members: number }>(
        `SELECT t.id, t.name, m.role, t.personal, (SELECT COUNT(*) FROM memberships x WHERE x.team_id = t.id) AS members
         FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = ? ORDER BY t.personal DESC, t.created_at`,
        userId,
      )
      .map((r) => ({ id: r.id, name: r.name, role: r.role, personal: !!r.personal, memberCount: Number(r.members) }));
  }

  getRole(teamId: string, userId: string): Role | undefined {
    return this.db.get<{ role: Role }>("SELECT role FROM memberships WHERE team_id = ? AND user_id = ?", teamId, userId)?.role;
  }

  getTeam(teamId: string) {
    return this.db.get<{ id: string; name: string; personal: number; defaults_json: string; created_at: number }>("SELECT * FROM teams WHERE id = ?", teamId);
  }

  teamDefaults(teamId: string): DocSettings {
    const base = defaultSettings();
    const saved = parseJson<Partial<DocSettings>>(this.getTeam(teamId)?.defaults_json, {});
    return { ...base, ...saved, footer: { ...base.footer, ...saved.footer }, header: { ...base.header, ...saved.header }, typography: { ...base.typography, ...saved.typography } };
  }

  members(teamId: string): Member[] {
    return this.db
      .all<{ user_id: string; name: string; email: string | null; role: Role; joined_at: number }>(
        `SELECT m.user_id, u.name, u.email, m.role, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.team_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, m.joined_at`,
        teamId,
      )
      .map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, joinedAt: r.joined_at }));
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
      .all<{ id: number; name: string | null; action: string; target_type: string | null; target_id: string | null; summary: string; created_at: number }>(
        `SELECT a.id, u.name, a.action, a.target_type, a.target_id, a.summary, a.created_at FROM activity a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.team_id = ? AND (? IS NULL OR a.id < ?) ORDER BY a.id DESC LIMIT ?`,
        teamId,
        before ?? null,
        before ?? null,
        Math.min(limit, 500),
      )
      .map((r) => ({
        id: Number(r.id),
        userName: r.name ?? "(알 수 없음)",
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

  findDuplicates(teamId: string, urls: string[]): Map<string, Reference> {
    const out = new Map<string, Reference>();
    for (const url of urls) {
      const r = this.db.get<RefRow>(`${this.refSelect} WHERE r.team_id = ? AND r.url_key = ? ORDER BY r.created_at LIMIT 1`, teamId, urlKey(url));
      if (r) out.set(url, rowToRef(r));
    }
    return out;
  }

  insertRef(teamId: string, input: RefInput, userId: string): Reference {
    const id = newId("r");
    const t = now();
    this.db.run(
      `INSERT INTO refs (id, team_id, image_url, url_key, source_url, title, note, tags_json, case_id, kind, logo_label, width, height, source,
        created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      teamId,
      input.imageUrl,
      urlKey(input.imageUrl),
      input.sourceUrl,
      input.title,
      input.note,
      JSON.stringify(input.tags ?? []),
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
        width = ?, height = ?, updated_by = ?, updated_at = ? WHERE id = ? AND team_id = ?`,
      next.imageUrl,
      urlKey(next.imageUrl),
      next.sourceUrl,
      next.title,
      next.note,
      JSON.stringify(next.tags),
      next.caseId ?? null,
      next.kind,
      next.logoLabel,
      next.width ? Math.round(next.width) : null,
      next.height ? Math.round(next.height) : null,
      userId,
      now(),
      id,
      teamId,
    );
    return this.getRef(teamId, id);
  }

  deleteRefs(teamId: string, ids: string[]): number {
    let n = 0;
    for (const id of ids) n += this.db.run("DELETE FROM refs WHERE id = ? AND team_id = ?", id, teamId).changes;
    return n;
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
        if (next) this.db.run("UPDATE refs SET tags_json = ?, updated_by = ?, updated_at = ? WHERE id = ?", JSON.stringify(next), userId, t, r.id);
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
  saveDoc(
    teamId: string,
    id: string,
    input: Pick<DocumentData, "title" | "query" | "settings" | "pages" | "tray">,
    baseVersion: number,
    userId: string,
  ): { version: number; merged: boolean; doc?: DocumentData; conflicts: string[] } | undefined {
    return this.db.tx(() => {
      const current = this.getDoc(teamId, id);
      if (!current) return undefined;
      let next: Pick<DocumentData, "title" | "query" | "settings" | "pages" | "tray"> = {
        title: input.title,
        query: input.query,
        settings: input.settings,
        pages: input.pages,
        // 보관함을 모르는 예전 클라이언트가 저장해도 지금 보관함을 지우지 않는다
        tray: input.tray ?? current.tray,
      };
      let merged = false;
      let conflicts: string[] = [];
      if (baseVersion !== current.version) {
        const base = this.getVersionData(id, baseVersion);
        if (base) {
          const r = mergeDocuments(
            { ...current, ...base } as DocumentData,
            { ...current, ...next } as DocumentData,
            current,
          );
          next = { title: r.value.title, query: r.value.query, settings: r.value.settings, pages: r.value.pages, tray: r.value.tray };
          conflicts = r.conflicts;
          merged = true;
        } else {
          conflicts = ["base-missing"];
        }
      }
      const version = (current.version ?? 1) + 1;
      const t = now();
      const data = JSON.stringify({ settings: next.settings, pages: next.pages, tray: next.tray ?? [] });
      this.db.run(
        "UPDATE documents SET title = ?, query = ?, data_json = ?, version = ?, cover = ?, page_count = ?, updated_by = ?, updated_at = ? WHERE id = ? AND team_id = ?",
        next.title,
        next.query,
        data,
        version,
        coverOf(next as DocumentData),
        next.pages.length,
        userId,
        t,
        id,
        teamId,
      );
      this.db.run("INSERT INTO document_versions (doc_id, version, title, data_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)", id, version, next.title, data, userId, t);
      if (version % 25 === 0) this.pruneVersions(id);
      return { version, merged, doc: merged ? this.getDoc(teamId, id) : undefined, conflicts };
    });
  }

  private getVersionData(docId: string, version: number): Pick<DocumentData, "title" | "settings" | "pages" | "tray"> | undefined {
    const r = this.db.get<{ title: string; data_json: string }>("SELECT title, data_json FROM document_versions WHERE doc_id = ? AND version = ?", docId, version);
    if (!r) return undefined;
    const data = parseJson<Pick<DocumentData, "settings" | "pages" | "tray">>(r.data_json, { settings: defaultSettings(), pages: [] });
    return { title: r.title, ...data, tray: data.tray ?? [] };
  }

  getVersion(teamId: string, docId: string, version: number): DocumentData | undefined {
    const cur = this.getDoc(teamId, docId);
    const data = cur && this.getVersionData(docId, version);
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

export interface RefInput {
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
