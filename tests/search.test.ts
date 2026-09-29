import { describe, expect, it } from "vitest";
import type { CaseStudy, Reference } from "../shared/types";
import { josa, keywordCount, matchSummary, noMatchHint, noMatchMessage, normalizeTags, parseQuery, searchRefs, tagCounts } from "../src/lib/search";

let t = 1000;
const ref = (id: string, tags: string[], extra: Partial<Reference> = {}): Reference => ({
  id,
  imageUrl: `https://img.example.com/${id}.jpg`,
  tags,
  kind: "image",
  source: "manual",
  createdAt: t++,
  ...extra,
});

const cases: CaseStudy[] = [{ id: "c1", name: "Allianz Arena", tags: ["분데스리가"], createdAt: 0 }];
const refs = [
  ref("a", ["조형물", "네온사인", "별"]),
  ref("b", ["조형물", "야간조명"], { title: "와이어 스타" }),
  ref("c", ["스타디움", "야간조명"], { caseId: "c1" }),
  ref("d", ["굿즈샵"], { note: "메가스토어 유니폼 월" }),
  ref("e", ["로고"], { caseId: "c1", kind: "logo" }),
];

describe("parseQuery", () => {
  it("키워드, #정확, -제외, 따옴표 구문을 해석한다", () => {
    expect(parseQuery('조형물, #별 -로고 "포토 존"')).toEqual([
      { text: "조형물", exact: false, exclude: false },
      { text: "별", exact: true, exclude: false },
      { text: "로고", exact: false, exclude: true },
      { text: "포토 존", exact: false, exclude: false },
    ]);
  });
});

describe("searchRefs", () => {
  it("OR: 하나라도 맞으면 포함하고, 많이 맞을수록 위로 정렬한다", () => {
    const hits = searchRefs(refs, cases, "조형물 야간조명", "or");
    expect(hits[0].ref.id).toBe("b");
    // 점수가 같으면 최신 항목 먼저
    expect(hits.slice(1).map((h) => h.ref.id)).toEqual(["c", "a"]);
  });

  it("AND: 모든 키워드를 포함해야 한다", () => {
    expect(searchRefs(refs, cases, "조형물 야간조명", "and").map((h) => h.ref.id)).toEqual(["b"]);
  });

  it("케이스 이름·태그로도 찾는다", () => {
    expect(searchRefs(refs, cases, "allianz").map((h) => h.ref.id).sort()).toEqual(["c", "e"]);
    expect(searchRefs(refs, cases, "분데스리가").map((h) => h.ref.id).sort()).toEqual(["c", "e"]);
  });

  it("제목·메모도 검색하고, 제외어는 뺀다", () => {
    expect(searchRefs(refs, cases, "유니폼").map((h) => h.ref.id)).toEqual(["d"]);
    expect(searchRefs(refs, cases, "스타 -조형물").map((h) => h.ref.id)).toEqual(["c"]);
  });

  it("#태그는 태그와 정확히 일치할 때만", () => {
    expect(searchRefs(refs, cases, "#조형").map((h) => h.ref.id)).toEqual([]);
    expect(searchRefs(refs, cases, "#조형물").length).toBe(2);
  });

  it("검색어가 없으면 전체를 정렬 기준대로", () => {
    expect(searchRefs(refs, cases, "", "or", "newest")[0].ref.id).toBe("e");
    expect(searchRefs(refs, cases, "", "or", "oldest")[0].ref.id).toBe("a");
  });

  it("태그로 매칭된 검색어를 기록한다", () => {
    const hit = searchRefs(refs, cases, "조형물 와이어").find((h) => h.ref.id === "b")!;
    expect(hit.tagTerms).toEqual(["조형물"]);
  });
});

describe("tags", () => {
  it("태그 정규화: 중복·공백 제거", () => {
    expect(normalizeTags(" 별, 조형물 ,별,#네온  사인")).toEqual(["별", "조형물", "네온 사인"]);
  });
  it("태그 개수 집계", () => {
    expect(tagCounts(refs).slice(0, 2)).toEqual([
      { tag: "야간조명", count: 2 },
      { tag: "조형물", count: 2 },
    ]);
  });
});

describe("검색 조건 문장", () => {
  it("하나라도 / 모두", () => {
    expect(matchSummary("야경 파사드", "or", 24)).toBe("야경, 파사드 중 하나라도 있는 이미지 24개");
    expect(matchSummary("야경 파사드", "and", 5)).toBe("야경, 파사드가 모두 있는 이미지 5개");
    expect(matchSummary("파사드, 야경", "and", 5)).toBe("파사드, 야경이 모두 있는 이미지 5개");
  });

  it("키워드 하나 · 없음 · 제외어 · #태그 · 구문", () => {
    expect(matchSummary("야경", "and", 12)).toBe("야경이 있는 이미지 12개");
    expect(matchSummary("  ", "or", 1200)).toBe("전체 이미지 1,200개");
    expect(matchSummary("팝업 -로고", "or", 3)).toBe("팝업이 있는 이미지 3개 (로고 제외)");
    expect(matchSummary('#Nike "포토 존"', "or", 2)).toBe("#Nike, 포토 존 중 하나라도 있는 이미지 2개");
  });

  it("결과 없음 안내", () => {
    expect(noMatchMessage("야경 파사드", "and")).toBe("야경, 파사드가 모두 있는 이미지가 없어요");
    expect(noMatchHint("야경 파사드", "and")).toContain("체크를 풀면");
    expect(noMatchHint("야경", "and")).not.toContain("체크");
  });

  it("체크박스는 키워드 2개 이상일 때만", () => {
    expect(keywordCount("")).toBe(0);
    expect(keywordCount("야경 -로고")).toBe(1);
    expect(keywordCount("야경, 파사드")).toBe(2);
  });

  it("받침에 맞는 조사", () => {
    expect(josa("야경", "이", "가")).toBe("이");
    expect(josa("파사드", "이", "가")).toBe("가");
    expect(josa("Nike", "이", "가")).toBe("가");
    expect(josa("Autumn", "이", "가")).toBe("이");
    expect(josa("2026", "이", "가")).toBe("이");
    expect(josa("5", "이", "가")).toBe("가");
  });
});
