// 공동 편집 통신 규칙 — WebSocket(/api/collab/<문서 id>) 과 HTTP 대체 경로(POST /api/collab/<문서 id>/sync)가 함께 쓴다.
//
// WebSocket 메시지(바이너리): [종류 varUint][내용]
//   0 SYNC       y-protocols 동기화 (step1 = 상태 벡터, step2 = 빠진 변경, update = 새 변경)
//   1 AWARENESS  y-protocols awareness (보는 페이지 · 선택 · 편집 중 · 활동)
//   2 CONTROL    JSON 문자열 — 아래 ControlMessage
//
// 서버는 받은 awareness 의 user(이름 · 프로필)를 실제 로그인한 사람으로 덮어쓰고, 선택 · 활동 시각을 서버 시계로 찍는다(selT · actT).
// 그래서 사람마다 컴퓨터 시계가 달라도 '먼저 고른 사람'과 '30초 동안 입력 없음'을 같은 기준으로 판단한다.

import type { AssignmentState, Role, UserProfile } from "./types";

export const MSG_SYNC = 0;
export const MSG_AWARENESS = 1;
export const MSG_CONTROL = 2;

/** 다른 사람이 선택 중인 요소의 잠금 — 이 시간 동안 입력이 없으면 풀린다 */
export const LOCK_IDLE_MS = 30_000;
/** 연결이 살아 있는지 확인하는 간격 */
export const PING_MS = 15_000;

export interface PeerUser {
  id: string;
  name: string;
  profile: UserProfile;
}

/** awareness 로 주고받는 내 상태 */
export interface PeerState {
  /** 서버가 채운다 (보낸 값은 무시) */
  user?: PeerUser;
  /** 보고 있는 페이지 */
  page?: string | null;
  /** 선택한 요소 */
  sel?: string[];
  /** 글을 고치고 있는 요소 */
  editing?: string | null;
  /** 입력할 때마다 올라가는 숫자 (잠금 30초 판단용) */
  act?: number;
  /** 서버 시계: 지금 선택을 시작한 시각 */
  selT?: number;
  /** 서버 시계: 마지막 입력 시각 */
  actT?: number;
}

export type ControlMessage =
  | { t: "hello"; now: number; role: Role; userId: string }
  | { t: "ping" }
  | { t: "pong"; now: number }
  /** 보낸 변경 하나를 서버가 반영했다 */
  | { t: "ack" }
  /** 내 선택에 찍힌 서버 시각 */
  | { t: "stamp"; selT?: number; actT?: number; now: number }
  | { t: "assign"; assign: AssignmentState }
  | { t: "role"; role: Role }
  /** 담당자만 편집 모드에서 거절된 변경 — 서버가 되돌렸다 */
  | { t: "rejected"; reason: string }
  | { t: "deleted" };

/** HTTP 대체 경로 (WebSocket 이 막힌 회사망 등) */
export interface HttpSyncRequest {
  /** 내 상태 벡터 (base64) */
  sv: string;
  /** 서버가 아직 모르는 내 변경 (base64, 없으면 생략) */
  update?: string;
  /** 내 awareness (base64) */
  awareness?: string;
  clientId: number;
}

export interface HttpSyncResponse {
  /** 내가 아직 모르는 변경 (base64) */
  update: string;
  /** 서버 상태 벡터 (base64) — 다음 요청 때 보낼 내 변경을 고르는 기준 */
  sv: string;
  /** 다른 사람들 awareness (base64) */
  awareness: string;
  assign: AssignmentState;
  role: Role;
  now: number;
  /** 내 선택 · 활동에 찍힌 서버 시각 */
  stamp?: { selT?: number; actT?: number };
  rejected?: string;
}

export const toB64 = (u: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
