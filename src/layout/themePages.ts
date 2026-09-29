// 템플릿별 페이지 디자인 — 표지 / 목차 / 섹션 구분 / 케이스 스터디 / 레퍼런스 그리드 / 경쟁사·상품 비교 / 마무리.
//
// 각 템플릿(recipe)은 페이지 종류마다 '틀(Spec)'만 정한다: 장식 도형, 글 자리(slot), 이미지 영역, 글 배치.
// 내용(글·이미지)은 PageContent 로 받아 자리에 채우므로, 템플릿을 바꿔도 내용은 그대로 옮겨 간다.
// 이미지 영역은 기존 오토 레이아웃 엔진(relayoutPage → computeLayout)이 채운다.

import type { DocSettings, ImageElement, Page, PageElement, PageKind, Rect, ShapeElement, TextRole, TextStyle } from "../../shared/types";
import { dummyText, LOREM, placeholderImage } from "../lib/dummy";
import { uid } from "../lib/id";
import { colX, headerSlots, pageDims, pageGrid, relayoutPage, slotText, spanW, textEl, type PageContent, type PageMeta } from "./templates";
import { themeLayout, themeOf, type ThemeDef } from "./themes";

// ─── context & helpers ──────────────────────────────────────

interface Ctx {
  s: DocSettings;
  t: ThemeDef;
  W: number;
  H: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cw: number;
  ch: number;
  land: boolean;
}

function ctx(s: DocSettings): Ctx {
  const { W, H } = pageDims(s);
  const m = s.margin;
  return { s, t: themeOf(s), W, H, x0: m.left, y0: m.top, x1: W - m.right, y1: H - m.bottom, cw: W - m.left - m.right, ch: H - m.top - m.bottom, land: W >= H };
}

interface TextSpec {
  slot: string;
  role: TextRole;
  rect: Rect;
  style?: TextStyle;
  /** 내용이 비어 있을 때 넣을 글 (빈 문자열이면 요소를 만들지 않는다) */
  fallback: string;
}

interface Spec {
  /** 페이지 배경 (색 토큰 또는 hex) */
  background?: string;
  /** 이미지 아래에 깔리는 장식 */
  under: PageElement[];
  /** 이미지 위에 얹는 장식 (띠 · 테두리) */
  over?: PageElement[];
  texts: TextSpec[];
  /** 자동 레이아웃 이미지 영역 */
  area: Rect;
  flow?: { header: Rect; side: Rect; gutter: number };
  hideFooter?: boolean;
  /** 고정 자리 이미지 (비교 항목) */
  slotImages?: { slot: string; rect: Rect }[];
}

const R = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w: Math.max(1, w), h: Math.max(1, h) });

function deco<T extends PageElement>(el: T): T {
  return { ...el, deco: true, locked: true };
}

function box(x: number, y: number, w: number, h: number, fill: string, o: { radius?: number; stroke?: string; strokeWidth?: number; opacity?: number } = {}): ShapeElement {
  return deco({ id: uid("s"), type: "shape", shape: "rect", ...R(x, y, w, h), fill, ...o });
}

function circle(cx: number, cy: number, r: number, fill: string, opacity?: number): ShapeElement {
  return deco({ id: uid("s"), type: "shape", shape: "ellipse", x: cx - r, y: cy - r, w: r * 2, h: r * 2, fill, opacity });
}

/** 가로선 — y 는 선의 가운데 */
function hline(x: number, y: number, w: number, color: string, weight = 0.5): ShapeElement {
  const h = Math.max(weight, 1);
  return deco({ id: uid("s"), type: "shape", shape: "line", x, y: y - h / 2, w, h, stroke: color, strokeWidth: weight });
}

function vline(x: number, y: number, h: number, color: string, weight = 0.5): ShapeElement {
  const w = Math.max(weight, 1);
  return deco({ id: uid("s"), type: "shape", shape: "line", x: x - w / 2, y, w, h: Math.max(h, w + 0.01), stroke: color, strokeWidth: weight });
}

const lines = (text: string | undefined) => (text ?? "").split("\n").length;

// ─── rows (목차 · 비교 표) ───────────────────────────────────────

interface RowStyle {
  rowH: number;
  rule?: { color: string; weight: number; top?: boolean };
}

/** 목차 — 번호 · 이름 · 쪽 세 칸, 줄마다 같은 높이 (줄 높이로 칸을 맞춘다) */
function tocRows(
  r: Rect,
  rows: number,
  o: RowStyle & { numW: number; pageW: number; num: TextStyle; name: TextStyle; page: TextStyle },
): { texts: TextSpec[]; deco: PageElement[] } {
  // 항목이 적으면 줄을 넉넉하게(최대 1.6배), 많으면 영역에 맞게 줄인다
  const rowH = Math.min(o.rowH * 1.6, Math.max(o.rowH, r.h / Math.max(rows, 6)), r.h / Math.max(1, rows));
  const h = rowH * rows;
  const lh = (st: TextStyle) => ({ ...st, lineHeight: rowH / (st.fontSize ?? 10) });
  const texts: TextSpec[] = [
    { slot: "toc-num", role: "free", rect: R(r.x, r.y, o.numW, h), style: lh(o.num), fallback: "" },
    { slot: "toc-name", role: "free", rect: R(r.x + o.numW, r.y, r.w - o.numW - o.pageW, h), style: lh(o.name), fallback: "" },
    { slot: "toc-page", role: "free", rect: R(r.x + r.w - o.pageW, r.y, o.pageW, h), style: { ...lh(o.page), align: "right" }, fallback: "" },
  ];
  const decoEls: PageElement[] = [];
  if (o.rule) {
    if (o.rule.top) decoEls.push(hline(r.x, r.y, r.w, o.rule.color, o.rule.weight));
    for (let i = 1; i <= rows; i++) decoEls.push(hline(r.x, r.y + rowH * i, r.w, o.rule.color, o.rule.weight));
  }
  return { texts, deco: decoEls };
}

interface CompareStyle extends RowStyle {
  labelW: number;
  gap: number;
  pad: number;
  imgRatio: number;
  nameH: number;
  label: TextStyle;
  name: TextStyle;
  body: TextStyle;
  /** 항목 칸 배경 */
  card?: (r: Rect, i: number) => PageElement[];
  /** 이름을 이미지 위 띠에 둔다 */
  nameOnTop?: boolean;
  ruleSpan?: "full" | "items";
}

export const COMPARE_ROWS_FALLBACK = "가격대\n주요 채널\n패키지\n차별점";
const ITEM_NAMES = ["Brand A", "Brand B", "Brand C", "Brand D"];
const ITEM_BODY = "Lorem ipsum\nDolor sit amet\nConsectetur\nAdipiscing elit";

