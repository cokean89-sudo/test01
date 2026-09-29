// 문서 템플릿 — 6종 × 페이지 7종이 페이지 안에 그려지는지, 템플릿을 바꿔도 내용이 그대로인지, 색 토큰 · 톤온톤 팔레트.

import { describe, expect, it } from "vitest";
import type { DocSettings, DocumentData, ImageElement, Page, PageElement, Reference, TemplateId, TextElement } from "../shared/types";
import { resolveColor, resolveStyle } from "../src/components/PageView";
import { buildDocument, type BuildOptions } from "../src/layout/autobuild";
import { applyTemplate, extractContent, refreshToc, setCompareItems } from "../src/layout/switchTemplate";
import {
  createCasePage,
  createClosingPage,
  createComparePage,
  createCoverPage,
  createReferencePage,
  createSectionPage,
  createStarterPages,
  createTocPage,
  pageDims,
  textEl,
} from "../src/layout/templates";
import { applyThemeSettings, contrast, isColorToken, paletteOf, THEMES, toneScale, hexToHsl } from "../src/layout/themes";
import { DEFAULT_LAYOUT, defaultSettings } from "../src/lib/defaults";

const IDS = THEMES.map((t) => t.id) as TemplateId[];
let n = 0;
const ref = (id: string, extra: Partial<Reference> = {}): Reference => ({
  id,
  imageUrl: `https://img.example.com/${id}.jpg`,
  tags: [],
  kind: "image",
  source: "manual",
  width: 1200 + (n++ % 3) * 200,
  height: 900,
  createdAt: 0,
  ...extra,
});
const refs = Array.from({ length: 6 }, (_, i) => ref("r" + i));
const logo = ref("logo1", { kind: "logo", logoLabel: "Brand Logo" });

function themed(id: TemplateId, size: DocSettings["pageSize"] = "a4-landscape"): DocSettings {
  return applyThemeSettings({ ...defaultSettings(), pageSize: size }, id);
}

function allKinds(s: DocSettings): Page[] {
  return [
    createCoverPage(s, { images: [refs[0]] }),
    createTocPage(s),
    createSectionPage(s, { title: "브랜드 팝업", subtitle: "01 · 공간", number: "01" }),
    createCasePage(s, { title: "모닝루틴", subtitle: "Pop-up", highlight: "유형 : 팝업", description: "설명 ".repeat(40), images: refs.slice(0, 4), logos: [logo] }),
    createReferencePage(s, { title: "Pop-up Store", description: "짧은 설명", images: refs }),
    createComparePage(s, { items: 4 }),
    createClosingPage(s, { body: "문의 · team@company.com" }),
  ];
}

const texts = (p: Page) => p.elements.filter((e): e is TextElement => e.type === "text" && !e.deco);

