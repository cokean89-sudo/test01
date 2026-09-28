// 키워드 검색 & 자동 정렬.
// 문법: 공백/쉼표로 키워드 구분, "따옴표 구문", #태그(태그 정확히 일치), -제외어

import type { CaseStudy, Reference } from "../../shared/types";

export interface Term {
  text: string;
  exact: boolean;
  exclude: boolean;
}

export type MatchMode = "and" | "or";
export type SortKey = "relevance" | "newest" | "oldest" | "title" | "ratio";

export interface SearchHit {
  ref: Reference;
  score: number;
  /** 태그로 매칭된 검색어(원문) — 그룹핑에 사용 */
  tagTerms: string[];
}

export function norm(s: string): string {
  return s.normalize("NFC").toLowerCase().trim();
}

export function parseQuery(q: string): Term[] {
  const terms: Term[] = [];
  const re = /(-?)(#?)(?:"([^"]+)"|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const text = norm(m[3] ?? m[4] ?? "");
    if (!text) continue;
    terms.push({ text, exact: m[2] === "#", exclude: m[1] === "-" });
  }
  return terms;
}

function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** 한 레퍼런스가 검색어 하나와 얼마나 맞는지 (0 = 불일치) */
function termScore(term: Term, tags: string[], ref: Reference, caseName: string): { score: number; byTag: boolean } {
  const t = term.text;
  if (tags.includes(t)) return { score: 10, byTag: true };
  if (term.exact) return { score: 0, byTag: false };
  let score = 0;
  let byTag = false;
  if (tags.some((tag) => tag.startsWith(t))) {
    score += 6;
    byTag = true;
  } else if (tags.some((tag) => tag.includes(t))) {
    score += 4;
    byTag = true;
  }
  if (caseName.includes(t)) score += 5;
  if (ref.title && norm(ref.title).includes(t)) score += 3;
  if (ref.note && norm(ref.note).includes(t)) score += 2;
  if (ref.logoLabel && norm(ref.logoLabel).includes(t)) score += 1;
  if (hostOf(ref.sourceUrl).includes(t)) score += 1;
  return { score, byTag };
}

export function searchRefs(
  refs: Reference[],
  cases: CaseStudy[],
  query: string,
  mode: MatchMode = "or",
  sort: SortKey = "relevance",
): SearchHit[] {
  const terms = parseQuery(query);
  const include = terms.filter((t) => !t.exclude);
  const exclude = terms.filter((t) => t.exclude);
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const hits: SearchHit[] = [];

  for (const ref of refs) {
    const c = ref.caseId ? caseMap.get(ref.caseId) : undefined;
    const tags = [...ref.tags, ...(c?.tags ?? [])].map(norm);
    const caseName = c ? norm(c.name) : "";
    if (exclude.some((t) => termScore(t, tags, ref, caseName).score > 0)) continue;
    if (include.length === 0) {
      hits.push({ ref, score: 0, tagTerms: [] });
      continue;
    }
    let total = 0;
    let matched = 0;
    const tagTerms: string[] = [];
    for (const t of include) {
      const s = termScore(t, tags, ref, caseName);
      if (s.score > 0) {
        matched++;
        total += s.score;
        if (s.byTag) tagTerms.push(t.text);
      }
    }
    if (mode === "and" ? matched < include.length : matched === 0) continue;
    hits.push({ ref, score: total + matched * 5, tagTerms });
  }

  const ratio = (r: Reference) => (r.width && r.height ? r.width / r.height : 1.33);
  const cmp: Record<SortKey, (a: SearchHit, b: SearchHit) => number> = {
    relevance: (a, b) => b.score - a.score || b.ref.createdAt - a.ref.createdAt,
    newest: (a, b) => b.ref.createdAt - a.ref.createdAt,
    oldest: (a, b) => a.ref.createdAt - b.ref.createdAt,
    title: (a, b) => (a.ref.title ?? "").localeCompare(b.ref.title ?? "", "ko"),
    ratio: (a, b) => ratio(b.ref) - ratio(a.ref),
  };
  return hits.sort(cmp[sort]);
}

/** 태그별 개수 (많은 순) */
export function tagCounts(refs: Reference[]): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of refs) for (const t of r.tags) map.set(t, (map.get(t) ?? 0) + 1);
  return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ko"));
}

export function normalizeTags(input: string | string[]): string[] {
  const list = Array.isArray(input) ? input : input.split(/[,\n#]+/);
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.normalize("NFC").trim().replace(/\s+/g, " ");
    if (t && !out.some((o) => norm(o) === norm(t))) out.push(t);
  }
  return out;
}