/** 비교 표 — 왼쪽 행 제목 + 항목 2~4개 (이미지 · 이름 · 행별 내용) */
function compareTable(r: Rect, items: number, rows: number, o: CompareStyle): { texts: TextSpec[]; deco: PageElement[]; images: { slot: string; rect: Rect }[] } {
  const colW = (r.w - o.labelW - o.gap * items) / items;
  const nameGap = 6;
  const fixed = o.pad * 2 + nameGap * 2 + 2 + o.nameH;
  let rowH = o.rowH;
  let imgH = colW * o.imgRatio;
  let free = r.h - fixed - rows * rowH - imgH;
  if (free > 0) {
    // 남는 높이는 줄 간격 → 이미지 순으로 나눠 쓴다
    const add = Math.min((free * 0.4) / rows, o.rowH * 0.45);
    rowH += add;
    free -= add * rows;
    imgH += Math.min(free, colW * 1.1 - imgH);
  } else {
    imgH = Math.max(r.h * 0.18, imgH + free);
    free = r.h - fixed - rows * rowH - imgH;
    if (free < 0) rowH = Math.max(10, rowH + free / rows);
  }
  const top = r.y + o.pad;
  const imgY = o.nameOnTop ? top + o.nameH + nameGap : top;
  const nameY = o.nameOnTop ? top : top + imgH + nameGap;
  const bodyTop = (o.nameOnTop ? imgY + imgH : nameY + o.nameH) + nameGap + 2;
  const tableH = rowH * rows;
  const lh = (st: TextStyle) => ({ ...st, lineHeight: rowH / (st.fontSize ?? 9) });
  const texts: TextSpec[] = [{ slot: "cmp-rows", role: "free", rect: R(r.x, bodyTop, o.labelW, tableH), style: lh(o.label), fallback: COMPARE_ROWS_FALLBACK }];
  const decoEls: PageElement[] = [];
  const images: { slot: string; rect: Rect }[] = [];
  for (let i = 0; i < items; i++) {
    const x = r.x + o.labelW + o.gap * (i + 1) + colW * i;
    const cardH = bodyTop + tableH + o.pad - r.y;
    if (o.card) decoEls.push(...o.card(R(x, r.y, colW, cardH), i));
    images.push({ slot: `cmp-img-${i}`, rect: R(x + o.pad, imgY, colW - o.pad * 2, imgH) });
    texts.push({ slot: `cmp-name-${i}`, role: "free", rect: R(x + o.pad, nameY, colW - o.pad * 2, o.nameH), style: { vAlign: "middle", ...o.name }, fallback: ITEM_NAMES[i] });
    texts.push({ slot: `cmp-body-${i}`, role: "free", rect: R(x + o.pad, bodyTop, colW - o.pad * 2, tableH), style: lh(o.body), fallback: ITEM_BODY });
  }
  if (o.rule) {
    const rx = o.ruleSpan === "items" ? r.x + o.labelW + o.gap : r.x;
    const rw = r.x + r.w - rx;
    if (o.rule.top) decoEls.push(hline(rx, bodyTop, rw, o.rule.color, o.rule.weight));
    for (let i = 1; i <= rows; i++) decoEls.push(hline(rx, bodyTop + rowH * i, rw, o.rule.color, o.rule.weight));
  }
  return { texts, deco: decoEls, images };
}

// ─── recipes ────────────────────────────────────────────────

interface Recipe {
  cover(c: Ctx): Spec;
  section(c: Ctx): Spec;
  /** 케이스 · 레퍼런스 · 빈 페이지: 헤더 + 이미지 영역 + 글 배치 */
  content(c: Ctx, kind: "case" | "reference" | "blank"): Spec;
  toc(c: Ctx, rows: number): Spec;
  compare(c: Ctx, items: number, rows: number): Spec;
  closing(c: Ctx): Spec;
}

const TITLE = (fallback = dummyText("title")) => fallback;

// ── 기본 (A4 부서 양식): 목차 · 비교 · 마무리만 여기서 (나머지는 templates.ts) ──

const DEFAULT: Recipe = {
  cover: () => {
    throw new Error("default cover is built in templates.ts");
  },
  section: () => {
    throw new Error("default section is built in templates.ts");
  },
  content: () => {
    throw new Error("default content is built in templates.ts");
  },
  toc(c, rows) {
    const h = headerSlots(c.s);
    const g = pageGrid(c.s);
    const list = tocRows(R(colX(g, 1), h.area.y, spanW(g, c.land ? 3 : 3), h.area.h), rows, {
      rowH: 24,
      numW: 34,
      pageW: 40,
      num: { fontFamily: "Poppins", fontSize: 9, fontWeight: 500, color: "ink" },
      name: { fontFamily: "Pretendard", fontSize: 10, fontWeight: 400, color: "ink" },
      page: { fontFamily: "Poppins", fontSize: 8, fontWeight: 300, color: "ink" },
      rule: { color: "line", weight: 0.5, top: true },
    });
    return {
      under: list.deco,
      texts: [
        { slot: "title", role: "title", rect: h.title, fallback: "Contents" },
        { slot: "subtitle", role: "subtitle", rect: h.subtitle, fallback: "{title}" },
        ...list.texts,
      ],
      area: h.area,
    };
  },
  compare(c, items, rows) {
    const h = headerSlots(c.s);
    const g = pageGrid(c.s);
    const t = compareTable(R(h.area.x, h.area.y, h.area.w, h.area.h), items, rows, {
      labelW: g.colW * 0.7,
      gap: g.gutter * 2,
      pad: 0,
      imgRatio: 0.62,
      nameH: 16,
      rowH: 20,
      label: { fontFamily: "Pretendard", fontSize: 8, fontWeight: 600, color: "ink" },
      name: { fontFamily: "Poppins", fontSize: 11, fontWeight: 600, color: "ink" },
      body: { fontFamily: "Pretendard", fontSize: 8.5, fontWeight: 300, color: "ink" },
      rule: { color: "line", weight: 0.5, top: true },
    });
    return {
      under: t.deco,
      texts: [{ slot: "title", role: "title", rect: h.title, fallback: "Comparison" }, { slot: "subtitle", role: "subtitle", rect: h.subtitle, fallback: dummyText("subtitle") }, ...t.texts],
      area: h.area,
      slotImages: t.images,
    };
  },
  closing(c) {
    const g = pageGrid(c.s);
    const mid = c.H / 2;
    const w = g.right - g.left;
    return {
      under: [],
      texts: [
        { slot: "title", role: "title", rect: R(g.left, mid - 117, w, 120), style: { align: "center", vAlign: "bottom", fontSize: 14.5, lineHeight: 1.2, uppercase: true }, fallback: "Thank you" },
        { slot: "subtitle", role: "subtitle", rect: R(g.left, mid + 3.4, w, 30), style: { align: "center", vAlign: "top", fontSize: 8, fontWeight: 200, lineHeight: 1.4, uppercase: true }, fallback: "PRESENTED BY {dept}" },
        { slot: "body", role: "body", rect: R(g.left + w * 0.25, mid + 40, w * 0.5, 60), style: { align: "center", fontSize: 8.5 }, fallback: "" },
      ],
      area: R(g.left, mid + 110, w, g.contentBottom - mid - 110),
      hideFooter: true,
    };
  },
};