describe("템플릿 6종 × 페이지 7종", () => {
  for (const id of IDS) {
    for (const size of ["a4-landscape", "a4-portrait", "wide-16-9"] as const) {
      it(`${id} · ${size}: 모든 요소가 페이지 안, 자동 배치 이미지는 이미지 영역 안`, () => {
        const s = themed(id, size);
        const { W, H } = pageDims(s);
        for (const p of allKinds(s)) {
          for (const el of p.elements) {
            const e = 0.6;
            expect(el.x, `${p.kind} ${el.type}`).toBeGreaterThanOrEqual(-e - (el.deco ? el.w : 0));
            expect(el.y, `${p.kind} ${el.type}`).toBeGreaterThanOrEqual(-e - (el.deco ? el.h : 0));
            if (!el.deco) {
              expect(el.x + el.w, `${p.kind} ${el.type} ${(el as TextElement).slot}`).toBeLessThanOrEqual(W + e);
              expect(el.y + el.h, `${p.kind} ${el.type} ${(el as TextElement).slot}`).toBeLessThanOrEqual(H + e);
            }
            expect(Number.isFinite(el.w) && el.w > 0 && Number.isFinite(el.h) && el.h > 0).toBe(true);
          }
          for (const img of p.elements.filter((e): e is ImageElement => e.type === "image" && !!e.managed && !e.logo)) {
            expect(img.x).toBeGreaterThanOrEqual(p.area.x - 0.6);
            expect(img.y).toBeGreaterThanOrEqual(p.area.y - 0.6);
            expect(img.x + img.w).toBeLessThanOrEqual(p.area.x + p.area.w + 0.6);
            expect(img.y + img.h).toBeLessThanOrEqual(p.area.y + p.area.h + 0.6);
          }
        }
      });
    }

    it(`${id}: 비교 페이지는 항목 수만큼 이름 · 내용 · 이미지 자리`, () => {
      const s = themed(id);
      for (const items of [2, 3, 4]) {
        const p = createComparePage(s, { items });
        const slots = texts(p).map((t) => t.slot);
        expect(slots.filter((x) => /^cmp-name-/.test(x ?? ""))).toHaveLength(items);
        expect(slots.filter((x) => /^cmp-body-/.test(x ?? ""))).toHaveLength(items);
        expect(p.elements.filter((e) => e.type === "image" && /^cmp-img-/.test(e.slot ?? ""))).toHaveLength(items);
        // 행 제목과 항목 내용은 같은 줄 높이 → 행이 맞는다
        const rows = texts(p).find((t) => t.slot === "cmp-rows")!;
        const body = texts(p).find((t) => t.slot === "cmp-body-0")!;
        const lh = (t: TextElement) => resolveStyle(s, t.role, t.style).lineHeight * resolveStyle(s, t.role, t.style).fontSize;
        expect(lh(rows)).toBeCloseTo(lh(body), 3);
        expect(rows.y).toBeCloseTo(body.y, 3);
      }
    });

    it(`${id}: 모든 색은 hex 로 풀린다 (PPTX · 인쇄에 토큰이 남지 않음)`, () => {
      const s = themed(id);
      const hex = /^#[0-9a-f]{6}$/i;
      for (const p of allKinds(s)) {
        if (p.background) expect(resolveColor(p.background, s)).toMatch(hex);
        for (const el of p.elements) {
          if (el.type === "shape") {
            if (el.fill) expect(resolveColor(el.fill, s)).toMatch(hex);
            if (el.stroke) expect(resolveColor(el.stroke, s)).toMatch(hex);
          }
          if (el.type === "text") {
            const st = resolveStyle(s, el.role, el.style);
            expect(st.color, `${id} ${p.kind} ${el.slot}`).toMatch(hex);
            if (st.background) expect(st.background).toMatch(hex);
          }
        }
      }
      for (const role of ["title", "body", "footer", "caption", "label"] as const) expect(resolveStyle(s, role).color).toMatch(hex);
    });
  }
});

