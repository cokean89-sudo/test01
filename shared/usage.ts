// 사용량 안내 — 서버(한도 메시지)와 화면(내 계정 사용량)이 같은 기준 · 말투를 쓴다.

/** 80% 부터 부드럽게 알려 준다 */
export const USAGE_WARN_RATIO = 0.8;

export type UsageState = "ok" | "warn" | "full";

/** 한도 없음(관리자) = 항상 ok */
export function usageState(used: number, limit: number | null): UsageState {
  if (limit === null) return "ok";
  if (limit <= 0 || used >= limit) return "full";
  return used / limit >= USAGE_WARN_RATIO ? "warn" : "ok";
}

/** 받침에 맞는 목적격 조사 — "AI 글쓰기를", "AI 태그 제안을" */
export function withObject(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}를`;
  return `${word}${code % 28 ? "을" : "를"}`;
}

/** "2026-10-01" → "10월 1일" */
export function monthDayLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일`;
}