// ── 클린 비즈니스 ──

const CLEAN: Recipe = {
  cover(c) {
    const split = c.x0 + c.cw * 0.52;
    const ty = c.y0 + c.ch * 0.3;
    return {
      under: [box(split + 14, 0, c.W - split - 14, c.H, "surface")],
      texts: [
        { slot: "highlight", role: "highlight", rect: R(c.x0, c.y0, c.cw * 0.46, 14), style: { fontFamily: "Inter", fontSize: 8, fontWeight: 600, tracking: 80, uppercase: true }, fallback: "" },
        { slot: "title", role: "title", rect: R(c.x0, ty + 18, c.cw * 0.46, c.ch * 0.36), style: { fontSize: 30, lineHeight: 1.15, tracking: -30 }, fallback: "{title}" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y1 - 30, c.cw * 0.46, 30), style: { fontSize: 9, vAlign: "bottom", uppercase: true, tracking: 60 }, fallback: "PRESENTED BY {dept}" },
      ],
      over: [box(c.x0, ty, 36, 4, "accent")],
      area: R(split + 40, c.y0 + 20, c.x1 - split - 40, c.ch - 40),
      hideFooter: true,
    };
  },
  section(c) {
    const bw = c.W * (c.land ? 0.34 : 0.4);
    const ty = c.y0 + c.ch * 0.38;
    return {
      under: [box(0, 0, bw, c.H, "accent")],
      texts: [
        { slot: "number", role: "free", rect: R(c.x0, ty - 14, bw - c.x0 * 2, 90), style: { fontFamily: "Inter", fontSize: 64, fontWeight: 300, tracking: -40, lineHeight: 1, color: "invert" }, fallback: "01" },
        { slot: "title", role: "title", rect: R(bw + 44, ty, c.x1 - bw - 44, 70), style: { fontSize: 26, vAlign: "bottom" }, fallback: TITLE("Section Break") },
        { slot: "subtitle", role: "subtitle", rect: R(bw + 44, ty + 80, c.x1 - bw - 44, 40), fallback: "Relevant Contents Goes Here" },
      ],
      over: [box(bw + 44, ty + 74, 28, 2, "accent")],
      area: R(bw + 44, ty + 130, c.x1 - bw - 44, c.y1 - ty - 130),
      hideFooter: true,
    };
  },
  content(c, kind) {
    const left = c.cw * (c.land ? 0.36 : 1);
    const headerH = c.land ? 86 : 118;
    const rule = c.y0 + headerH + 8;
    const area = R(c.x0, rule + 12, c.cw, c.y1 - rule - 12);
    const header = c.land ? R(c.x0 + c.cw * 0.4, c.y0 + 4, c.cw * 0.6, headerH - 4) : R(c.x0, c.y0 + 62, c.cw, headerH - 62);
    return {
      under: kind === "blank" ? [] : [box(c.x0, c.y0, 18, 3, "accent"), hline(c.x0, rule, c.cw, "line", 0.75)],
      texts:
        kind === "blank"
          ? []
          : [
              { slot: "title", role: "title", rect: R(c.x0, c.y0 + 10, left, 30), style: { vAlign: "top" }, fallback: TITLE() },
              { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 42, left, 30), fallback: dummyText("subtitle") },
            ],
      area,
      flow: kind === "blank" ? undefined : { header, side: R(c.x0, area.y, c.cw * 0.28, area.h), gutter: 14 },
    };
  },
  toc(c, rows) {
    const lw = c.cw * 0.34;
    const list = tocRows(R(c.x0 + lw + 30, c.y0 + 14, c.cw - lw - 30, c.ch - 14), rows, {
      rowH: 34,
      numW: 44,
      pageW: 40,
      num: { fontFamily: "Inter", fontSize: 12, fontWeight: 600, color: "accent" },
      name: { fontFamily: "Pretendard", fontSize: 13, fontWeight: 500, color: "ink" },
      page: { fontFamily: "Inter", fontSize: 9, fontWeight: 500, color: "muted" },
      rule: { color: "line", weight: 0.75, top: true },
    });
    return {
      under: [box(c.x0, c.y0, 18, 3, "accent"), ...list.deco],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0 + 10, lw, 40), style: { fontSize: 28 }, fallback: "Contents" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 54, lw, 40), fallback: "{title}" },
        ...list.texts,
      ],
      area: R(c.x0, c.y0 + 110, lw, c.ch - 110),
    };
  },
  compare(c, items, rows) {
    const top = c.y0 + 70;
    const t = compareTable(R(c.x0, top, c.cw, c.y1 - top), items, rows, {
      labelW: c.cw * 0.12,
      gap: 12,
      pad: 10,
      imgRatio: 0.58,
      nameH: 18,
      rowH: 22,
      label: { fontFamily: "Pretendard", fontSize: 8.5, fontWeight: 600, color: "muted" },
      name: { fontFamily: "Pretendard", fontSize: 12, fontWeight: 700, color: "ink" },
      body: { fontFamily: "Pretendard", fontSize: 9, fontWeight: 400, color: "ink" },
      card: (r) => [box(r.x, r.y, r.w, r.h, "surface", { radius: 6 })],
      rule: { color: "line", weight: 0.75 },
      ruleSpan: "full",
    });
    return {
      under: [box(c.x0, c.y0, 18, 3, "accent"), ...t.deco],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0 + 10, c.cw * 0.5, 30), fallback: "Comparison" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 42, c.cw * 0.5, 20), fallback: dummyText("subtitle") },
        ...t.texts,
      ],
      area: R(c.x0, top, c.cw, c.y1 - top),
      slotImages: t.images,
    };
  },
  closing(c) {
    const ty = c.y0 + c.ch * 0.34;
    const pw = c.W * 0.38;
    return {
      under: [box(c.W - pw, 0, pw, c.H, "surface"), box(c.W - pw, c.H - 10, pw, 10, "accent")],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, ty + 16, c.W - pw - c.x0 - 30, 50), style: { fontSize: 34 }, fallback: "Thank you" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, ty + 70, c.W - pw - c.x0 - 30, 24), fallback: "{dept}" },
        { slot: "body", role: "body", rect: R(c.W - pw + 30, ty + 16, pw - 30 - c.W + c.x1, c.ch * 0.4), style: { color: "muted" }, fallback: "" },
      ],
      over: [box(c.x0, ty, 36, 4, "accent")],
      area: R(c.x0, ty + 110, c.W - pw - c.x0 - 30, c.y1 - ty - 110),
      hideFooter: true,
    };
  },
};

