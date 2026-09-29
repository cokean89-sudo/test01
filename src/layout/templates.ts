// 페이지 템플릿 — 첨부 A4 템플릿(A4_Template_New.pdf)의 그리드와 구성을 재현한다.
//
//  · 그리드: 좌우 여백 10mm, 5단, 단 간격 3mm (A4 가로 기준 단 폭 약 53mm)
//  · 헤더: Title 17/21 (1단) | Sub-Title 12/16 (2단) | 짧은 글 10/17 (3~5단)
//  · 긴 글은 왼쪽 1단으로 내려가고, 이미지 영역은 2~5단으로 좁아진다 (글 배치 '자동')
//  · 표지 · 간지: 가운데 정렬 타이틀 + 한 줄 설명

import {
  PAGE_SIZES,
  type CaseStudy,
  type DocSettings,
  type ImageElement,
  type Page,
  type PageElement,
  type PageFlow,
  type PageLayout,
  type Rect,
  type Reference,
  type TextElement,
  type TextRole,
  type TextStyle,
} from "../../shared/types";
import { DEFAULT_LAYOUT, MM, REPORT_TYPOGRAPHY } from "../lib/defaults";
import { dummyText, LOREM, PLACEHOLDER_ASPECTS, placeholderImage } from "../lib/dummy";
import { uid } from "../lib/id";
import { computeLayout, safeAspect } from "./engine";
import { buildThemedPage } from "./themePages";
import { themeOf } from "./themes";

export function pageDims(settings: DocSettings): { W: number; H: number } {
  const size = PAGE_SIZES[settings.pageSize];
  return { W: size.w, H: size.h };
}

// ─── grid ───────────────────────────────────────────────────

export interface PageGrid {
  W: number;
  H: number;
  landscape: boolean;
  cols: number;
  gutter: number;
  colW: number;
  left: number;
  right: number;
  /** 헤더(타이틀 줄) 시작 y */
  top: number;
  /** 헤더가 끝나고 이미지 영역이 시작되는 y */
  headerBottom: number;
  /** 본문(이미지 영역) 끝 y */
  contentBottom: number;
}

/** 템플릿 단(column) 그리드 — 가로 페이지 5단, 세로 페이지 4단, 단 간격 3mm */
export function pageGrid(settings: DocSettings): PageGrid {
  const { W, H } = pageDims(settings);
  const m = settings.margin;
  const landscape = W >= H;
  const cols = landscape ? 5 : 4;
  const gutter = 3 * MM;
  const inner = W - m.left - m.right;
  return {
    W,
    H,
    landscape,
    cols,
    gutter,
    colW: (inner - gutter * (cols - 1)) / cols,
    left: m.left,
    right: W - m.right,
    top: m.top,
    // 템플릿 실측: 이미지 영역은 34.5mm(가로) 에서 시작 — 헤더 시작보다 61pt 아래
    headerBottom: landscape ? m.top + 60.95 : m.top + 108,
    contentBottom: H - m.bottom,
  };
}

export function colX(g: PageGrid, i: number): number {
  return g.left + i * (g.colW + g.gutter);
}

export function spanW(g: PageGrid, n: number): number {
  return g.colW * n + g.gutter * (n - 1);
}

interface HeaderSlots {
  title: Rect;
  subtitle: Rect;
  /** 짧은 글 자리 */
  text: Rect;
  /** 긴 글 자리 (왼쪽 단) */
  side: Rect;
  /** 이미지 영역 (전체 폭) */
  area: Rect;
}

/**
 * 헤더 자리. 글자 상자의 y 는 템플릿의 첫 줄 기준선(baseline)이 같아지도록 맞춘 값이다
 * (Title 기준선 50.3pt, Sub-Title 48.0pt, 글 46.9pt — A4 가로 기준).
 */
