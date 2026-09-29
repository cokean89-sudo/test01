import type { FeedbackInput, FeedbackItem } from "../shared/feedback";
import type {
  ActivityItem,
  AnalyzeRequest,
  AnalyzeResult,
  AppStatus,
  AuthProviders,
  CaseStudy,
  DocSettings,
  DocumentData,
  DocumentSummary,
  DuplicateInfo,
  InviteInfo,
  Reference,
  Role,
  ScrapeResult,
  SessionInfo,
  TagSuggestRequest,
  TagSuggestResult,
  TeamDetail,
  TeamSummary,
  VersionInfo,
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

/** 401 이 오면 로그인 화면으로 보내기 위한 훅 (session 스토어가 등록) */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      // CSRF 방지용 사용자 정의 헤더 (서버가 모든 변경 요청에 요구)
      "x-refboard": "1",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = data as { error?: string; code?: string } | null;
    if (res.status === 401 && !url.startsWith("/api/auth/")) onUnauthorized?.();
    throw new ApiError(err?.error ?? `요청 실패 (HTTP ${res.status})`, res.status, err?.code);
  }
  return data as T;
}

/** 현재 선택된 팀 — 라이브러리·문서 API 는 팀 범위로 동작한다 */
let currentTeam = "";
export function setApiTeam(id: string) {
  currentTeam = id;
}
const T = (teamId = currentTeam) => `/api/teams/${encodeURIComponent(teamId)}`;

export type RefInput = Omit<Reference, "id" | "createdAt" | "createdBy" | "createdByName" | "updatedAt" | "updatedByName">;
export type RefPatch = Omit<Partial<RefInput>, "caseId"> & { caseId?: string | null };
export type CaseInput = Pick<CaseStudy, "name" | "subtitle" | "highlight" | "description" | "tags">;

export interface BulkOp {
  ids: string[];
  addTags?: string[];
  removeTags?: string[];
  caseId?: string | null;
  kind?: "image" | "logo";
  delete?: boolean;
}

export interface SaveResult {
  version: number;
  merged: boolean;
  doc?: DocumentData;
  conflicts: string[];
}