describe("템플릿 바꾸기 — 내용 보존", () => {
  function sampleDoc(): DocumentData {
    const s = { ...defaultSettings() };
    const pages = [
      createCoverPage(s, { title: "브랜드 리뷰 2026" }),
      createTocPage(s, { entries: [{ num: "01", name: "브랜드", page: "03" }] }),
      createSectionPage(s, { title: "브랜드 팝업", subtitle: "공간 · 쇼윈도" }),
      createCasePage(s, { title: "모닝루틴", subtitle: "성수 팝업", highlight: "유형 : 팝업", description: "딥그린 외관 구성.", images: refs.slice(0, 3), logos: [logo] }),
      createReferencePage(s, { title: "쇼윈도", subtitle: "Display", description: "진열 사례", images: refs.slice(3, 6) }),
      createComparePage(s, { items: 3, title: "경쟁사 비교" }),
      createClosingPage(s, { body: "문의 · team@company.com" }),
    ];
    // 사용자가 직접 추가한 글, 직접 옮긴 이미지, 비교 항목 내용
    pages[4].elements.push(textEl("free", "직접 쓴 메모", { x: 40, y: 40, w: 120, h: 20 }));
    const free = pages[4].elements.find((e): e is ImageElement => e.type === "image")!;
    free.managed = false;
    Object.assign(free, { x: 11, y: 12, w: 100, h: 80 });
    const cmp = pages[5];
    for (const t of texts(cmp)) if (t.slot === "cmp-name-1") t.text = "데일리브루";
    const img = cmp.elements.find((e): e is ImageElement => e.slot === "cmp-img-2")!;
    Object.assign(img, { src: "https://img.example.com/cmp.jpg", refId: "rc" });
    return { id: "d1", title: "문서", createdAt: 0, updatedAt: 0, settings: s, pages };
  }

  const snapshot = (d: DocumentData) =>
    d.pages.map((p) => ({
      id: p.id,
      kind: p.kind,
      texts: texts(p)
        .filter((t) => !t.labelFor)
        .map((t) => t.text)
        .sort(),
      images: p.elements
        .filter((e): e is ImageElement => e.type === "image")
        .map((e) => `${e.id}|${e.src}|${e.logo ? "logo" : ""}`)
        .sort(),
      labels: texts(p)
        .filter((t) => t.labelFor)
        .map((t) => t.text),
      notes: p.notes,
    }));

  it("모든 템플릿을 돌아도 글 · 이미지 · 로고 · 직접 추가한 요소가 그대로", () => {
    const doc = sampleDoc();
    doc.pages[3].notes = "발표 메모";
    const before = snapshot(doc);
    let cur = doc;
    for (const id of ["clean", "bold", "editorial", "mono", "tonal", "default"] as TemplateId[]) {
      cur = applyTemplate(cur, id);
      expect(cur.settings.template).toBe(id);
      const after = snapshot(cur);
      for (const [i, b] of before.entries()) {
        expect(after[i].id).toBe(b.id);
        expect(after[i].kind).toBe(b.kind);
        expect(after[i].images, `${id} p${i}`).toEqual(b.images);
        expect(after[i].labels).toEqual(b.labels);
        expect(after[i].notes).toBe(b.notes);
        // 간지 번호처럼 템플릿이 더하는 글 외에는 원래 글이 모두 남아 있다
        for (const t of b.texts) expect(after[i].texts, `${id} p${i}`).toContain(t);
      }
    }
    // 직접 옮긴 이미지는 위치까지 그대로
    const free = cur.pages[4].elements.find((e) => e.type === "image" && !e.managed && !e.slot)!;
    expect([free.x, free.y, free.w, free.h]).toEqual([11, 12, 100, 80]);
  });

  it("템플릿 장식은 새로 그리고, 되돌아오면 기본 양식 좌표로", () => {
    const doc = sampleDoc();
    const bold = applyTemplate(doc, "bold");
    expect(bold.pages[0].background).toBe("ink");
    expect(bold.pages.some((p) => p.elements.some((e) => e.deco))).toBe(true);
    const back = applyTemplate(bold, "default");
    expect(back.pages.some((p) => p.kind !== "toc" && p.kind !== "compare" && p.elements.some((e) => e.deco))).toBe(false);
    const title = (d: DocumentData) => texts(d.pages[4]).find((t) => t.slot === "title")!;
    expect(title(back).x).toBeCloseTo(title(doc).x, 3);
    expect(back.settings.margin).toEqual(defaultSettings().margin);
  });

  it("직접 바꾼 오토 레이아웃은 유지, 기본값이었으면 새 템플릿 기본값", () => {
    const doc = sampleDoc();
    doc.pages[4].layout = { ...doc.pages[4].layout, mode: "grid", columns: 2, gap: 3 };
    const next = applyTemplate(doc, "editorial");
    expect(next.pages[4].layout).toMatchObject({ mode: "grid", columns: 2, gap: 3 });
    expect(next.pages[3].layout.gap).toBe(12); // 에디토리얼 기본 간격
  });

  it("간지 번호는 번호 자리가 있는 템플릿으로 갈 때 순서대로 매긴다", () => {
    const doc = sampleDoc();
    doc.pages.splice(4, 0, createSectionPage(doc.settings, { title: "경쟁사" }));
    const next = applyTemplate(doc, "clean");
    const nums = next.pages.filter((p) => p.kind === "section").map((p) => texts(p).find((t) => t.slot === "number")?.text);
    expect(nums).toEqual(["01", "02"]);
  });

  it("비교 항목 수 줄이기 · 목차 다시 만들기", () => {
    const doc = applyTemplate(sampleDoc(), "tonal");
    const cmp = setCompareItems(doc.pages[5], doc.settings, 2);
    expect(texts(cmp).filter((t) => /^cmp-name-/.test(t.slot ?? ""))).toHaveLength(2);
    expect(Object.keys(extractContent(cmp).slotImages).sort()).toEqual(["cmp-img-0", "cmp-img-1"]);
    const toc = refreshToc(doc.pages[1], doc);
    expect(texts(toc).find((t) => t.slot === "toc-name")!.text).toBe("브랜드 팝업");
    expect(texts(toc).find((t) => t.slot === "toc-page")!.text).toBe("03");
  });
});