export function headerSlots(settings: DocSettings): HeaderSlots {
  const g = pageGrid(settings);
  const area = { x: g.left, y: g.headerBottom, w: g.right - g.left, h: g.contentBottom - g.headerBottom };
  if (g.landscape) {
    const textX = colX(g, 2);
    const textY = g.top - 2;
    const sideY = g.top + 123;
    return {
      title: { x: g.left, y: g.top - 3, w: g.colW, h: 44 },
      subtitle: { x: colX(g, 1), y: g.top - 1.05, w: g.colW, h: 34 },
      text: { x: textX, y: textY, w: g.right - textX, h: g.headerBottom - textY },
      side: { x: g.left, y: sideY, w: g.colW, h: g.contentBottom - sideY },
      area,
    };
  }
  // 세로 페이지: 타이틀 | 서브타이틀 한 줄, 그 아래 짧은 글
  return {
    title: { x: g.left, y: g.top - 3, w: spanW(g, 2), h: 44 },
    subtitle: { x: colX(g, 2), y: g.top - 1.05, w: spanW(g, 2), h: 34 },
    text: { x: g.left, y: g.top + 46, w: g.right - g.left, h: g.headerBottom - g.top - 50 },
    side: { x: g.left, y: g.headerBottom, w: g.colW, h: g.contentBottom - g.headerBottom },
    area,
  };
}

export function textEl(role: TextRole, text: string, rect: Rect, style?: TextStyle): TextElement {
  return { id: uid("t"), type: "text", role, text, ...rect, style };
}

export function imageFromRef(ref: Reference, managed = true): ImageElement {
  return {
    id: uid("i"),
    type: "image",
    src: ref.imageUrl,
    refId: ref.id,
    natW: ref.width,
    natH: ref.height,
    fit: ref.kind === "logo" ? "contain" : "cover",
    managed,
    logo: ref.kind === "logo" && managed ? true : undefined,
    caption: ref.title || LOREM.caption,
    captionPos: "none",
    sourceUrl: ref.sourceUrl,
    x: 0,
    y: 0,
    w: 120,
    h: 90,
  };
}

function flowFor(slots: HeaderSlots, g: PageGrid): PageFlow {
  return { mode: "auto", header: slots.text, side: slots.side, gutter: g.gutter };
}

// ─── content model (템플릿 전환 시 내용 보존) ─────────────────────

/**
 * 페이지 내용 — 템플릿과 무관하게 옮겨 다니는 부분.
 * texts: 자리(slot) 이름 → 글, images: 자동 레이아웃 이미지, logos: 로고 + 라벨,
 * slotImages: 고정 자리 이미지(비교 항목 등), extras: 사용자가 직접 추가한 요소(그대로 둔다)
 */
export interface PageContent {
  texts: Partial<Record<string, string>>;
  images: ImageElement[];
  logos: { img: ImageElement; label: string }[];
  slotImages: Partial<Record<string, ImageElement>>;
  extras: PageElement[];
}

/** 페이지를 다시 만들 때 유지하는 정보 */
export interface PageMeta {
  id?: string;
  group?: string;
  caseId?: string;
  layout?: Partial<PageLayout>;
  flowMode?: PageFlow["mode"];
  notes?: string;
  hideFooter?: boolean;
  /** 비교 페이지 항목 수 (2~4) */
  items?: number;
}

export function emptyContent(): PageContent {
  return { texts: {}, images: [], logos: [], slotImages: {}, extras: [] };
}

export function slotText(slot: string, role: TextRole, text: string, rect: Rect, style?: TextStyle): TextElement {
  return { ...textEl(role, text, rect, style), slot };
}

function logoElements(logos: PageContent["logos"]): PageElement[] {
  const out: PageElement[] = [];
  for (const { img, label } of logos) {
    const logo = { ...img, logo: true, managed: true, fit: "contain" as const };
    out.push(logo, { ...textEl("label", label, { x: 0, y: 0, w: 80, h: 10 }), labelFor: logo.id });
  }
  return out;
}