export const authApi = {
  providers: () => request<AuthProviders>("GET", "/api/auth/providers"),
  me: () => request<SessionInfo>("GET", "/api/auth/me"),
  signup: (b: { email: string; password: string; name: string }) => request<{ ok: true; mailDelivered: boolean; devLink?: string }>("POST", "/api/auth/signup", b),
  verify: (token: string) => request<SessionInfo>("POST", "/api/auth/verify", { token }),
  resend: (email: string) => request<{ ok: true; devLink?: string }>("POST", "/api/auth/resend", { email }),
  login: (email: string, password: string, remember = false) => request<SessionInfo>("POST", "/api/auth/login", { email, password, remember }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  logoutOthers: () => request<{ ok: true; removed: number }>("POST", "/api/auth/logout-others", {}),
  forgot: (email: string) => request<{ ok: true; devLink?: string }>("POST", "/api/auth/forgot", { email }),
  reset: (token: string, password: string) => request<SessionInfo>("POST", "/api/auth/reset", { token, password }),
  changePassword: (current: string | undefined, next: string) => request<{ ok: true }>("POST", "/api/auth/password", { current, next }),
  profile: (name: string) => request<SessionInfo>("PATCH", "/api/auth/profile", { name }),
};

export const teamApi = {
  list: () => request<TeamSummary[]>("GET", "/api/teams"),
  create: (name: string) => request<TeamDetail>("POST", "/api/teams", { name }),
  detail: (id: string) => request<TeamDetail>("GET", T(id)),
  rename: (id: string, name: string) => request<TeamDetail>("PATCH", T(id), { name }),
  remove: (id: string, confirm: string) => request<{ ok: true }>("DELETE", T(id), { confirm }),
  saveDefaults: (id: string, defaults: DocSettings) => request<TeamDetail>("PUT", `${T(id)}/defaults`, { defaults }),
  setRole: (id: string, userId: string, role: Role) => request<TeamDetail>("PATCH", `${T(id)}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => request<{ ok: true }>("DELETE", `${T(id)}/members/${userId}`, {}),
  invites: (id: string) => request<InviteInfo[]>("GET", `${T(id)}/invites`),
  inviteEmail: (id: string, email: string, role: Role) =>
    request<{ id: string; link: string; mailDelivered: boolean; invites: InviteInfo[] }>("POST", `${T(id)}/invites/email`, { email, role }),
  inviteCode: (id: string, b: { role: Role; password?: string; expiresInDays: number; maxUses: number }) =>
    request<{ id: string; code: string; password: string; invites: InviteInfo[] }>("POST", `${T(id)}/invites/code`, b),
  revokeInvite: (id: string, inviteId: string) => request<InviteInfo[]>("DELETE", `${T(id)}/invites/${inviteId}`, {}),
  activity: (id: string, before?: number) => request<ActivityItem[]>("GET", `${T(id)}/activity${before ? `?before=${before}` : ""}`),
  previewInvite: (token: string) =>
    request<{ teamName?: string; inviterName?: string; email?: string; role: Role; status: InviteInfo["status"]; emailMatches: boolean; alreadyMember: boolean }>(
      "GET",
      `/api/invites/preview?token=${encodeURIComponent(token)}`,
    ),
  acceptInvite: (token: string) => request<{ teamId: string; already?: boolean }>("POST", "/api/invites/accept", { token }),
  joinByCode: (code: string, password: string) => request<{ teamId: string; already?: boolean }>("POST", "/api/invites/join", { code, password }),
  presence: (teamId: string, docId: string, pageId?: string) => request<{ ok: true }>("POST", `${T(teamId)}/presence`, { docId, pageId }),
};

export const api = {
  status: () => request<AppStatus>("GET", "/api/status"),
  library: () => request<{ references: Reference[]; cases: CaseStudy[] }>("GET", `${T()}/library`),
  checkDuplicates: (urls: string[]) => request<DuplicateInfo[]>("POST", `${T()}/references/check`, { urls }),
  addRefs: (refs: RefInput[]) => request<{ created: Reference[]; duplicates: DuplicateInfo[] }>("POST", `${T()}/references`, refs),
  updateRef: (id: string, patch: RefPatch) => request<Reference>("PATCH", `${T()}/references/${id}`, patch),
  bulk: (op: BulkOp) => request<{ references: Reference[] }>("POST", `${T()}/references/bulk`, op),
  renameTag: (from: string, to: string) => request<{ references: Reference[]; cases: CaseStudy[] }>("POST", `${T()}/tags/rename`, { from, to }),
  mergeTags: (from: string[], to: string) => request<{ references: Reference[]; cases: CaseStudy[] }>("POST", `${T()}/tags/merge`, { from, to }),
  deleteTags: (tags: string[]) => request<{ references: Reference[]; cases: CaseStudy[] }>("POST", `${T()}/tags/delete`, { tags }),
  createCase: (c: CaseInput) => request<CaseStudy>("POST", `${T()}/cases`, c),
  updateCase: (id: string, c: Partial<CaseInput>) => request<CaseStudy>("PATCH", `${T()}/cases/${id}`, c),
  deleteCase: (id: string) => request<{ ok: true }>("DELETE", `${T()}/cases/${id}`, {}),
  documents: () => request<DocumentSummary[]>("GET", `${T()}/documents`),
  /** 문서 id 만으로 열기 — 문서가 속한 팀과 내 권한을 함께 돌려준다 */
  document: (id: string) => request<DocumentData & { role: Role }>("GET", `/api/documents/${encodeURIComponent(id)}`),
  createDocument: (doc: Pick<DocumentData, "title" | "query" | "settings" | "pages">, teamId = currentTeam) =>
    request<DocumentData>("POST", `${T(teamId)}/documents`, doc),
  saveDocument: (doc: DocumentData, baseVersion: number) => request<SaveResult>("PUT", `${T(doc.teamId)}/documents/${doc.id}`, { doc, baseVersion }),
  duplicateDocument: (id: string) => request<DocumentData>("POST", `${T()}/documents/${id}/duplicate`, {}),
  deleteDocument: (id: string) => request<{ ok: true }>("DELETE", `${T()}/documents/${id}`, {}),
  versions: (teamId: string, id: string) => request<VersionInfo[]>("GET", `${T(teamId)}/documents/${id}/versions`),
  version: (teamId: string, id: string, v: number) => request<DocumentData>("GET", `${T(teamId)}/documents/${id}/versions/${v}`),
  restoreVersion: (teamId: string, id: string, v: number) => request<DocumentData>("POST", `${T(teamId)}/documents/${id}/versions/${v}/restore`, {}),
  scrape: (url: string) => request<ScrapeResult>("POST", "/api/scrape", { url }),
  analyze: (req: AnalyzeRequest) => request<AnalyzeResult>("POST", "/api/ai/analyze", req),
  suggestTags: (req: TagSuggestRequest) => request<TagSuggestResult>("POST", "/api/ai/tags", req),
  importBackup: (data: unknown) => request<{ references: number; cases: number; documents: number }>("POST", `${T()}/backup`, { data }),
  backupUrl: () => `${T()}/backup`,
};

export const feedbackApi = {
  send: (b: FeedbackInput) => request<{ ok: true; id: string }>("POST", "/api/feedback", b),
  list: (status: "open" | "done" | "all") => request<{ items: FeedbackItem[]; open: number }>("GET", `/api/admin/feedback?status=${status}`),
  setStatus: (id: string, status: FeedbackItem["status"]) => request<FeedbackItem>("PATCH", `/api/admin/feedback/${encodeURIComponent(id)}`, { status }),
  resend: (id: string) => request<FeedbackItem>("POST", `/api/admin/feedback/${encodeURIComponent(id)}/resend`, {}),
  fileUrl: (id: string, fileId: string) => `/api/admin/feedback/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
};

/** 외부 이미지 → 서버 프록시 URL (핫링크 차단/CORS 회피용). 같은 출처 경로는 그대로. */
export function proxied(src: string): string {
  if (!/^https?:\/\//i.test(src)) return src;
  return "/api/proxy?url=" + encodeURIComponent(src);
}

/** 팀 실시간 이벤트 구독 */
export function teamEvents(teamId: string, docId?: string): EventSource {
  return new EventSource(`${T(teamId)}/events${docId ? `?doc=${encodeURIComponent(docId)}` : ""}`);
}