// ── 볼드 브리프 ──

const BOLD: Recipe = {
  cover(c) {
    return {
      background: "ink",
      under: [box(c.x0, c.y0, 64, 10, "accent")],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0 + c.ch * 0.18, c.cw * 0.86, c.ch * 0.6), style: { fontSize: 56, lineHeight: 1.0, tracking: -50, color: "invert", vAlign: "bottom" }, fallback: "{title}" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y1 - 22, c.cw * 0.6, 22), style: { fontFamily: "Montserrat", fontSize: 9, fontWeight: 800, tracking: 80, uppercase: true, vAlign: "bottom" }, fallback: "PRESENTED BY {dept}" },
        { slot: "highlight", role: "highlight", rect: R(c.x0 + c.cw * 0.6, c.y1 - 22, c.cw * 0.4, 22), style: { color: "invert", align: "right", vAlign: "bottom", fontSize: 9 }, fallback: "" },
      ],
      over: [hline(c.x0, c.y1 - 34, c.cw, "invert", 1.5)],
      area: R(c.x0 + c.cw * 0.62, c.y0 + 26, c.cw * 0.38, c.ch * 0.4),
      hideFooter: true,
    };
  },
  section(c) {
    return {
      background: "accent",
      under: [],
      texts: [
        { slot: "number", role: "free", rect: R(c.x0 - 6, c.y0 - 10, c.cw * 0.6, c.ch * 0.55), style: { fontFamily: "Montserrat", fontSize: 150, fontWeight: 800, tracking: -60, lineHeight: 1, color: "invert" }, fallback: "01" },
        { slot: "title", role: "title", rect: R(c.x0, c.y1 - 150, c.cw * 0.8, 110), style: { fontSize: 38, color: "invert", vAlign: "bottom" }, fallback: TITLE("Section Break") },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y1 - 30, c.cw * 0.8, 30), style: { color: "invert", vAlign: "bottom" }, fallback: "Relevant Contents Goes Here" },
      ],
      over: [hline(c.x0, c.y1 - 36, c.cw, "invert", 1.5)],
      area: R(c.x0 + c.cw * 0.6, c.y0, c.cw * 0.4, c.ch * 0.5),
      hideFooter: true,
    };
  },
  content(c, kind) {
    const headerH = c.land ? 84 : 120;
    const rule = c.y0 + headerH;
    const area = R(c.x0, rule + 14, c.cw, c.y1 - rule - 14);
    const header = c.land ? R(c.x0 + c.cw * 0.52, c.y0 + 2, c.cw * 0.48, headerH - 12) : R(c.x0, c.y0 + 70, c.cw, headerH - 80);
    return {
      under: kind === "blank" ? [] : [box(c.x0, rule - 2, c.cw, 4, "ink")],
      texts:
        kind === "blank"
          ? []
          : [
              { slot: "title", role: "title", rect: R(c.x0, c.y0, c.land ? c.cw * 0.5 : c.cw, 50), style: { vAlign: "bottom" }, fallback: TITLE() },
              { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 54, c.land ? c.cw * 0.5 : c.cw, 18), fallback: dummyText("subtitle") },
            ],
      area,
      flow: kind === "blank" ? undefined : { header, side: R(c.x0, area.y, c.cw * 0.26, area.h), gutter: 14 },
    };
  },
  toc(c, rows) {
    const bw = c.W * (c.land ? 0.4 : 1);
    const listTop = c.land ? c.y0 + 10 : c.H * 0.38;
    const list = tocRows(R(c.land ? bw + 34 : c.x0, listTop, c.land ? c.x1 - bw - 34 : c.cw, c.y1 - listTop), rows, {
      rowH: 40,
      numW: 52,
      pageW: 40,
      num: { fontFamily: "Montserrat", fontSize: 18, fontWeight: 800, color: "accent" },
      name: { fontFamily: "Pretendard", fontSize: 15, fontWeight: 800, tracking: -20, color: "ink" },
      page: { fontFamily: "Montserrat", fontSize: 9, fontWeight: 700, color: "ink" },
      rule: { color: "ink", weight: 1.5 },
    });
    return {
      under: [box(0, 0, bw, c.land ? c.H : c.H * 0.32, "ink"), ...list.deco],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, bw - c.x0 * 2, 110), style: { fontSize: 44, color: "invert", uppercase: true }, fallback: "Contents" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 118, bw - c.x0 * 2, 30), fallback: "{title}" },
        ...list.texts,
      ],
      area: R(c.x0, c.y0 + 170, bw - c.x0 * 2, c.land ? c.ch - 170 : c.H * 0.32 - c.y0 - 170),
      // 왼쪽 검은 면 위에서는 하단 문구가 보이지 않는다
      hideFooter: c.land,
    };
  },
  compare(c, items, rows) {
    const top = c.y0 + 84 + 14;
    const t = compareTable(R(c.x0, top, c.cw, c.y1 - top), items, rows, {
      labelW: c.cw * 0.12,
      gap: 10,
      pad: 0,
      imgRatio: 0.56,
      nameH: 24,
      nameOnTop: true,
      rowH: 22,
      label: { fontFamily: "Pretendard", fontSize: 8.5, fontWeight: 800, color: "ink" },
      name: { fontFamily: "Pretendard", fontSize: 11, fontWeight: 900, color: "invert", padding: 6 },
      body: { fontFamily: "Pretendard", fontSize: 9, fontWeight: 500, color: "ink" },
      card: (r) => [box(r.x, r.y, r.w, 24, "ink")],
      rule: { color: "ink", weight: 1 },
      ruleSpan: "full",
    });
    return {
      under: [box(c.x0, c.y0 + 82, c.cw, 4, "ink"), ...t.deco],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, c.cw * 0.6, 50), style: { vAlign: "bottom" }, fallback: "Comparison" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 54, c.cw * 0.6, 18), fallback: dummyText("subtitle") },
        ...t.texts,
      ],
      area: R(c.x0, top, c.cw, c.y1 - top),
      slotImages: t.images,
    };
  },
  closing(c) {
    return {
      background: "ink",
      under: [box(c.x0, c.y0 + c.ch * 0.62, 90, 10, "accent")],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, c.cw * 0.8, c.ch * 0.6), style: { fontSize: 64, lineHeight: 1, tracking: -50, color: "invert", uppercase: true, vAlign: "bottom" }, fallback: "Thank you" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + c.ch * 0.62 + 22, c.cw * 0.6, 20), style: { fontFamily: "Montserrat", fontWeight: 800, tracking: 80, uppercase: true }, fallback: "{dept}" },
        { slot: "body", role: "body", rect: R(c.x0 + c.cw * 0.6, c.y0 + c.ch * 0.62 + 22, c.cw * 0.4, c.ch * 0.3), style: { color: "invert" }, fallback: "" },
      ],
      area: R(c.x0 + c.cw * 0.62, c.y0, c.cw * 0.38, c.ch * 0.5),
      hideFooter: true,
    };
  },
};