function basePage(kind: Page["kind"], meta: PageMeta, fields: Omit<Page, "id" | "kind" | "layout"> & { layout: PageLayout }): Page {
  return {
    id: meta.id ?? uid("p"),
    kind,
    group: meta.group,
    caseId: meta.caseId,
    notes: meta.notes,
    ...fields,
  };
}

// ─── 기본 템플릿 (A4 부서 양식) ─────────────────────────────────

/** 케이스 스터디 — 타이틀 | 서브타이틀 | (강조 라인 +) 설명, 로고 패널 + 이미지. 설명이 길면 왼쪽 단으로 */
export function defaultCase(settings: DocSettings, c: PageContent, meta: PageMeta): Page {
  const g = pageGrid(settings);
  const slots = headerSlots(settings);
  const elements: PageElement[] = [
    slotText("title", "title", c.texts.title || dummyText("title"), slots.title),
    slotText("subtitle", "subtitle", c.texts.subtitle || dummyText("subtitle"), slots.subtitle),
  ];
  const highlight = c.texts.highlight?.trim();
  if (highlight) elements.push(slotText("highlight", "highlight", c.texts.highlight!, { ...slots.text, h: 17 }));
  elements.push(slotText("body", "body", c.texts.body || dummyText("body"), slots.text));
  elements.push(...logoElements(c.logos), ...c.images, ...c.extras);
  const page = basePage("case", meta, {
    layout: { ...DEFAULT_LAYOUT, ...meta.layout },
    area: slots.area,
    flow: { ...flowFor(slots, g), mode: meta.flowMode ?? "auto" },
    elements,
  });
  return relayoutPage(page, settings);
}

/** 레퍼런스 — 타이틀 | 서브타이틀 | 짧은 글, 아래 전체 폭에 이미지 (글이 길면 왼쪽 단으로) */
export function defaultReference(settings: DocSettings, c: PageContent, meta: PageMeta): Page {
  const g = pageGrid(settings);
  const slots = headerSlots(settings);
  const elements: PageElement[] = [
    slotText("title", "title", c.texts.title || dummyText("title"), slots.title),
    slotText("subtitle", "subtitle", c.texts.subtitle || dummyText("subtitle"), slots.subtitle),
  ];
  if (c.texts.highlight?.trim()) elements.push(slotText("highlight", "highlight", c.texts.highlight, { ...slots.text, h: 17 }));
  // 레퍼런스 페이지 설명은 보통 한두 줄 (템플릿 '짧은 텍스트')
  elements.push(slotText("body", "body", c.texts.body || LOREM.body.split(". ")[0] + ".", slots.text));
  elements.push(...logoElements(c.logos), ...c.images, ...c.extras);
  const page = basePage("reference", meta, {
    layout: { ...DEFAULT_LAYOUT, ...meta.layout },
    area: slots.area,
    flow: { ...flowFor(slots, g), mode: meta.flowMode ?? "auto" },
    elements,
  });
  return relayoutPage(page, settings);
}

/** 표지 · 간지 공통: 페이지 가운데에 타이틀(아래 정렬)과 설명(위 정렬)을 붙여 둔다 — 줄이 늘어도 겹치지 않는다 */
function centeredPair(settings: DocSettings, title: { text: string; style: TextStyle; bottom: number }, sub: { text: string; style: TextStyle; top: number }) {
  const g = pageGrid(settings);
  const w = g.right - g.left;
  return [
    slotText("title", "title", title.text, { x: g.left, y: title.bottom - 120, w, h: 120 }, { align: "center", vAlign: "bottom", ...title.style }),
    slotText("subtitle", "subtitle", sub.text, { x: g.left, y: sub.top, w, h: 60 }, { align: "center", vAlign: "top", ...sub.style }),
  ];
}

/** 표지 · 간지 · 마무리에 이미지가 있으면 아래쪽에 모은다 (다른 템플릿에서 옮겨 온 경우) */
function lowerArea(settings: DocSettings): Rect {
  const g = pageGrid(settings);
  const top = g.H / 2 + 46;
  return { x: g.left, y: top, w: g.right - g.left, h: Math.max(20, g.contentBottom - top) };
}

