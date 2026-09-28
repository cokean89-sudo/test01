// 키워드 → 검색 → 태그/케이스별 그룹핑 → 페이지 자동 생성

import type { CaseStudy, DocSettings, DocumentData, Page, PageLayout, Reference } from "../../shared/types";
import { uid } from "../lib/id";
import { norm, parseQuery, searchRefs, type MatchMode, type SearchHit } from "../lib/search";
import { createCasePage, createCoverPage, createReferencePage, createSectionPage } from "./templates";

export type GroupBy = "tag" | "case" | "none";

export interface BuildOptions {
  title: string;
  query: string;
  matchMode: MatchMode;
  groupBy: GroupBy;
  layout: PageLayout;
  maxPerPage: number;
  cover: boolean;
  sections: boolean;
  /** 이 개수보다 작은 태그 그룹은 '기타'로 합친다 */
  minGroupSize: number;
  /** 지정하면 검색 대신 이 레퍼런스들만 사용 (라이브러리에서 선택 후 생성) */
  refIds?: string[];
}

export interface RefGroup {
  key: string;
  label: string;
  kind: "case" | "tag";
  caseId?: string;
  refs: Reference[];
  logos: Reference[];
}

export const ETC_LABEL = "기타";

/** 검색 결과를 그룹으로 나눈다. 각 레퍼런스는 정확히 한 그룹에만 들어간다. */
export function groupHits(hits: SearchHit[], cases: CaseStudy[], query: string, groupBy: GroupBy, minGroupSize = 2): RefGroup[] {
  if (hits.length === 0) return [];
  const caseMap = new Map(cases.map((c) => [c.id, c]));

  if (groupBy === "none") {
    const label = query.trim() || "References";
    return [{ key: "all", label, kind: "tag", refs: hits.filter((h) => h.ref.kind !== "logo").map((h) => h.ref), logos: [] }];
  }

  const groups: RefGroup[] = [];
  let rest = hits;

  if (groupBy === "case") {
    const byCase = new Map<string, RefGroup>();
    const noCase: SearchHit[] = [];
    for (const h of hits) {
      const c = h.ref.caseId ? caseMap.get(h.ref.caseId) : undefined;
      if (!c) {
        noCase.push(h);
        continue;
      }
      let g = byCase.get(c.id);
      if (!g) {
        g = { key: "case:" + c.id, label: c.name, kind: "case", caseId: c.id, refs: [], logos: [] };
        byCase.set(c.id, g);
        groups.push(g);
      }
      (h.ref.kind === "logo" ? g.logos : g.refs).push(h.ref);
    }
    rest = noCase;
  }

  groups.push(...groupByTag(rest.filter((h) => h.ref.kind !== "logo"), query, minGroupSize));
  return groups.filter((g) => g.refs.length > 0 || g.logos.length > 0);
}

function groupByTag(hits: SearchHit[], query: string, minGroupSize: number): RefGroup[] {
  if (hits.length === 0) return [];
  const terms = parseQuery(query).filter((t) => !t.exclude);
  const display = new Map<string, string>(); // norm → 표시용 원문
  for (const h of hits) for (const t of h.ref.tags) if (!display.has(norm(t))) display.set(norm(t), t);

  const buckets = new Map<string, Reference[]>();
  const order: string[] = [];
  const put = (key: string, ref: Reference) => {
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(ref);
  };

  // 1) 검색어가 2개 이상 태그로 매칭되면 → 검색어 순서대로 그룹
  const tagTermsUsed = terms.map((t) => t.text).filter((t) => hits.some((h) => h.tagTerms.includes(t)));
  let remaining = hits;
  if (tagTermsUsed.length >= 2) {
    const left: SearchHit[] = [];
    for (const h of hits) {
      const term = tagTermsUsed.find((t) => h.tagTerms.includes(t));
      if (term) {
        const tag = h.ref.tags.find((x) => norm(x) === term) ?? h.ref.tags.find((x) => norm(x).includes(term));
        put(tag ? norm(tag) : term, h.ref);
      } else left.push(h);
    }
    for (const t of tagTermsUsed) if (!display.has(t)) display.set(t, t);
    remaining = left;
  }

  // 2) 나머지는 결과 안에서 가장 많이 쓰인 태그 기준으로 묶는다 (모든 결과에 공통인 태그와 검색어 태그는 제외)
  if (remaining.length) {
    const freq = new Map<string, number>();
    for (const h of remaining) for (const t of new Set(h.ref.tags.map(norm))) freq.set(t, (freq.get(t) ?? 0) + 1);
    const queryTags = new Set(terms.map((t) => t.text));
    const eligible = (t: string) => !queryTags.has(t) && (remaining.length === 1 || freq.get(t)! < remaining.length);
    for (const h of remaining) {
      const own = [...new Set(h.ref.tags.map(norm))].filter(eligible);
      own.sort((a, b) => freq.get(b)! - freq.get(a)! || a.localeCompare(b, "ko"));
      const fallback = h.tagTerms[0] ?? h.ref.tags.map(norm)[0] ?? ETC_LABEL;
      put(own[0] ?? fallback, h.ref);
    }
  }

  // 3) 너무 작은 그룹은 매칭된 검색어 그룹으로, 그것도 작으면 '기타'로
  const termOf = new Map(hits.map((h) => [h.ref.id, h.tagTerms[0]]));
  const merged = new Map<string, Reference[]>();
  const mergedOrder: string[] = [];
  const add = (key: string, list: Reference[]) => {
    if (!merged.has(key)) {
      merged.set(key, []);
      mergedOrder.push(key);
    }
    merged.get(key)!.push(...list);
  };
  for (const key of order) {
    const refs = buckets.get(key)!;
    if (order.length > 1 && refs.length < minGroupSize && key !== ETC_LABEL) {
      for (const r of refs) add(termOf.get(r.id) ?? ETC_LABEL, [r]);
    } else add(key, refs);
  }
  const groups: RefGroup[] = [];
  const etc: Reference[] = [];
  for (const key of mergedOrder) {
    const refs = merged.get(key)!;
    if (key === ETC_LABEL || (mergedOrder.length > 1 && refs.length < minGroupSize)) etc.push(...refs);
    else groups.push({ key: "tag:" + key, label: display.get(key) ?? key, kind: "tag", refs, logos: [] });
  }
  if (etc.length) {
    // 전부 작은 그룹이라 하나로 합쳐졌다면 '기타' 대신 검색어를 제목으로
    const label = groups.length ? ETC_LABEL : query.trim() || "References";
    groups.push({ key: "tag:" + label, label, kind: "tag", refs: etc, logos: [] });
  }
  return groups.sort((a, b) => (a.label === ETC_LABEL ? 1 : b.label === ETC_LABEL ? -1 : b.refs.length - a.refs.length));
}