// ── 뉴트럴 에디토리얼 ──

const EDITORIAL: Recipe = {
  cover(c) {
    const imgX = c.x0 + c.cw * (c.land ? 0.6 : 0);
    return {
      under: [hline(c.x0, c.y0, c.cw, "ink", 0.75), hline(c.x0, c.y1, c.cw, "ink", 0.75)],
      texts: [
        { slot: "highlight", role: "highlight", rect: R(c.x0, c.y0 + 10, c.cw * 0.5, 14), style: { fontFamily: "Pretendard", fontSize: 8, fontWeight: 500, tracking: 120, uppercase: true, color: "muted" }, fallback: "{dept}" },
        { slot: "title", role: "title", rect: R(c.x0, c.y0 + c.ch * 0.28, c.land ? c.cw * 0.52 : c.cw, c.ch * 0.4), style: { fontSize: 38, lineHeight: 1.22, tracking: -30 }, fallback: "{title}" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y1 - 26, c.land ? c.cw * 0.5 : c.cw, 16), style: { vAlign: "bottom" }, fallback: "PRESENTED BY {dept}" },
      ],
      area: c.land ? R(imgX, c.y0 + 30, c.x1 - imgX, c.ch - 60) : R(c.x0, c.y0 + c.ch * 0.62, c.cw, c.ch * 0.3),
      hideFooter: true,
    };
  },
  section(c) {
    const tx = c.x0 + c.cw * (c.land ? 0.42 : 0);
    const ty = c.y0 + c.ch * 0.42;
    return {
      under: [hline(tx, ty - 14, 60, "ink", 0.75)],
      texts: [
        { slot: "number", role: "free", rect: R(c.x0, c.y0 + c.ch * 0.12, c.cw * 0.4, 170), style: { fontFamily: "Playfair Display", fontSize: 150, fontWeight: 400, tracking: -40, lineHeight: 1, color: "accent" }, fallback: "01" },
        { slot: "title", role: "title", rect: R(tx, ty, c.x1 - tx, 70), style: { fontSize: 28 }, fallback: TITLE("Section Break") },
        { slot: "subtitle", role: "subtitle", rect: R(tx, ty + 78, c.x1 - tx, 30), fallback: "Relevant Contents Goes Here" },
      ],
      area: R(tx, ty + 120, c.x1 - tx, c.y1 - ty - 120),
      hideFooter: true,
    };
  },
  content(c, kind) {
    const headerH = c.land ? 82 : 120;
    const rule = c.y0 + headerH;
    const area = R(c.x0, rule + 16, c.cw, c.y1 - rule - 16);
    const header = c.land ? R(c.x0 + c.cw * 0.42, c.y0 + 18, c.cw * 0.58, headerH - 24) : R(c.x0, c.y0 + 76, c.cw, headerH - 80);
    return {
      under: kind === "blank" ? [] : [hline(c.x0, rule, c.cw, "line", 0.75)],
      texts:
        kind === "blank"
          ? []
          : [
              // 눈썹 문구: 여러 줄이면 위(여백 쪽)로 늘어나도록 아래 정렬
              { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 - 26, c.land ? c.cw * 0.36 : c.cw, 40), style: { vAlign: "bottom" }, fallback: dummyText("subtitle") },
              { slot: "title", role: "title", rect: R(c.x0, c.y0 + 18, c.land ? c.cw * 0.38 : c.cw, 56), fallback: TITLE() },
            ],
      area,
      flow: kind === "blank" ? undefined : { header, side: R(c.x0, area.y, c.cw * 0.3, area.h), gutter: 20 },
    };
  },
  toc(c, rows) {
    const lx = c.x0 + c.cw * (c.land ? 0.42 : 0);
    const top = c.land ? c.y0 + 18 : c.y0 + 130;
    const list = tocRows(R(lx, top, c.x1 - lx, c.y1 - top), rows, {
      rowH: 34,
      numW: 42,
      pageW: 36,
      num: { fontFamily: "Playfair Display", fontSize: 12, fontWeight: 400, italic: true, color: "accent" },
      name: { fontFamily: "Noto Serif KR", fontSize: 13, fontWeight: 500, color: "ink" },
      page: { fontFamily: "Pretendard", fontSize: 8, fontWeight: 400, tracking: 80, color: "muted" },
      rule: { color: "line", weight: 0.75, top: true },
    });
    return {
      under: list.deco,
      texts: [
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 - 26, c.cw * 0.36, 40), style: { vAlign: "bottom" }, fallback: "{title}" },
        { slot: "title", role: "title", rect: R(c.x0, c.y0 + 18, c.land ? c.cw * 0.36 : c.cw, 80), style: { fontSize: 34 }, fallback: "Contents" },
        ...list.texts,
      ],
      area: R(c.x0, c.y0 + 120, c.cw * 0.36, c.ch - 120),
    };
  },
  compare(c, items, rows) {
    const top = c.y0 + 98;
    const t = compareTable(R(c.x0, top, c.cw, c.y1 - top), items, rows, {
      labelW: c.cw * 0.13,
      gap: 18,
      pad: 0,
      imgRatio: 0.66,
      nameH: 22,
      rowH: 22,
      label: { fontFamily: "Pretendard", fontSize: 7.5, fontWeight: 500, tracking: 80, color: "muted", uppercase: true },
      name: { fontFamily: "Noto Serif KR", fontSize: 13, fontWeight: 500, color: "ink" },
      body: { fontFamily: "Pretendard", fontSize: 8.5, fontWeight: 300, color: "ink" },
      card: (r, i) => (i ? [vline(r.x - 9, r.y, r.h, "line", 0.75)] : []),
      rule: { color: "line", weight: 0.75, top: true },
      ruleSpan: "full",
    });
    return {
      under: [hline(c.x0, c.y0 + 82, c.cw, "line", 0.75), ...t.deco],
      texts: [
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 - 26, c.cw * 0.5, 40), style: { vAlign: "bottom" }, fallback: dummyText("subtitle") },
        { slot: "title", role: "title", rect: R(c.x0, c.y0 + 18, c.cw * 0.6, 56), fallback: "Comparison" },
        ...t.texts,
      ],
      area: R(c.x0, top, c.cw, c.y1 - top),
      slotImages: t.images,
    };
  },
  closing(c) {
    const mid = c.y0 + c.ch * 0.46;
    return {
      under: [hline(c.W / 2 - 30, mid + 8, 60, "ink", 0.75)],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, mid - 90, c.cw, 90), style: { fontSize: 36, align: "center", vAlign: "bottom" }, fallback: "Thank you" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, mid + 22, c.cw, 16), style: { align: "center" }, fallback: "{dept}" },
        { slot: "body", role: "body", rect: R(c.x0 + c.cw * 0.25, mid + 50, c.cw * 0.5, 70), style: { align: "center", color: "muted" }, fallback: "" },
      ],
      area: R(c.x0 + c.cw * 0.25, mid + 130, c.cw * 0.5, c.y1 - mid - 130),
      hideFooter: true,
    };
  },
};