/**
 * 표지 — 템플릿: 가운데 TITLE (Poppins SemiBold 14.5pt, 대문자) + PRESENTED BY 부서명 (ExtraLight 8pt).
 * {title} 은 문서 제목, {dept} 는 부서명(하단 왼쪽 문구)으로 표시된다.
 */
export function defaultCover(settings: DocSettings, c: PageContent, meta: PageMeta): Page {
  const g = pageGrid(settings);
  const mid = g.H / 2;
  const elements: PageElement[] = centeredPair(
    settings,
    { text: c.texts.title || "{title}", style: { fontSize: 14.5, lineHeight: 1.2, uppercase: true }, bottom: mid + 2.99 },
    { text: c.texts.subtitle ?? "PRESENTED BY {dept}", style: { fontSize: 8, fontWeight: 200, lineHeight: 1.4, uppercase: true }, top: mid + 3.36 },
  );
  if (c.texts.highlight?.trim()) {
    elements.push(slotText("highlight", "highlight", c.texts.highlight, { x: g.left, y: g.top, w: g.right - g.left, h: 14 }, { align: "center", fontSize: 7.5, color: INK_TOKEN }));
  }
  elements.push(...c.images, ...c.extras);
  return relayoutPage(
    basePage("cover", meta, { layout: { ...DEFAULT_LAYOUT, ...meta.layout }, area: lowerArea(settings), elements, hideFooter: meta.hideFooter ?? true }),
    settings,
  );
}

/** 간지(도비라) — 템플릿: 가운데 Section Break (Poppins Medium 14pt) + 설명 (ExtraLight 10.5pt) */
export function defaultSection(settings: DocSettings, c: PageContent, meta: PageMeta): Page {
  const g = pageGrid(settings);
  const mid = g.H / 2;
  const elements: PageElement[] = centeredPair(
    settings,
    { text: c.texts.title || "Section Break", style: { fontSize: 14, fontWeight: 500, lineHeight: 1.2 }, bottom: mid + 1.16 },
    { text: c.texts.subtitle ?? "Relevant Contents Goes Here", style: { fontSize: 10.5, fontWeight: 200, lineHeight: 1.4 }, top: mid + 1.66 },
  );
  if (c.texts.number?.trim()) {
    elements.push(slotText("number", "free", c.texts.number, { x: g.left, y: mid - 150, w: g.right - g.left, h: 20 }, { align: "center", fontFamily: "Poppins", fontSize: 10, fontWeight: 300 }));
  }
  elements.push(...c.images, ...c.extras);
  return relayoutPage(
    basePage("section", meta, { layout: { ...DEFAULT_LAYOUT, ...meta.layout }, area: lowerArea(settings), elements, hideFooter: meta.hideFooter ?? true }),
    settings,
  );
}

export function defaultBlank(settings: DocSettings, c: PageContent, meta: PageMeta): Page {
  const g = pageGrid(settings);
  return relayoutPage(
    basePage("blank", meta, {
      layout: { ...DEFAULT_LAYOUT, ...meta.layout },
      area: { x: g.left, y: g.headerBottom, w: g.right - g.left, h: g.contentBottom - g.headerBottom },
      elements: [...logoElements(c.logos), ...c.images, ...c.extras],
      hideFooter: meta.hideFooter,
    }),
    settings,
  );
}

const INK_TOKEN = "ink";

// ─── 페이지 만들기 (입력 → 내용 → 템플릿) ──────────────────────────

export interface CasePageInput {
  caseStudy?: CaseStudy;
  title: string;
  subtitle?: string;
  highlight?: string;
  description?: string;
  images: Reference[];
  logos: Reference[];
  layout?: Partial<PageLayout>;
  /** 이미지가 없을 때 채울 회색 박스 자리 수 */
  placeholders?: { images: number; logos: number };
}

