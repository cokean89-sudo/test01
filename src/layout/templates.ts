// 페이지 템플릿 — 첨부 예시(케이스 스터디 / 레퍼런스·아이데이션 페이지)의 구성을 재현한다.

import {
  PAGE_SIZES,
  type CaseStudy,
  type DocSettings,
  type ImageElement,
  type Page,
  type PageElement,
  type PageLayout,
  type Rect,
  type Reference,
  type TextElement,
  type TextRole,
  type TextStyle,
} from "../../shared/types";
import { DEFAULT_LAYOUT } from "../lib/defaults";
import { dummyText, LOREM, PLACEHOLDER_ASPECTS, placeholderImage } from "../lib/dummy";
import { uid } from "../lib/id";
import { computeLayout, safeAspect } from "./engine";

export function pageDims(settings: DocSettings): { W: number; H: number } {
  const size = PAGE_SIZES[settings.pageSize];
  return { W: size.w, H: size.h };
}

interface HeaderCols {
  title: Rect;
  subtitle: Rect;
  text: Rect;
  /** 헤더 아래 콘텐츠가 시작되는 y */
  bottom: number;
}

/** 3단 헤더(타이틀 | 서브타이틀 | 설명) 좌표. 세로 페이지는 위아래로 쌓는다. */
export function headerColumns(settings: DocSettings, bodyHeight = 44): HeaderCols {
  const { W, H } = pageDims(settings);
  const m = settings.margin;
  const inner = W - m.left - m.right;
  if (H > W) {
    return {
      title: { x: m.left, y: m.top, w: inner * 0.6, h: 28 },
      subtitle: { x: m.left, y: m.top + 30, w: inner * 0.6, h: 16 },
      text: { x: m.left, y: m.top + 50, w: inner, h: bodyHeight + 12 },
      bottom: m.top + 50 + bodyHeight + 16,
    };
  }
  return {
    title: { x: m.left, y: m.top, w: inner * 0.19, h: 30 },
    subtitle: { x: m.left + inner * 0.2, y: m.top + 2, w: inner * 0.18, h: 36 },
    text: { x: m.left + inner * 0.395, y: m.top - 2, w: inner * 0.605, h: bodyHeight + 12 },
    bottom: m.top + 63,
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

function contentBottom(settings: DocSettings): number {
  const { H } = pageDims(settings);
  return H - settings.margin.bottom;
}

// ─── templates ──────────────────────────────────────────────

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

/** 예시 1: 케이스 스터디 페이지 (타이틀 | 리그/팀 | 강조 라인+설명, 로고 패널 + 이미지 모자이크) */
export function createCasePage(settings: DocSettings, input: CasePageInput): Page {
  const { W } = pageDims(settings);
  const m = settings.margin;
  const cols = headerColumns(settings);
  const elements: PageElement[] = [
    textEl("title", input.title || dummyText("title"), cols.title),
    textEl("subtitle", input.subtitle || dummyText("subtitle"), cols.subtitle),
    textEl("highlight", input.highlight || dummyText("highlight"), { ...cols.text, h: 12 }),
    textEl("body", input.description || dummyText("body"), { ...cols.text, y: cols.text.y + 13, h: cols.text.h - 13 }),
  ];
  const addLogo = (img: ImageElement, label: string) =>
    elements.push(img, { ...textEl("label", label, { x: 0, y: 0, w: 80, h: 10 }), labelFor: img.id });
  for (const logo of input.logos.slice(0, 3)) {
    const img = imageFromRef(logo, true);
    img.logo = true;
    img.fit = "contain";
    addLogo(img, logo.logoLabel || logo.title || "Logo");
  }
  for (const ref of input.images) elements.push(imageFromRef(ref, true));
  if (!input.logos.length && !input.images.length && input.placeholders) {
    for (let i = 0; i < input.placeholders.logos; i++) addLogo(placeholderImage(1.6, { logo: true }), "Logo");
    for (let i = 0; i < input.placeholders.images; i++) elements.push(placeholderImage(PLACEHOLDER_ASPECTS[i % PLACEHOLDER_ASPECTS.length]));
  }
  const page: Page = {
    id: uid("p"),
    kind: "case",
    group: input.title,
    caseId: input.caseStudy?.id,
    layout: { ...DEFAULT_LAYOUT, ...input.layout },
    area: { x: m.left, y: cols.bottom, w: W - m.left - m.right, h: contentBottom(settings) - cols.bottom },
    elements,
  };
  return relayoutPage(page);
}

export interface ReferencePageInput {
  title: string;
  subtitle?: string;
  description?: string;
  sectionLabel?: string;
  group?: string;
  images: Reference[];
  layout?: Partial<PageLayout>;
  /** 이미지가 없을 때 채울 회색 박스 자리 수 */
  placeholders?: number;
}

/** 예시 2: 레퍼런스/아이데이션 페이지 (타이틀 | 서브타이틀 | 설명, "Reference" 라벨 + 이미지 배치) */
export function createReferencePage(settings: DocSettings, input: ReferencePageInput): Page {
  const { W } = pageDims(settings);
  const m = settings.margin;
  const cols = headerColumns(settings, 30);
  const labelY = cols.bottom + 2;
  const areaY = labelY + 20;
  const elements: PageElement[] = [
    textEl("title", input.title || dummyText("title"), cols.title),
    textEl("subtitle", input.subtitle || dummyText("subtitle"), cols.subtitle),
    textEl("body", input.description || dummyText("body"), { ...cols.text, y: cols.text.y + 2 }),
    textEl("section", input.sectionLabel ?? "Reference", { x: m.left, y: labelY, w: 240, h: 12 }),
    ...input.images.map((r) => imageFromRef(r, true)),
  ];
  if (!input.images.length && input.placeholders) {
    for (let i = 0; i < input.placeholders; i++) elements.push(placeholderImage(PLACEHOLDER_ASPECTS[i % PLACEHOLDER_ASPECTS.length]));
  }
  const page: Page = {
    id: uid("p"),
    kind: "reference",
    group: input.group ?? input.title,
    layout: { ...DEFAULT_LAYOUT, mode: "columns", columns: 0, ...input.layout },
    area: { x: m.left, y: areaY, w: W - m.left - m.right, h: contentBottom(settings) - areaY },
    elements,
  };
  return relayoutPage(page);
}

export function createCoverPage(
  settings: DocSettings,
  input: { title: string; subtitle?: string; meta?: string; image?: Reference },
): Page {
  const { W, H } = pageDims(settings);
  const m = settings.margin;
  const inner = W - m.left - m.right;
  const textW = input.image ? inner * 0.46 : inner;
  const elements: PageElement[] = [
    { id: uid("s"), type: "shape", shape: "rect", x: m.left, y: H * 0.36, w: 28, h: 3, fill: settings.accent },
    textEl("title", input.title || dummyText("title"), { x: m.left, y: H * 0.36 + 14, w: textW, h: 90 }, { fontSize: 34, lineHeight: 1.1 }),
    textEl("subtitle", input.subtitle || dummyText("subtitle"), { x: m.left, y: H * 0.36 + 110, w: textW, h: 40 }),
    textEl("footer", input.meta ?? "", { x: m.left, y: H - m.bottom - 10, w: textW, h: 10 }),
  ];
  if (input.image) {
    const img = imageFromRef(input.image, false);
    Object.assign(img, { x: m.left + inner * 0.52, y: m.top, w: inner * 0.48, h: H - m.top - m.bottom });
    elements.push(img);
  }
  return {
    id: uid("p"),
    kind: "cover",
    layout: { ...DEFAULT_LAYOUT },
    area: { x: m.left, y: m.top, w: inner, h: H - m.top - m.bottom },
    elements,
    hideFooter: true,
  };
}

export function createSectionPage(settings: DocSettings, input: { title: string; subtitle?: string; index?: number }): Page {
  const { W, H } = pageDims(settings);
  const m = settings.margin;
  const inner = W - m.left - m.right;
  const elements: PageElement[] = [];
  if (input.index !== undefined) {
    elements.push(
      textEl("section", String(input.index).padStart(2, "0"), { x: m.left, y: H * 0.4 - 20, w: 80, h: 14 }, { color: "accent" }),
    );
  }
  elements.push(
    textEl("title", input.title || dummyText("title"), { x: m.left, y: H * 0.4, w: inner * 0.7, h: 50 }, { fontSize: 30 }),
    textEl("subtitle", input.subtitle || dummyText("subtitle"), { x: m.left, y: H * 0.4 + 52, w: inner * 0.7, h: 30 }),
  );
  return {
    id: uid("p"),
    kind: "section",
    group: input.title,
    layout: { ...DEFAULT_LAYOUT },
    area: { x: m.left, y: m.top, w: inner, h: H - m.top - m.bottom },
    elements,
  };
}

export function createBlankPage(settings: DocSettings): Page {
  const { W, H } = pageDims(settings);
  const m = settings.margin;
  return {
    id: uid("p"),
    kind: "blank",
    layout: { ...DEFAULT_LAYOUT },
    area: { x: m.left, y: m.top, w: W - m.left - m.right, h: H - m.top - m.bottom },
    elements: [],
  };
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
 * 페이지의 자동 레이아웃 대상 이미지(와 로고 패널)를 page.layout 설정으로 다시 배치한다.
 * 새 페이지 객체를 반환(입력은 변경하지 않음).
 */
export function relayoutPage(input: Page): Page {
  const page: Page = { ...input, elements: input.elements.map((e) => ({ ...e })) };
  const images = page.elements.filter(isManagedImage);
  const logos = page.elements.filter((e): e is ImageElement => e.type === "image" && !!e.logo);
  const aspects: number[] = [];
  if (logos.length) aspects.push(logoPanelAspect(logos.length));
  aspects.push(...images.map(imageAspect));
  const rects = computeLayout(aspects, page.area, page.layout);
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
export function scalePage(page: Page, sx: number, sy: number): Page {
  const scaleRect = <T extends Rect>(r: T): T => ({ ...r, x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy });
  return relayoutPage({ ...page, area: scaleRect(page.area), elements: page.elements.map(scaleRect) });
}