// ── 모노 포트폴리오 ──

const MONO: Recipe = {
  cover(c) {
    const band = 80;
    return {
      under: [],
      over: [box(0, c.H - band, c.W, band, "paper")],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.H - band + 16, c.cw * 0.62, 30), style: { fontSize: 18, fontWeight: 600 }, fallback: "{title}" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.H - 28, c.cw * 0.62, 14), fallback: "PRESENTED BY {dept}" },
        { slot: "highlight", role: "highlight", rect: R(c.x0 + c.cw * 0.62, c.H - 28, c.cw * 0.38, 14), style: { align: "right", fontSize: 7.5, fontWeight: 400, tracking: 80, uppercase: true, color: "muted" }, fallback: "" },
      ],
      area: R(0, 0, c.W, c.H - band),
      hideFooter: true,
    };
  },
  section(c) {
    return {
      under: [hline(c.x0, c.y0 + 40, c.cw, "ink", 0.5)],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, c.cw * 0.6, 22), style: { fontSize: 14 }, fallback: TITLE("Section Break") },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0 + c.cw * 0.6, c.y0 + 4, c.cw * 0.4, 16), style: { align: "right" }, fallback: "Relevant Contents Goes Here" },
        { slot: "number", role: "free", rect: R(c.x0, c.y1 - 210, c.cw, 210), style: { fontSize: 190, fontWeight: 300, tracking: -60, lineHeight: 1, align: "right", vAlign: "bottom" }, fallback: "01" },
      ],
      area: R(c.x0, c.y0 + 56, c.cw * 0.5, c.ch - 280),
      hideFooter: true,
    };
  },
  content(c, kind) {
    const headerH = c.land ? 34 : 70;
    const area = R(c.x0, c.y0 + headerH + 8, c.cw, c.y1 - c.y0 - headerH - 8);
    const header = c.land ? R(c.x0 + c.cw * 0.56, c.y0, c.cw * 0.44, headerH) : R(c.x0, c.y0 + 34, c.cw, headerH - 34);
    return {
      under: [],
      texts:
        kind === "blank"
          ? []
          : [
              { slot: "title", role: "title", rect: R(c.x0, c.y0, c.cw * (c.land ? 0.28 : 0.6), 16), fallback: TITLE() },
              { slot: "subtitle", role: "subtitle", rect: R(c.land ? c.x0 + c.cw * 0.28 : c.x0, c.land ? c.y0 + 3 : c.y0 + 18, c.cw * 0.26, 12), fallback: dummyText("subtitle") },
            ],
      area,
      flow: kind === "blank" ? undefined : { header, side: R(c.x0, area.y, c.cw * 0.2, area.h), gutter: 10 },
    };
  },
  toc(c, rows) {
    const top = c.y0 + c.ch * 0.3;
    const list = tocRows(R(c.x0 + c.cw * (c.land ? 0.5 : 0), top, c.cw * (c.land ? 0.5 : 1), c.y1 - top), rows, {
      rowH: 26,
      numW: 34,
      pageW: 30,
      num: { fontFamily: "IBM Plex Sans KR", fontSize: 7.5, fontWeight: 400, color: "muted" },
      name: { fontFamily: "IBM Plex Sans KR", fontSize: 12, fontWeight: 500, color: "ink" },
      page: { fontFamily: "IBM Plex Sans KR", fontSize: 7.5, fontWeight: 400, color: "muted" },
      rule: { color: "ink", weight: 0.5, top: true },
    });
    return {
      under: list.deco,
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, c.cw * 0.5, 18), fallback: "Index" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 20, c.cw * 0.5, 14), fallback: "{title}" },
        ...list.texts,
      ],
      area: R(c.x0, top, c.cw * 0.44, c.y1 - top),
    };
  },
  compare(c, items, rows) {
    const top = c.y0 + 42;
    const t = compareTable(R(c.x0, top, c.cw, c.y1 - top), items, rows, {
      labelW: c.cw * 0.1,
      gap: 8,
      pad: 0,
      imgRatio: 0.9,
      nameH: 16,
      rowH: 17,
      label: { fontFamily: "IBM Plex Sans KR", fontSize: 6.5, fontWeight: 500, tracking: 80, color: "muted", uppercase: true },
      name: { fontFamily: "IBM Plex Sans KR", fontSize: 10, fontWeight: 600, color: "ink" },
      body: { fontFamily: "IBM Plex Sans KR", fontSize: 7.5, fontWeight: 400, color: "ink" },
      rule: { color: "ink", weight: 0.5 },
      ruleSpan: "full",
    });
    return {
      under: t.deco,
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, c.cw * 0.4, 16), fallback: "Comparison" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0 + c.cw * 0.4, c.y0 + 3, c.cw * 0.6, 12), style: { align: "right" }, fallback: dummyText("subtitle") },
        ...t.texts,
      ],
      area: R(c.x0, top, c.cw, c.y1 - top),
      slotImages: t.images,
    };
  },
  closing(c) {
    const mid = c.H / 2;
    return {
      under: [],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, mid - 30, c.cw, 26), style: { fontSize: 16, align: "center", vAlign: "bottom" }, fallback: "Thank you" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, mid + 2, c.cw, 14), style: { align: "center" }, fallback: "{dept}" },
        { slot: "body", role: "body", rect: R(c.x0 + c.cw * 0.3, mid + 30, c.cw * 0.4, 60), style: { align: "center", color: "muted" }, fallback: "" },
      ],
      area: R(c.x0, mid + 100, c.cw, c.y1 - mid - 100),
      hideFooter: true,
    };
  },
};