/** 케이스 스터디 페이지 */
export function createCasePage(settings: DocSettings, input: CasePageInput): Page {
  const c = emptyContent();
  const templateOnly = !input.images.length && !input.logos.length && !!input.placeholders;
  c.texts = { title: input.title, subtitle: input.subtitle, highlight: input.highlight?.trim() || (templateOnly ? dummyText("highlight") : ""), body: input.description };
  for (const logo of input.logos.slice(0, 3)) c.logos.push({ img: imageFromRef(logo, true), label: logo.logoLabel || logo.title || "Logo" });
  c.images = input.images.map((r) => imageFromRef(r, true));
  if (templateOnly) {
    for (let i = 0; i < input.placeholders!.logos; i++) c.logos.push({ img: placeholderImage(1.6, { logo: true }), label: "Logo" });
    for (let i = 0; i < input.placeholders!.images; i++) c.images.push(placeholderImage(PLACEHOLDER_ASPECTS[i % PLACEHOLDER_ASPECTS.length]));
  }
  return buildPage("case", settings, c, { group: input.title, caseId: input.caseStudy?.id, layout: input.layout });
}

export interface ReferencePageInput {
  title: string;
  subtitle?: string;
  description?: string;
  group?: string;
  images: Reference[];
  layout?: Partial<PageLayout>;
  /** 이미지가 없을 때 채울 회색 박스 자리 수 */
  placeholders?: number;
}

/** 레퍼런스(그리드) 페이지 */
export function createReferencePage(settings: DocSettings, input: ReferencePageInput): Page {
  const c = emptyContent();
  c.texts = { title: input.title, subtitle: input.subtitle, body: input.description };
  c.images = input.images.map((r) => imageFromRef(r, true));
  if (!input.images.length && input.placeholders) {
    for (let i = 0; i < input.placeholders; i++) c.images.push(placeholderImage(PLACEHOLDER_ASPECTS[i % PLACEHOLDER_ASPECTS.length]));
  }
  return buildPage("reference", settings, c, { group: input.group ?? input.title, layout: input.layout });
}

/** 표지 — 이미지 자리가 있는 템플릿은 회색 박스 하나를 넣어 둔다 */
export function createCoverPage(settings: DocSettings, input: { title?: string; subtitle?: string; highlight?: string; images?: Reference[] } = {}): Page {
  const c = emptyContent();
  c.texts = { title: input.title, subtitle: input.subtitle, highlight: input.highlight };
  c.images = (input.images ?? []).map((r) => imageFromRef(r, true));
  if (!c.images.length) for (let i = 0; i < coverPlaceholders(settings); i++) c.images.push(placeholderImage(i ? 1 : 0.8));
  return buildPage("cover", settings, c, {});
}

/** 간지 (섹션 구분) */
export function createSectionPage(settings: DocSettings, input: { title: string; subtitle?: string; number?: string }): Page {
  const c = emptyContent();
  c.texts = { title: input.title, subtitle: input.subtitle, number: input.number ?? (themeOf(settings).id === "default" ? undefined : "01") };
  return buildPage("section", settings, c, { group: input.title });
}

export function createBlankPage(settings: DocSettings): Page {
  return buildPage("blank", settings, emptyContent(), {});
}

/** 목차 — entries 가 없으면 Lorem Ipsum 목록 */
export function createTocPage(settings: DocSettings, input: { entries?: TocEntry[] } = {}): Page {
  const c = emptyContent();
  const entries = input.entries?.length ? input.entries : DUMMY_TOC;
  c.texts = tocTexts(entries);
  return buildPage("toc", settings, c, {});
}

/** 경쟁사·상품 비교 — 2~4개 항목을 나란히 */
export function createComparePage(settings: DocSettings, input: { items?: number; title?: string; subtitle?: string } = {}): Page {
  const c = emptyContent();
  c.texts = { title: input.title, subtitle: input.subtitle };
  return buildPage("compare", settings, c, { items: input.items ?? 3 });
}

