import { describe, expect, it } from "vitest";
import type { CaseStudy, ImageElement, Reference, TextElement } from "../shared/types";
import { buildDocument, buildGroups, ETC_LABEL, paginate, type BuildOptions } from "../src/layout/autobuild";
import { createCasePage, relayoutPage, scalePage } from "../src/layout/templates";
import { DEFAULT_LAYOUT, defaultSettings } from "../src/lib/defaults";

let t = 1;
const ref = (id: string, tags: string[], extra: Partial<Reference> = {}): Reference => ({
  id,
  imageUrl: `https://img.example.com/${id}.jpg`,
  tags,
  kind: "image",
  source: "manual",
  width: 1200,
  height: 800,
  createdAt: t++,
  ...extra,
});

const cases: CaseStudy[] = [{ id: "c1", name: "Allianz Arena", subtitle: "Bundesliga", highlight: "스폰서", description: "설명", tags: [], createdAt: 0 }];
const refs: Reference[] = [
  ref("s1", ["조형물", "별", "네온사인"]),
  ref("s2", ["조형물", "별"]),
  ref("s3", ["조형물", "별", "야간조명"]),
  ref("s4", ["조형물", "사인물"]),
  ref("s5", ["조형물", "사인물"]),
  ref("s6", ["조형물", "포토존"]),
  ref("g1", ["굿즈샵"]),
  ref("g2", ["굿즈샵", "리테일"]),
  ref("a1", ["스타디움"], { caseId: "c1" }),
  ref("a2", ["스타디움", "야간조명"], { caseId: "c1" }),
  ref("l1", ["로고"], { caseId: "c1", kind: "logo", logoLabel: "Team Logo" }),
];

const opts = (o: Partial<BuildOptions>): BuildOptions => ({
  title: "Test",
  query: "",
  matchMode: "or",
  groupBy: "tag",
  layout: { ...DEFAULT_LAYOUT },
  maxPerPage: 9,
  cover: false,
  sections: false,
  minGroupSize: 2,
  ...o,
});