// ── 톤온톤 ──

const TONAL: Recipe = {
  cover(c) {
    const r = c.H * 0.5;
    return {
      background: "tone5",
      under: [circle(c.W * 0.78, c.H * 0.2, r, "tone4"), circle(c.W * 0.93, c.H * 0.86, r * 0.46, "tone3", 0.9), circle(c.W * 0.62, c.H * 0.74, r * 0.16, "tone2", 0.85)],
      texts: [
        { slot: "highlight", role: "highlight", rect: R(c.x0, c.y0, c.cw * 0.5, 14), style: { fontFamily: "Poppins", fontSize: 8, fontWeight: 600, tracking: 80, uppercase: true, color: "tone3" }, fallback: "" },
        { slot: "title", role: "title", rect: R(c.x0, c.y0 + c.ch * 0.3, c.cw * (c.land ? 0.56 : 0.9), c.ch * 0.36), style: { fontSize: 36, lineHeight: 1.15, tracking: -30, color: "tone1" }, fallback: "{title}" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y1 - 20, c.cw * 0.6, 20), style: { color: "tone3", vAlign: "bottom", uppercase: true, tracking: 60 }, fallback: "PRESENTED BY {dept}" },
      ],
      area: R(c.x0 + c.cw * 0.6, c.y0 + c.ch * 0.2, c.cw * 0.4, c.ch * 0.6),
      hideFooter: true,
    };
  },
  section(c) {
    const ty = c.y0 + c.ch * 0.26;
    return {
      background: "tone4",
      under: [box(0, c.H - 26, c.W, 26, "tone5"), circle(c.W * 0.86, c.H * 0.36, c.H * 0.26, "tone3", 0.35)],
      texts: [
        { slot: "number", role: "free", rect: R(c.x0, ty, c.cw * 0.5, 120), style: { fontFamily: "Poppins", fontSize: 110, fontWeight: 300, tracking: -40, lineHeight: 1, color: "tone2" }, fallback: "01" },
        { slot: "title", role: "title", rect: R(c.x0, ty + 130, c.cw * 0.7, 60), style: { fontSize: 30, color: "tone1" }, fallback: TITLE("Section Break") },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, ty + 196, c.cw * 0.7, 30), style: { color: "tone3" }, fallback: "Relevant Contents Goes Here" },
      ],
      area: R(c.x0 + c.cw * 0.6, c.y0, c.cw * 0.4, c.ch * 0.5),
      hideFooter: true,
    };
  },
  content(c, kind) {
    const band = c.y0 + (c.land ? 86 : 120);
    const area = R(c.x0, band + 16, c.cw, c.y1 - band - 16);
    const header = c.land ? R(c.x0 + c.cw * 0.42, c.y0, c.cw * 0.58, band - c.y0 - 12) : R(c.x0, c.y0 + 70, c.cw, band - c.y0 - 80);
    return {
      under: kind === "blank" ? [] : [box(0, 0, c.W, band, "tone2"), box(c.x0, band - 3, 40, 3, "tone4")],
      texts:
        kind === "blank"
          ? []
          : [
              { slot: "title", role: "title", rect: R(c.x0, c.y0, c.land ? c.cw * 0.38 : c.cw, 44), style: { vAlign: "top" }, fallback: TITLE() },
              { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 46, c.land ? c.cw * 0.38 : c.cw, 20), fallback: dummyText("subtitle") },
            ],
      area,
      flow: kind === "blank" ? undefined : { header, side: R(c.x0, area.y, c.cw * 0.28, area.h), gutter: 14 },
    };
  },
  toc(c, rows) {
    const bw = c.W * (c.land ? 0.36 : 1);
    const listTop = c.land ? c.y0 + 10 : c.H * 0.36;
    const list = tocRows(R(c.land ? bw + 36 : c.x0, listTop, c.land ? c.x1 - bw - 36 : c.cw, c.y1 - listTop), rows, {
      rowH: 34,
      numW: 44,
      pageW: 36,
      num: { fontFamily: "Poppins", fontSize: 12, fontWeight: 600, color: "tone4" },
      name: { fontFamily: "Pretendard", fontSize: 13, fontWeight: 500, color: "tone6" },
      page: { fontFamily: "Poppins", fontSize: 9, fontWeight: 500, color: "tone5" },
      rule: { color: "tone3", weight: 0.75, top: true },
    });
    return {
      under: [box(0, 0, bw, c.land ? c.H : c.H * 0.3, "tone4"), circle(c.land ? bw * 0.62 : c.W * 0.85, c.land ? c.H * 0.8 : c.H * 0.16, Math.min(bw * 0.3, c.H * 0.13), "tone3", 0.4), ...list.deco],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, bw - c.x0 * 2, 44), style: { fontSize: 30, color: "tone1" }, fallback: "Contents" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, c.y0 + 48, bw - c.x0 * 2, 30), style: { color: "tone2" }, fallback: "{title}" },
        ...list.texts,
      ],
      area: R(c.x0, c.y0 + 100, bw - c.x0 * 2, c.land ? c.ch - 100 : c.H * 0.3 - c.y0 - 100),
      hideFooter: c.land,
    };
  },
  compare(c, items, rows) {
    const band = c.y0 + 64;
    const top = band + 14;
    const t = compareTable(R(c.x0, top, c.cw, c.y1 - top), items, rows, {
      labelW: c.cw * 0.12,
      gap: 12,
      pad: 10,
      imgRatio: 0.56,
      nameH: 24,
      nameOnTop: true,
      rowH: 22,
      label: { fontFamily: "Pretendard", fontSize: 8.5, fontWeight: 600, color: "tone5" },
      name: { fontFamily: "Pretendard", fontSize: 11, fontWeight: 700, color: "tone1", align: "center" },
      body: { fontFamily: "Pretendard", fontSize: 9, fontWeight: 400, color: "tone6" },
      card: (r) => [box(r.x, r.y, r.w, r.h, "tone2", { radius: 8 }), box(r.x + 10, r.y + 10, r.w - 20, 24, "tone4", { radius: 4 })],
      rule: { color: "tone3", weight: 0.75 },
      ruleSpan: "full",
    });
    return {
      under: [box(0, 0, c.W, band, "tone2"), box(c.x0, band - 3, 40, 3, "tone4"), ...t.deco],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, c.y0, c.cw * 0.5, 30), fallback: "Comparison" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0 + c.cw * 0.5, c.y0 + 8, c.cw * 0.5, 20), style: { align: "right" }, fallback: dummyText("subtitle") },
        ...t.texts,
      ],
      area: R(c.x0, top, c.cw, c.y1 - top),
      slotImages: t.images,
    };
  },
  closing(c) {
    const ty = c.y0 + c.ch * 0.34;
    return {
      background: "tone2",
      under: [circle(c.W * 0.8, c.H * 0.5, c.H * 0.34, "tone3"), circle(c.W * 0.8, c.H * 0.5, c.H * 0.18, "tone4")],
      texts: [
        { slot: "title", role: "title", rect: R(c.x0, ty, c.cw * 0.55, 56), style: { fontSize: 36, color: "tone6" }, fallback: "Thank you" },
        { slot: "subtitle", role: "subtitle", rect: R(c.x0, ty + 62, c.cw * 0.55, 20), style: { color: "tone4" }, fallback: "{dept}" },
        { slot: "body", role: "body", rect: R(c.x0, ty + 100, c.cw * 0.5, c.ch * 0.3), style: { color: "tone5" }, fallback: "" },
      ],
      area: R(c.x0 + c.cw * 0.6, c.y0, c.cw * 0.4, c.ch * 0.4),
      hideFooter: true,
    };
  },
};