/** 마무리 */
export function createClosingPage(settings: DocSettings, input: { title?: string; subtitle?: string; body?: string } = {}): Page {
  const c = emptyContent();
  c.texts = { title: input.title, subtitle: input.subtitle, body: input.body };
  return buildPage("closing", settings, c, {});
}

/**
 * 새 문서 시작 페이지 — full: 표지 · 목차 · 간지 · 케이스 스터디 · 레퍼런스 그리드 · 비교 · 마무리 (템플릿 페이지 세트),
 * basic: 표지 + 레퍼런스 1장
 */
export function createStarterPages(settings: DocSettings, set: "full" | "basic" = "full"): Page[] {
  if (set === "basic") return [createCoverPage(settings), createReferencePage(settings, { title: "", images: [], placeholders: 5 })];
  const pages = [
    createCoverPage(settings),
    createTocPage(settings),
    createSectionPage(settings, { title: "", number: "01" }),
    createCasePage(settings, { title: "", images: [], logos: [], placeholders: { images: 4, logos: 2 } }),
    createReferencePage(settings, { title: "", images: [], placeholders: 5 }),
    createComparePage(settings),
    createClosingPage(settings),
  ];
  pages[1] = createTocPage(settings, { entries: tocEntries(pages, settings) });
  return pages;
}

/** 표지에 이미지 자리가 있는 템플릿 */
export function coverWantsImage(settings: DocSettings): boolean {
  const id = themeOf(settings).id;
  return id === "clean" || id === "editorial" || id === "mono";
}

function coverPlaceholders(settings: DocSettings): number {
  return coverWantsImage(settings) ? 1 : 0;
}

// ─── 목차 ───────────────────────────────────────────────────

export interface TocEntry {
  num: string;
  name: string;
  page: string;
}

const DUMMY_TOC: TocEntry[] = [
  { num: "01", name: "Lorem ipsum", page: "03" },
  { num: "02", name: "Dolor sit amet", page: "05" },
  { num: "03", name: "Consectetur adipiscing", page: "08" },
  { num: "04", name: "Sed do eiusmod", page: "11" },
];

export function tocTexts(entries: TocEntry[]): Partial<Record<string, string>> {
  return {
    "toc-num": entries.map((e) => e.num).join("\n"),
    "toc-name": entries.map((e) => e.name).join("\n"),
    "toc-page": entries.map((e) => e.page).join("\n"),
  };
}

/** 문서의 간지(섹션)로 목차 항목을 만든다. 간지가 없으면 케이스·레퍼런스·비교 페이지 그룹으로 */
export function tocEntries(pages: Page[], settings: DocSettings): TocEntry[] {
  const titleOf = (p: Page) =>
    (p.elements.find((e): e is TextElement => e.type === "text" && !e.deco && (e.slot === "title" || (!e.slot && e.role === "title")))?.text ?? p.group ?? "").replace(/\s*\(\d+\/\d+\)$/, "");
  const pick = (kinds: Page["kind"][]) => {
    const seen = new Set<string>();
    const out: { name: string; index: number }[] = [];
    pages.forEach((p, index) => {
      if (!kinds.includes(p.kind)) return;
      const name = titleOf(p).replace(/\s+/g, " ").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push({ name, index });
    });
    return out;
  };
  let list = pick(["section"]);
  if (!list.length) list = pick(["case", "reference", "compare"]);
  return list.slice(0, 12).map((e, i) => ({
    num: String(i + 1).padStart(2, "0"),
    name: e.name,
    page: String(e.index + settings.pageNumberStart).padStart(2, "0"),
  }));
}

// ─── dispatch ───────────────────────────────────────────────

