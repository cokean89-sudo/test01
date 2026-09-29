import { keywordCount, MATCH_ALL_DISABLED_HINT, MATCH_ALL_LABEL, type MatchMode } from "../lib/search";

/**
 * 검색 매칭 옵션 — 체크 해제(기본): 키워드 중 하나라도 있는 것 / 체크: 키워드가 모두 있는 것만.
 * 키워드가 1개 이하면 두 방식의 결과가 같으므로 흐리게 비활성화한다.
 */
export function MatchAllCheck({ query, mode, onChange }: { query: string; mode: MatchMode; onChange: (mode: MatchMode) => void }) {
  const enabled = keywordCount(query) > 1;
  return (
    <label className={"check match-all" + (enabled ? "" : " disabled")} title={enabled ? "체크를 풀면 키워드 중 하나라도 있는 이미지를 찾아요" : MATCH_ALL_DISABLED_HINT}>
      <input type="checkbox" checked={mode === "and"} disabled={!enabled} onChange={(e) => onChange(e.target.checked ? "and" : "or")} />
      <span>{MATCH_ALL_LABEL}</span>
    </label>
  );
}
