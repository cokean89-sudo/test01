// SQLite 저장소 (Node 내장 node:sqlite — 별도 설치 불필요). WAL 모드로 동시 읽기/쓰기에 강하다.
// 이미지는 저장하지 않고 URL/메타데이터만 보관한다.

import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync as DatabaseSyncType, SQLInputValue } from "node:sqlite";
import { DATA_DIR } from "./config";

// 실험적 기능 경고가 import 시점에 찍히지 않도록 env.ts 이후 런타임에 불러온다
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type Param = SQLInputValue | undefined | boolean;

/** 번호순 스키마 변경 (PRAGMA user_version) — 테스트가 옛 버전 DB 를 만들 때도 쓴다 */
export const MIGRATIONS: string[] = [
  // 1: 초기 스키마
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT,
    email_verified_at INTEGER,
    failed_logins INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE TABLE identities (
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, provider_user_id)
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    ip TEXT,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE email_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    personal INTEGER NOT NULL DEFAULT 0,
    defaults_json TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE memberships (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );
  CREATE INDEX memberships_user ON memberships(user_id);
  CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    email TEXT COLLATE NOCASE,
    token_hash TEXT UNIQUE,
    code TEXT UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    revoked_at INTEGER
  );
  CREATE INDEX invites_team ON invites(team_id);
  CREATE TABLE refs (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    url_key TEXT NOT NULL,
    source_url TEXT,
    title TEXT,
    note TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    case_id TEXT,
    kind TEXT NOT NULL DEFAULT 'image',
    logo_label TEXT,
    width INTEGER,
    height INTEGER,
    source TEXT NOT NULL DEFAULT 'manual',
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX refs_team ON refs(team_id);
  CREATE INDEX refs_key ON refs(team_id, url_key);
  CREATE TABLE cases (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subtitle TEXT,
    highlight TEXT,
    description TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX cases_team ON cases(team_id);
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    query TEXT,
    data_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    cover TEXT,
    page_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX documents_team ON documents(team_id);
  CREATE TABLE document_versions (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    data_json TEXT NOT NULL,
    checkpoint INTEGER NOT NULL DEFAULT 0,
    updated_by TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, version)
  );
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    summary TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX activity_team ON activity(team_id, id);
  CREATE TABLE security_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    event TEXT NOT NULL,
    ip TEXT,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `,
  // v2: 로그인 상태 유지 여부 — 0 이면 브라우저 세션(짧게 만료)
  `
  ALTER TABLE sessions ADD COLUMN persistent INTEGER NOT NULL DEFAULT 1;
  `,
  // v3: 의견 보내기 — 메일이 실패해도 남도록 DB 에 먼저 저장
  `
  CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_email TEXT,
    user_name TEXT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    page_url TEXT,
    browser TEXT,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    mail_status TEXT NOT NULL DEFAULT 'pending',
    mail_error TEXT,
    status TEXT NOT NULL DEFAULT 'open'
  );
  CREATE INDEX feedback_created ON feedback(created_at);
  CREATE TABLE feedback_files (
    id TEXT PRIMARY KEY,
    feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL
  );
  CREATE INDEX feedback_files_fb ON feedback_files(feedback_id);
  `,
  // v4: 올린 이미지 · 링크 사본 — 파일 자체는 저장소(디스크 · R2 · S3)에, 여기에는 목록과 용량만
  `
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    thumb_key TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    hash TEXT NOT NULL,
    origin TEXT NOT NULL,
    original_url TEXT,
    name TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX files_team ON files(team_id);
  CREATE INDEX files_hash ON files(team_id, hash);
  ALTER TABLE refs ADD COLUMN file_id TEXT;
  ALTER TABLE refs ADD COLUMN original_url TEXT;
  ALTER TABLE refs ADD COLUMN original_key TEXT;
  CREATE INDEX refs_file ON refs(file_id);
  CREATE INDEX refs_original_key ON refs(team_id, original_key);
  `,
  // v5: 사용량 — 횟수 · 수치만 (글 · 이미지 내용은 저장하지 않는다). month · day 는 한국 시간 기준
  `
  CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY,
    user_id TEXT,
    team_id TEXT,
    kind TEXT NOT NULL,
    detail TEXT NOT NULL,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    month TEXT NOT NULL,
    day TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX usage_user ON usage_events(user_id, month, kind, detail);
  CREATE INDEX usage_team ON usage_events(team_id, month);
  CREATE INDEX usage_month ON usage_events(month, kind);
  -- 관리자가 사용자별로 조정한 한도 (요금제 기본값 위에 덮어쓴다)
  CREATE TABLE user_limits (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    overrides_json TEXT NOT NULL,
    updated_by TEXT,
    updated_at INTEGER NOT NULL
  );
  `,
  // v6: 태그 없이 저장돼 있던 레퍼런스에 '미분류' 태그 (이후에는 저장할 때 자동으로 붙고 빠진다)
  `
  UPDATE refs SET tags_json = '["미분류"]' WHERE tags_json IS NULL OR tags_json IN ('', '[]');
  `,
  // v7: 프로필 — 개인(사진 · 기본 이모지 · 이모지 배경색 · 사용자 고유 색), 팀(사진 · 팀 색).
  //     사진 파일은 저장소의 avatars/<id>.webp 에 두고 files 표에는 넣지 않는다 → 저장 용량 한도 계산에서 빠진다.
  //     비어 있는 값은 서버가 시작할 때 무작위로 채운다 (Repo.fillProfiles)
  `
  ALTER TABLE users ADD COLUMN avatar_id TEXT;
  ALTER TABLE users ADD COLUMN avatar_emoji TEXT;
  ALTER TABLE users ADD COLUMN avatar_bg TEXT;
  ALTER TABLE users ADD COLUMN color TEXT;
  ALTER TABLE teams ADD COLUMN avatar_id TEXT;
  ALTER TABLE teams ADD COLUMN color TEXT;
  CREATE UNIQUE INDEX users_avatar ON users(avatar_id) WHERE avatar_id IS NOT NULL;
  CREATE UNIQUE INDEX teams_avatar ON teams(avatar_id) WHERE avatar_id IS NOT NULL;
  `,
  // v8: 실시간 공동 편집 — 문서의 Yjs 상태(바이너리), 페이지 맡기 · 담당자만 편집, 요소 단위 활동 기록.
  //     data_json 은 계속 최신으로 유지한다 (목록 · 뷰어 · 인쇄 · 내보내기 · 백업이 읽는다). ydoc 이 없으면 처음 열 때 data_json 에서 만든다.
  `
  ALTER TABLE documents ADD COLUMN ydoc BLOB;
  ALTER TABLE documents ADD COLUMN assign_strict INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE page_assignments (
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by TEXT,
    assigned_at INTEGER NOT NULL,
    PRIMARY KEY (doc_id, page_id)
  );
  CREATE INDEX page_assignments_user ON page_assignments(user_id);
  CREATE TABLE doc_activity (
    id INTEGER PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL,
    user_id TEXT,
    page_id TEXT,
    items_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX doc_activity_doc ON doc_activity(doc_id, updated_at);
  CREATE INDEX doc_activity_user ON doc_activity(doc_id, user_id, updated_at);
  CREATE INDEX doc_activity_time ON doc_activity(updated_at);
  `,
];

export class Database {
  readonly raw: DatabaseSyncType;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.raw = new DatabaseSync(file);
    // 계정·세션 정보가 담기므로 소유자만 읽고 쓸 수 있게 한다 (Windows 에서는 무시됨)
    if (file !== ":memory:" && process.platform !== "win32") fs.chmodSync(file, 0o600);
    // secure_delete: 지운 행(토큰, 옛 비밀번호 해시 등)을 파일에서 0으로 덮어쓴다
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON;");
    this.migrate();
  }

  private migrate() {
    const current = (this.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private bind(params: Param[]): SQLInputValue[] {
    return params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...this.bind(params)) as T[];
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...this.bind(params)) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.raw.prepare(sql).run(...this.bind(params));
    return { changes: Number(r.changes) };
  }

  private depth = 0;
  /** 트랜잭션 — 중첩 호출 시 바깥 트랜잭션에 합류 */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.raw.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    } finally {
      this.depth--;
    }
  }

  getMeta(key: string): string | undefined {
    return this.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", key)?.value;
  }

  setMeta(key: string, value: string) {
    this.run("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }

  close() {
    this.raw.close();
  }
}

export function openDatabase(file = path.join(DATA_DIR, "refboard.sqlite")): Database {
  return new Database(file);
}

export const newId = (prefix: string) => prefix + crypto.randomBytes(9).toString("base64url");
export const now = () => Date.now();

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