describe("색 · 팔레트", () => {
  it("톤온톤: 메인 컬러 하나에서 밝은 → 어두운 6단계, 메인 컬러를 바꾸면 모두 바뀐다", () => {
    for (const main of THEMES.find((t) => t.id === "tonal")!.swatches!) {
      const tones = toneScale(main);
      expect(tones[3]).toBe(main);
      const light = tones.map((t) => hexToHsl(t)[2]);
      expect(light[0]).toBeGreaterThan(light[1]);
      expect(light[1]).toBeGreaterThan(light[2]);
      expect(light[4]).toBeGreaterThan(light[5]);
      // 글자 대비: 표지(tone1 on tone5), 간지(tone1 on tone4), 본문(tone6 on tone1)
      expect(contrast(tones[0], tones[4])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tones[0], tones[3])).toBeGreaterThanOrEqual(3);
      expect(contrast(tones[5], tones[0])).toBeGreaterThanOrEqual(7);
    }
    const a = paletteOf({ template: "tonal", accent: "#2f6b5b" });
    const b = paletteOf({ template: "tonal", accent: "#9a3f52" });
    expect(a.tone2).not.toBe(b.tone2);
  });

  it("모든 템플릿의 본문 글자색은 배경과 충분히 대비된다", () => {
    for (const t of THEMES) {
      const p = t.palette(t.accent);
      expect(contrast(p.ink, p.paper), t.id).toBeGreaterThanOrEqual(7);
      expect(contrast(p.muted, p.paper), t.id).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("토큰 판별", () => {
    expect(isColorToken("tone4")).toBe(true);
    expect(isColorToken("#ffffff")).toBe(false);
    expect(resolveColor("accent", { ...defaultSettings(), accent: "#123456" })).toBe("#123456");
  });
});

describe("페이지 세트 · 자동 생성", () => {
  it("새 문서 페이지 세트: 표지 · 목차 · 간지 · 케이스 · 레퍼런스 · 비교 · 마무리", () => {
    for (const id of IDS) {
      const pages = createStarterPages(themed(id));
      expect(pages.map((p) => p.kind)).toEqual(["cover", "toc", "section", "case", "reference", "compare", "closing"]);
    }
  });

  it("키워드 문서 만들기에 템플릿 · 목차 · 마무리", () => {
    const s = themed("clean");
    const opts: BuildOptions = { title: "T", query: "", matchMode: "or", groupBy: "none", layout: { ...DEFAULT_LAYOUT }, layoutAuto: true, maxPerPage: 9, cover: true, sections: false, toc: true, closing: true, minGroupSize: 2 };
    const doc = buildDocument(refs, [], s, opts);
    expect(doc.pages.map((p) => p.kind)).toEqual(["cover", "toc", "reference", "closing"]);
    // 표지에 이미지 자리가 있는 템플릿은 첫 이미지를 표지로
    expect(doc.pages[0].elements.some((e: PageElement) => e.type === "image" && e.src === refs[0].imageUrl)).toBe(true);
    // 템플릿 기본 배치(클린: 3단 격자, 간격 8)
    expect(doc.pages[2].layout).toMatchObject({ mode: "grid", columns: 3, gap: 8 });
    expect(texts(doc.pages[1]).find((t) => t.slot === "toc-page")!.text).toBe("03");
  });
});