/** 페이지 종류 × 문서 템플릿으로 페이지를 만든다 — 기본 템플릿은 A4 부서 양식 좌표를 그대로 쓴다 */
export function buildPage(kind: Page["kind"], settings: DocSettings, content: PageContent, meta: PageMeta): Page {
  const theme = themeOf(settings);
  if (theme.id === "default") {
    if (kind === "case") return defaultCase(settings, content, meta);
    if (kind === "reference") return defaultReference(settings, content, meta);
    if (kind === "cover") return defaultCover(settings, content, meta);
    if (kind === "section") return defaultSection(settings, content, meta);
    if (kind === "blank") return defaultBlank(settings, content, meta);
  }
  return buildThemedPage(kind, settings, content, meta);
}

// ─── text flow (짧은 글 / 긴 글) ───────────────────────────────

/** 글자 폭 추정 (em). 한글·한자 ≈ 0.92em, 영문 소문자 ≈ 0.52em, 공백 ≈ 0.26em */
function charEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c === 32) return 0.26;
  if ((c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3130 && c <= 0x318f) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x30ff)) return 0.92;
  if (c >= 0x30 && c <= 0x39) return 0.58;
  if (c >= 0x41 && c <= 0x5a) return 0.66;
  if (c >= 0x61 && c <= 0x7a) return 0.52;
  return 0.34;
}

/** 상자 폭 width(pt) 에 글이 몇 줄로 들어가는지 추정 (단어 단위 줄바꿈 여유 10% 포함) */
export function estimateLines(text: string, fontSize: number, width: number, tracking = 0): number {
  if (width <= 0) return Infinity;
  let lines = 0;
  for (const para of text.split("\n")) {
    let em = 0;
    for (const ch of para) em += charEm(ch) + tracking / 1000;
    lines += Math.max(1, Math.ceil((em * fontSize * 1.1) / width));
  }
  return lines;
}

function roleStyle(settings: DocSettings | undefined, el: TextElement) {
  const merged = { ...REPORT_TYPOGRAPHY.free, ...REPORT_TYPOGRAPHY[el.role], ...settings?.typography[el.role], ...el.style };
  const size = merged.fontSize ?? 10;
  return { size, line: size * (merged.lineHeight ?? 1.6), tracking: merged.tracking ?? 0 };
}

function flowTexts(page: Page) {
  const texts = page.elements.filter((e): e is TextElement => e.type === "text" && !e.labelFor);
  return { highlight: texts.find((t) => t.role === "highlight"), body: texts.find((t) => t.role === "body") };
}

/** 글 길이로 짧은 글(헤더) / 긴 글(왼쪽 단)을 고른다 */
export function resolveFlow(page: Page, settings?: DocSettings): "header" | "side" {
  const flow = page.flow!;
  if (flow.mode === "header" || flow.mode === "side") return flow.mode;
  if (flow.mode === "fixed") return flow.resolved ?? "header";
  const { highlight, body } = flowTexts(page);
  let height = 0;
  for (const el of [highlight, body]) {
    if (!el) continue;
    const s = roleStyle(settings, el);
    height += estimateLines(el.text, s.size, flow.header.w, s.tracking) * s.line;
  }
  return height <= flow.header.h + 0.5 ? "header" : "side";
}

/** 글 배치를 적용 — 강조 라인과 본문을 고른 자리에 위아래로 쌓는다. 이미지 영역을 반환 */
function applyFlow(page: Page, settings?: DocSettings): Rect {
  const flow = page.flow;
  if (!flow) return page.area;
  const placement = resolveFlow(page, settings);
  flow.resolved = placement;
  if (flow.mode !== "fixed") {
    const slot = placement === "header" ? flow.header : flow.side;
    const { highlight, body } = flowTexts(page);
    let y = slot.y;
    if (highlight) {
      const s = roleStyle(settings, highlight);
      const h = Math.max(s.line, estimateLines(highlight.text, s.size, slot.w, s.tracking) * s.line);
      Object.assign(highlight, { x: slot.x, y, w: slot.w, h });
      y += h;
    }
    if (body) Object.assign(body, { x: slot.x, y, w: slot.w, h: Math.max(20, slot.y + slot.h - y) });
  }
  if (placement === "header") return page.area;
  // 긴 글이면 이미지 영역은 왼쪽 단 오른쪽부터
  const a = page.area;
  const x = Math.max(a.x, flow.side.x + flow.side.w + flow.gutter);
  return { x, y: a.y, w: Math.max(10, a.x + a.w - x), h: a.h };
}