const RECIPES: Record<string, Recipe> = { default: DEFAULT, clean: CLEAN, bold: BOLD, editorial: EDITORIAL, mono: MONO, tonal: TONAL };

// ─── assemble ───────────────────────────────────────────────

/** 비교 페이지 항목 수 — meta.items → 내용의 항목 슬롯 수 → 3 */
export function compareItemCount(content: PageContent, meta: PageMeta): number {
  const fromContent = Object.keys(content.texts).filter((k) => /^cmp-name-\d$/.test(k)).length || Object.keys(content.slotImages).filter((k) => /^cmp-img-\d$/.test(k)).length;
  return Math.max(2, Math.min(4, meta.items ?? (fromContent || 3)));
}

function specFor(kind: PageKind, c: Ctx, content: PageContent, meta: PageMeta): Spec {
  const r = RECIPES[c.t.id] ?? CLEAN;
  switch (kind) {
    case "cover":
      return r.cover(c);
    case "section":
      return r.section(c);
    case "toc":
      return r.toc(c, Math.max(1, Math.min(12, lines(content.texts["toc-name"] || "a\nb\nc\nd"))));
    case "compare":
      return r.compare(c, compareItemCount(content, meta), Math.max(1, Math.min(8, lines(content.texts["cmp-rows"] || COMPARE_ROWS_FALLBACK))));
    case "closing":
      return r.closing(c);
    case "case":
    case "reference": {
      // 강조 라인 · 본문은 글 배치(짧은 글 / 긴 글)가 자리를 정한다 — 처음엔 짧은 글 자리에
      const spec = r.content(c, kind);
      const at = spec.flow?.header ?? R(c.x0, c.y0, c.cw, 40);
      spec.texts.push(
        { slot: "highlight", role: "highlight", rect: R(at.x, at.y, at.w, 17), fallback: "" },
        { slot: "body", role: "body", rect: at, fallback: kind === "case" ? dummyText("body") : LOREM.body.split(". ")[0] + "." },
      );
      return spec;
    }
    case "blank":
      return r.content(c, kind);
  }
}

/** 템플릿 페이지 만들기 — 틀(Spec)에 내용을 채우고 오토 레이아웃으로 이미지를 배치한다 */
export function buildThemedPage(kind: PageKind, settings: DocSettings, content: PageContent, meta: PageMeta): Page {
  const c = ctx(settings);
  const spec = specFor(kind, c, content, meta);
  const radius = c.t.imageRadius || undefined;
  const used = new Set<string>();

  const texts: PageElement[] = [];
  for (const ts of spec.texts) {
    used.add(ts.slot);
    const value = content.texts[ts.slot];
    const text = value?.trim() ? value : ts.fallback;
    if (!text) continue;
    texts.push(slotText(ts.slot, ts.role, text, ts.rect, ts.style));
  }
  // 이 템플릿에 자리가 없는 글도 버리지 않는다 — 아래쪽에 자유 텍스트로 남긴다
  let spare = 0;
  for (const [slot, value] of Object.entries(content.texts)) {
    if (used.has(slot) || !value?.trim() || (kind === "compare" && /^cmp-(name|body)-\d$/.test(slot))) continue;
    spare++;
    texts.push({ ...textEl("free", value, R(c.x0, c.y1 - 16 * spare, c.cw * 0.5, 14)), slot });
  }

  const images: PageElement[] = content.images.map((img) => ({ ...img, managed: true, radius }));
  for (const { img, label } of content.logos) {
    const logo: ImageElement = { ...img, logo: true, managed: true, fit: "contain" };
    images.push(logo, { ...textEl("label", label, { x: 0, y: 0, w: 80, h: 10 }), labelFor: logo.id });
  }
  const placedSlots = new Set<string>();
  for (const si of spec.slotImages ?? []) {
    placedSlots.add(si.slot);
    const prev = content.slotImages[si.slot];
    const img: ImageElement = prev ? { ...prev } : { ...placeholderImage(4 / 3, { managed: false }), caption: LOREM.caption };
    Object.assign(img, { ...si.rect, managed: false, logo: undefined, fit: img.fit === "contain" ? "contain" : "cover", radius, slot: si.slot, rotation: 0 });
    images.push(img);
  }
  // 항목 수를 줄여 자리가 없어진 비교 이미지는 뺀다 (항목 수 변경은 사용자가 직접 하는 동작)
  for (const [slot, img] of Object.entries(content.slotImages)) {
    if (!placedSlots.has(slot) && img && !(kind === "compare" && /^cmp-img-\d$/.test(slot))) images.push(img);
  }

  const page: Page = {
    id: meta.id ?? uid("p"),
    kind,
    group: meta.group,
    caseId: meta.caseId,
    notes: meta.notes,
    layout: { ...themeLayout(settings, kind), ...meta.layout },
    area: spec.area,
    flow: spec.flow ? { mode: meta.flowMode ?? "auto", header: spec.flow.header, side: spec.flow.side, gutter: spec.flow.gutter } : undefined,
    background: spec.background,
    hideFooter: meta.hideFooter ?? spec.hideFooter,
    elements: [...spec.under, ...images, ...(spec.over ?? []), ...texts, ...content.extras],
  };
  return relayoutPage(page, settings);
}