describe("grouping", () => {
  it("검색어가 여러 태그면 검색어별로 묶는다", () => {
    const groups = buildGroups(refs, cases, opts({ query: "조형물 굿즈샵" }));
    expect(groups.map((g) => [g.label, g.refs.length])).toEqual([
      ["조형물", 6],
      ["굿즈샵", 2],
    ]);
  });

  it("검색어가 하나면 결과 안에서 많이 쓰인 다른 태그로 나누고, 작은 그룹은 '기타'로", () => {
    const groups = buildGroups(refs, cases, opts({ query: "조형물" }));
    expect(groups.map((g) => [g.label, g.refs.map((r) => r.id).sort()])).toEqual([
      ["별", ["s1", "s2", "s3"]],
      ["사인물", ["s4", "s5"]],
      [ETC_LABEL, ["s6"]],
    ]);
  });

  it("케이스별: 케이스는 케이스 그룹(로고 분리), 나머지는 태그로", () => {
    const groups = buildGroups(refs, cases, opts({ query: "스타디움 굿즈샵 로고", groupBy: "case" }));
    const arena = groups.find((g) => g.kind === "case")!;
    expect(arena.label).toBe("Allianz Arena");
    expect(arena.refs.map((r) => r.id)).toEqual(expect.arrayContaining(["a1", "a2"]));
    expect(arena.logos.map((r) => r.id)).toEqual(["l1"]);
    expect(groups.some((g) => g.label === "굿즈샵")).toBe(true);
  });

  it("선택한 레퍼런스만으로도 만든다", () => {
    const groups = buildGroups(refs, cases, opts({ refIds: ["g1", "g2", "s1"], minGroupSize: 1 }));
    const ids = groups.flatMap((g) => g.refs.map((r) => r.id)).sort();
    expect(ids).toEqual(["g1", "g2", "s1"]);
  });

  it("각 레퍼런스는 한 그룹에만 들어간다", () => {
    const groups = buildGroups(refs, cases, opts({ query: "" }));
    const ids = groups.flatMap((g) => g.refs.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("paginate", () => {
  it("균등하게 나눈다", () => {
    expect(paginate([...Array(11).keys()], 9).map((p) => p.length)).toEqual([6, 5]);
    expect(paginate([...Array(9).keys()], 9).map((p) => p.length)).toEqual([9]);
    expect(paginate([], 9)).toEqual([[]]);
  });
});

describe("buildDocument", () => {
  it("표지 + 그룹별 페이지를 만든다 (페이지당 최대 수 초과 시 분할)", () => {
    const doc = buildDocument(refs, cases, defaultSettings(), opts({ query: "조형물 굿즈샵", cover: true, maxPerPage: 4 }));
    expect(doc.pages.map((p) => p.kind)).toEqual(["cover", "reference", "reference", "reference"]);
    const labels = doc.pages.slice(1).map((p) => p.elements.find((e): e is TextElement => e.type === "text" && e.role === "section")?.text);
    expect(labels).toEqual(["Reference (1/2)", "Reference (2/2)", "Reference"]);
  });

  it("케이스 페이지에 케이스 정보와 로고 패널이 들어간다", () => {
    const doc = buildDocument(refs, cases, defaultSettings(), opts({ query: "Allianz", groupBy: "case" }));
    const page = doc.pages[0];
    expect(page.kind).toBe("case");
    const text = (role: string) => page.elements.find((e): e is TextElement => e.type === "text" && e.role === role && !e.labelFor)?.text;
    expect([text("title"), text("subtitle"), text("highlight"), text("body")]).toEqual(["Allianz Arena", "Bundesliga", "스폰서", "설명"]);
    const logo = page.elements.find((e): e is ImageElement => e.type === "image" && !!e.logo)!;
    const label = page.elements.find((e): e is TextElement => e.type === "text" && e.labelFor === logo.id)!;
    expect(label.text).toBe("Team Logo");
    expect(label.y).toBeLessThan(logo.y);
  });
});

describe("templates", () => {
  const settings = defaultSettings();
  it("자동 레이아웃 이미지는 이미지 영역 안에 배치된다", () => {
    const page = createCasePage(settings, { title: "T", images: refs.slice(0, 6), logos: [refs[10]] });
    for (const el of page.elements.filter((e) => e.type === "image")) {
      expect(el.x).toBeGreaterThanOrEqual(page.area.x - 0.01);
      expect(el.y).toBeGreaterThanOrEqual(page.area.y - 0.01);
      expect(el.x + el.w).toBeLessThanOrEqual(page.area.x + page.area.w + 0.01);
      expect(el.y + el.h).toBeLessThanOrEqual(page.area.y + page.area.h + 0.01);
    }
  });

  it("레이아웃 변경 시 수동 배치 이미지는 건드리지 않는다", () => {
    const page = createCasePage(settings, { title: "T", images: refs.slice(0, 3), logos: [] });
    const free = page.elements.find((e): e is ImageElement => e.type === "image")!;
    free.managed = false;
    Object.assign(free, { x: 1, y: 2, w: 3, h: 4 });
    const next = relayoutPage({ ...page, layout: { ...page.layout, mode: "grid", columns: 2 } });
    const same = next.elements.find((e) => e.id === free.id)!;
    expect([same.x, same.y, same.w, same.h]).toEqual([1, 2, 3, 4]);
  });

  it("페이지 크기 변경 시 비례 변환", () => {
    const page = createCasePage(settings, { title: "T", images: refs.slice(0, 2), logos: [] });
    const scaled = scalePage(page, 2, 2);
    expect(scaled.area.w).toBeCloseTo(page.area.w * 2, 5);
    const title = scaled.elements.find((e) => e.type === "text")!;
    expect(title.x).toBeCloseTo(page.elements[0].x * 2, 5);
  });
});