/** 페이지의 이미지 영역 (글 배치 반영) — 편집기의 점선 영역 표시용 */
export function effectiveArea(page: Page): Rect {
  const flow = page.flow;
  if (!flow || (flow.resolved ?? "header") === "header") return page.area;
  const a = page.area;
  const x = Math.max(a.x, flow.side.x + flow.side.w + flow.gutter);
  return { x, y: a.y, w: Math.max(10, a.x + a.w - x), h: a.h };
}

// ─── relayout ───────────────────────────────────────────────

export function isManagedImage(el: PageElement): el is ImageElement {
  return el.type === "image" && !!el.managed && !el.logo;
}

export function imageAspect(el: ImageElement): number {
  return safeAspect(el.natW && el.natH ? el.natW / el.natH : undefined);
}

/** 로고 개수에 따른 로고 패널 비율 */
function logoPanelAspect(count: number): number {
  return [1.3, 1.7, 2.3][Math.min(count, 3) - 1] ?? 1.7;
}

/**
 * 페이지를 다시 배치한다 — 글 배치(짧은 글/긴 글)를 정하고, 자동 레이아웃 대상 이미지(와 로고 패널)를
 * page.layout(오토 레이아웃) 설정으로 채운다. 새 페이지 객체를 반환(입력은 변경하지 않음).
 * settings 를 주면 문서 타이포(본문 크기·행간)로 글 길이를 더 정확히 잰다.
 */
export function relayoutPage(input: Page, settings?: DocSettings): Page {
  const page: Page = { ...input, flow: input.flow ? { ...input.flow } : undefined, elements: input.elements.map((e) => ({ ...e })) };
  const area = applyFlow(page, settings);
  const images = page.elements.filter(isManagedImage);
  const logos = page.elements.filter((e): e is ImageElement => e.type === "image" && !!e.logo);
  const aspects: number[] = [];
  if (logos.length) aspects.push(logoPanelAspect(logos.length));
  aspects.push(...images.map(imageAspect));
  const rects = computeLayout(aspects, area, page.layout);
  let k = 0;
  if (logos.length) {
    placeLogoPanel(page, logos, rects[0]);
    k = 1;
  }
  images.forEach((img, i) => {
    const r = rects[i + k];
    if (r) Object.assign(img, { x: r.x, y: r.y, w: r.w, h: r.h, rotation: 0 });
  });
  return page;
}

function placeLogoPanel(page: Page, logos: ImageElement[], r: Rect): void {
  const gap = page.layout.gap;
  const count = logos.length;
  const colW = (r.w - gap * (count - 1)) / count;
  const labelH = 10;
  logos.forEach((logo, i) => {
    const x = r.x + i * (colW + gap);
    const label = page.elements.find((e): e is TextElement => e.type === "text" && e.labelFor === logo.id);
    if (label) Object.assign(label, { x, y: r.y, w: colW, h: labelH });
    const padX = colW * 0.08;
    const top = r.y + labelH + r.h * 0.12;
    Object.assign(logo, { x: x + padX, y: top, w: colW - padX * 2, h: Math.max(10, r.y + r.h - top - r.h * 0.12), fit: "contain" });
  });
}

/** 페이지 크기 변경 시 모든 요소 좌표를 비례 변환한다. */
export function scalePage(page: Page, sx: number, sy: number, settings?: DocSettings): Page {
  const scaleRect = <T extends Rect>(r: T): T => ({ ...r, x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy });
  const flow = page.flow ? { ...page.flow, header: scaleRect(page.flow.header), side: scaleRect(page.flow.side), gutter: page.flow.gutter * sx } : undefined;
  return relayoutPage({ ...page, area: scaleRect(page.area), flow, elements: page.elements.map(scaleRect) }, settings);
}