/** n 개를 페이지당 최대 max 개로, 균등하게 나눈다 (11개/최대 9 → 6 + 5) */
export function paginate<T>(items: T[], max: number): T[][] {
  if (items.length === 0) return [[]];
  const pages = Math.ceil(items.length / Math.max(1, max));
  const base = Math.floor(items.length / pages);
  const extra = items.length % pages;
  const out: T[][] = [];
  let i = 0;
  for (let p = 0; p < pages; p++) {
    const size = base + (p < extra ? 1 : 0);
    out.push(items.slice(i, i + size));
    i += size;
  }
  return out;
}

export function buildGroups(refs: Reference[], cases: CaseStudy[], opts: BuildOptions): RefGroup[] {
  let hits = searchRefs(refs, cases, opts.refIds ? "" : opts.query, opts.matchMode, "relevance");
  if (opts.refIds) {
    const order = new Map(opts.refIds.map((id, i) => [id, i]));
    hits = hits.filter((h) => order.has(h.ref.id)).sort((a, b) => order.get(a.ref.id)! - order.get(b.ref.id)!);
    // 선택 모드에서는 태그 그룹핑을 위해 검색어를 태그로 다시 계산
    hits = hits.map((h) => ({ ...h, tagTerms: [] }));
  }
  return groupHits(hits, cases, opts.refIds ? "" : opts.query, opts.groupBy, opts.minGroupSize);
}

export function buildDocument(
  refs: Reference[],
  cases: CaseStudy[],
  settings: DocSettings,
  opts: BuildOptions,
  groups = buildGroups(refs, cases, opts),
): DocumentData {
  const caseMap = new Map(cases.map((c) => [c.id, c]));
  const pages: Page[] = [];
  if (opts.cover) {
    const keywords = parseQuery(opts.query)
      .filter((t) => !t.exclude)
      .map((t) => t.text);
    const today = new Date().toISOString().slice(0, 10).replaceAll("-", ".");
    pages.push(
      createCoverPage(settings, {
        title: opts.title,
        subtitle: keywords.length ? keywords.map((k) => "#" + k).join("  ") : "Case Study & Reference",
        meta: today,
        image: groups[0]?.refs[0],
      }),
    );
  }

  groups.forEach((group, gi) => {
    if (opts.sections && groups.length > 1) {
      pages.push(createSectionPage(settings, { title: group.label, subtitle: `${group.refs.length} references`, index: gi + 1 }));
    }
    const chunks = paginate(group.refs, opts.maxPerPage);
    chunks.forEach((chunk, ci) => {
      const suffix = chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : "";
      if (group.kind === "case") {
        const c = group.caseId ? caseMap.get(group.caseId) : undefined;
        pages.push(
          createCasePage(settings, {
            caseStudy: c,
            title: group.label,
            subtitle: c?.subtitle,
            highlight: (c?.highlight ?? "") + suffix,
            description: ci === 0 ? c?.description : "",
            images: chunk,
            logos: ci === 0 ? group.logos : [],
            layout: opts.layout,
          }),
        );
      } else {
        pages.push(
          createReferencePage(settings, {
            title: group.label,
            group: group.label,
            sectionLabel: "Reference" + suffix,
            images: chunk,
            layout: opts.layout,
          }),
        );
      }
    });
  });

  const now = Date.now();
  return { id: uid("d"), title: opts.title, query: opts.query, createdAt: now, updatedAt: now, settings, pages };
}
