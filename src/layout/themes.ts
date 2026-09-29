// 문서 템플릿(테마) — 팔레트 · 폰트 · 타이포 · 여백 · 페이지별 기본 오토 레이아웃.
//
// 색은 hex 대신 토큰(ink, paper, accent, tone1~6 …)으로 저장하고, 그릴 때 이 팔레트로 바꾼다.
// 그래서 템플릿이나 톤온톤의 메인 컬러를 바꾸면 화면 · 인쇄 · HTML · PPTX 가 함께 바뀐다.
//
// 폰트는 모두 SIL Open Font License 1.1 (상업적 사용 · 문서 포함 무료):
//   Pretendard, Noto Sans KR, Noto Serif KR, IBM Plex Sans KR, Poppins, Inter, Montserrat, Playfair Display

import type { ColorToken, DocSettings, FooterSettings, PageKind, PageLayout, TemplateId, TextRole, TextStyle } from "../../shared/types";
import { DEFAULT_LAYOUT, defaultSettings, INK, MM, REPORT_TYPOGRAPHY } from "../lib/defaults";

export type Palette = Record<Exclude<ColorToken, "accent">, string> & { accent: string };

export interface ThemeDef {
  id: TemplateId;
  name: string;
  description: string;
  /** 기본 강조색(톤온톤은 메인 컬러) */
  accent: string;
  /** 고를 수 있는 메인 컬러 (톤온톤) */
  swatches?: string[];
  /** 사용 폰트 (모두 OFL) */
  fonts: string[];
  palette: (accent: string) => Palette;
  margin: { top: number; right: number; bottom: number; left: number };
  typography: Record<TextRole, TextStyle>;
  footer: Partial<FooterSettings>;
  /** 페이지 종류별 기본 오토 레이아웃 */
  layouts: Partial<Record<PageKind, Partial<PageLayout>>>;
  /** 이미지 모서리 (pt) */
  imageRadius: number;
}

// ─── color math ─────────────────────────────────────────────

export function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim()) ?? /^#?([0-9a-f]{3})$/i.exec(hex.trim());
  let h6 = m ? m[1] : "808080";
  if (h6.length === 3) h6 = [...h6].map((c) => c + c).join("");
  const r = parseInt(h6.slice(0, 2), 16) / 255;
  const g = parseInt(h6.slice(2, 4), 16) / 255;
  const b = parseInt(h6.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  const S = Math.max(0, Math.min(100, s)) / 100;
  const L = Math.max(0, Math.min(100, l)) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hx = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hx(f(0))}${hx(f(8))}${hx(f(4))}`;
}

/** 상대 휘도 (WCAG) — 글자색 대비 계산용 */
export function luminance(hex: string): number {
  const [h, s, l] = hexToHsl(hex);
  const rgb = hslToHex(h, s, l)
    .slice(1)
    .match(/../g)!
    .map((x) => {
      const c = parseInt(x, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** 메인 컬러 하나에서 명암 6단계 — 1(가장 밝음) → 6(가장 어두움). 4 는 메인 컬러 그대로 */
export function toneScale(main: string): [string, string, string, string, string, string] {
  const [h, s] = hexToHsl(main);
  return [
    hslToHex(h, Math.min(s, 38), 96),
    hslToHex(h, Math.min(s, 42), 90),
    hslToHex(h, Math.min(s, 46), 78),
    main,
    hslToHex(h, Math.min(s, 50), 27),
    hslToHex(h, Math.min(s, 40), 15),
  ];
}

const grays = (paper: string, ink: string): Pick<Palette, "tone1" | "tone2" | "tone3" | "tone4" | "tone5" | "tone6"> => ({
  tone1: paper,
  tone2: "#f1f1f1",
  tone3: "#d9d9d9",
  tone4: "#9a9a9a",
  tone5: "#555555",
  tone6: ink,
});

// ─── themes ─────────────────────────────────────────────────

const PT = (mm: number) => Math.round(mm * MM * 100) / 100;
const S = (s: TextStyle): TextStyle => s;

/** 기본 — 첨부 A4 부서 양식 (Poppins + Pretendard) */
const DEFAULT_THEME: ThemeDef = {
  id: "default",
  name: "기본",
  description: "A4 부서 양식 — 5단 그리드, 가운데 표지, 먹색 텍스트",
  accent: "#c8102e",
  fonts: ["Poppins", "Pretendard"],
  palette: (accent) => ({ paper: "#ffffff", surface: "#f2f2f2", line: "#d9d9d9", ink: INK, muted: "#6d6e71", invert: "#ffffff", accent, accent2: "#e6e7e8", ...grays("#ffffff", INK) }),
  margin: defaultSettings().margin,
  typography: REPORT_TYPOGRAPHY,
  footer: { divider: false },
  layouts: { case: { ...DEFAULT_LAYOUT }, reference: { ...DEFAULT_LAYOUT } },
  imageRadius: 0,
};

/** 클린 비즈니스 — 화이트 · 블루 포인트 · 그레이 보조, 정돈된 12단 그리드 */
const CLEAN: ThemeDef = {
  id: "clean",
  name: "클린 비즈니스",
  description: "화이트 배경 · 블루 포인트 · 그레이 보조색, 정돈된 그리드",
  accent: "#2563eb",
  fonts: ["Pretendard", "Inter"],
  palette: (accent) => ({ paper: "#ffffff", surface: "#f3f5f8", line: "#dfe4ec", ink: "#172033", muted: "#667085", invert: "#ffffff", accent, accent2: "#98a2b3", ...grays("#ffffff", "#172033") }),
  margin: { top: 34, right: 36, bottom: 34, left: 36 },
  typography: {
    title: S({ fontFamily: "Pretendard", fontSize: 20, fontWeight: 700, tracking: -20, lineHeight: 1.2, color: "ink" }),
    subtitle: S({ fontFamily: "Pretendard", fontSize: 10.5, fontWeight: 500, tracking: 0, lineHeight: 1.4, color: "muted" }),
    highlight: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 600, tracking: 0, lineHeight: 1.6, color: "accent" }),
    body: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 400, tracking: 0, lineHeight: 1.7, color: "ink" }),
    section: S({ fontFamily: "Inter", fontSize: 8, fontWeight: 600, tracking: 80, lineHeight: 1.4, color: "accent", uppercase: true }),
    label: S({ fontFamily: "Pretendard", fontSize: 6.5, fontWeight: 600, tracking: 0, lineHeight: 1.5, color: "ink", background: "surface", bgMode: "inline", padding: 2 }),
    caption: S({ fontFamily: "Pretendard", fontSize: 6.5, fontWeight: 500, tracking: 0, lineHeight: 1.4, color: "#ffffff" }),
    footer: S({ fontFamily: "Inter", fontSize: 6, fontWeight: 400, tracking: 20, lineHeight: 1.2, color: "muted", uppercase: true }),
    free: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 400, tracking: 0, lineHeight: 1.6, color: "ink" }),
  },
  footer: { divider: true, pageNumberFormat: "{nn}" },
  layouts: { case: { ...DEFAULT_LAYOUT, gap: 8 }, reference: { ...DEFAULT_LAYOUT, mode: "grid", columns: 3, gap: 8 }, cover: { ...DEFAULT_LAYOUT, gap: 6 } },
  imageRadius: 4,
};

/** 볼드 브리프 — 블랙/화이트 고대비 · 레드 포인트 · 대형 타이틀 */
const BOLD: ThemeDef = {
  id: "bold",
  name: "볼드 브리프",
  description: "블랙/화이트 고대비 · 레드 포인트 · 대형 타이틀 타이포",
  accent: "#e5262d",
  fonts: ["Pretendard", "Montserrat"],
  palette: (accent) => ({ paper: "#ffffff", surface: "#f0f0f0", line: "#0b0b0b", ink: "#0b0b0b", muted: "#5c5c5c", invert: "#ffffff", accent, accent2: "#0b0b0b", ...grays("#ffffff", "#0b0b0b") }),
  margin: { top: 30, right: 32, bottom: 30, left: 32 },
  typography: {
    title: S({ fontFamily: "Pretendard", fontSize: 26, fontWeight: 900, tracking: -40, lineHeight: 1.05, color: "ink" }),
    subtitle: S({ fontFamily: "Pretendard", fontSize: 10, fontWeight: 700, tracking: 0, lineHeight: 1.35, color: "accent" }),
    highlight: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 800, tracking: 0, lineHeight: 1.55, color: "ink" }),
    body: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 400, tracking: -10, lineHeight: 1.65, color: "ink" }),
    section: S({ fontFamily: "Montserrat", fontSize: 8, fontWeight: 800, tracking: 60, lineHeight: 1.3, color: "accent", uppercase: true }),
    label: S({ fontFamily: "Pretendard", fontSize: 6.5, fontWeight: 800, tracking: 0, lineHeight: 1.5, color: "invert", background: "ink", bgMode: "inline", padding: 2 }),
    caption: S({ fontFamily: "Pretendard", fontSize: 6.5, fontWeight: 700, tracking: 0, lineHeight: 1.4, color: "#ffffff" }),
    footer: S({ fontFamily: "Montserrat", fontSize: 6, fontWeight: 700, tracking: 60, lineHeight: 1.2, color: "ink", uppercase: true }),
    free: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 500, tracking: 0, lineHeight: 1.55, color: "ink" }),
  },
  footer: { divider: false, pageNumberFormat: "{nn}" },
  layouts: { case: { ...DEFAULT_LAYOUT, gap: 5 }, reference: { ...DEFAULT_LAYOUT, mode: "mosaic", gap: 5 } },
  imageRadius: 0,
};

/** 뉴트럴 에디토리얼 — 베이지·크림 배경 · 먹색 텍스트 · 넓은 여백의 잡지형 */
const EDITORIAL: ThemeDef = {
  id: "editorial",
  name: "뉴트럴 에디토리얼",
  description: "크림 배경 · 먹색 세리프 타이틀 · 넓은 여백의 잡지형 레이아웃",
  accent: "#9a7651",
  fonts: ["Noto Serif KR", "Pretendard", "Playfair Display"],
  palette: (accent) => ({ paper: "#f5f0e6", surface: "#ebe3d4", line: "#cfc3ae", ink: "#2a2723", muted: "#7a7166", invert: "#f5f0e6", accent, accent2: "#bfae93", ...grays("#f5f0e6", "#2a2723") }),
  margin: { top: 44, right: 56, bottom: 40, left: 56 },
  typography: {
    title: S({ fontFamily: "Noto Serif KR", fontSize: 21, fontWeight: 500, tracking: -20, lineHeight: 1.25, color: "ink" }),
    subtitle: S({ fontFamily: "Pretendard", fontSize: 8, fontWeight: 500, tracking: 120, lineHeight: 1.5, color: "muted", uppercase: true }),
    highlight: S({ fontFamily: "Noto Serif KR", fontSize: 9.5, fontWeight: 500, tracking: 0, lineHeight: 1.7, color: "accent" }),
    body: S({ fontFamily: "Pretendard", fontSize: 9, fontWeight: 300, tracking: 0, lineHeight: 1.85, color: "ink" }),
    section: S({ fontFamily: "Pretendard", fontSize: 7.5, fontWeight: 500, tracking: 160, lineHeight: 1.4, color: "muted", uppercase: true }),
    label: S({ fontFamily: "Pretendard", fontSize: 6.5, fontWeight: 500, tracking: 40, lineHeight: 1.5, color: "ink", background: "surface", bgMode: "inline", padding: 2 }),
    caption: S({ fontFamily: "Noto Serif KR", fontSize: 6.5, fontWeight: 400, tracking: 0, lineHeight: 1.45, color: "muted" }),
    footer: S({ fontFamily: "Pretendard", fontSize: 6, fontWeight: 400, tracking: 140, lineHeight: 1.2, color: "muted", uppercase: true }),
    free: S({ fontFamily: "Pretendard", fontSize: 9, fontWeight: 300, tracking: 0, lineHeight: 1.8, color: "ink" }),
  },
  footer: { divider: false, pageNumberFormat: "{nn}" },
  layouts: { case: { ...DEFAULT_LAYOUT, gap: 12 }, reference: { ...DEFAULT_LAYOUT, mode: "columns", columns: 3, gap: 12 } },
  imageRadius: 0,
};

/** 모노 포트폴리오 — 오프화이트 · 블랙, 이미지 크게, 텍스트 최소 */
const MONO: ThemeDef = {
  id: "mono",
  name: "모노 포트폴리오",
  description: "오프화이트 · 블랙, 이미지를 크게 · 텍스트는 최소로",
  accent: "#111111",
  fonts: ["IBM Plex Sans KR"],
  palette: (accent) => ({ paper: "#f6f5f1", surface: "#e9e8e3", line: "#111111", ink: "#111111", muted: "#6f6d67", invert: "#f6f5f1", accent, accent2: "#6f6d67", ...grays("#f6f5f1", "#111111") }),
  margin: { top: 26, right: 28, bottom: 30, left: 28 },
  typography: {
    title: S({ fontFamily: "IBM Plex Sans KR", fontSize: 12, fontWeight: 600, tracking: 0, lineHeight: 1.3, color: "ink" }),
    subtitle: S({ fontFamily: "IBM Plex Sans KR", fontSize: 7.5, fontWeight: 400, tracking: 80, lineHeight: 1.4, color: "muted", uppercase: true }),
    highlight: S({ fontFamily: "IBM Plex Sans KR", fontSize: 7.5, fontWeight: 600, tracking: 0, lineHeight: 1.6, color: "ink" }),
    body: S({ fontFamily: "IBM Plex Sans KR", fontSize: 7.5, fontWeight: 400, tracking: 0, lineHeight: 1.65, color: "ink" }),
    section: S({ fontFamily: "IBM Plex Sans KR", fontSize: 7, fontWeight: 500, tracking: 120, lineHeight: 1.3, color: "ink", uppercase: true }),
    label: S({ fontFamily: "IBM Plex Sans KR", fontSize: 6, fontWeight: 500, tracking: 60, lineHeight: 1.5, color: "ink", uppercase: true }),
    caption: S({ fontFamily: "IBM Plex Sans KR", fontSize: 6.5, fontWeight: 400, tracking: 0, lineHeight: 1.4, color: "#ffffff" }),
    footer: S({ fontFamily: "IBM Plex Sans KR", fontSize: 6, fontWeight: 400, tracking: 100, lineHeight: 1.2, color: "muted", uppercase: true }),
    free: S({ fontFamily: "IBM Plex Sans KR", fontSize: 7.5, fontWeight: 400, tracking: 0, lineHeight: 1.6, color: "ink" }),
  },
  footer: { divider: false, pageNumberFormat: "{nn}" },
  layouts: { case: { ...DEFAULT_LAYOUT, mode: "mosaic", gap: 4 }, reference: { ...DEFAULT_LAYOUT, mode: "mosaic", gap: 4 }, cover: { ...DEFAULT_LAYOUT, gap: 0 } },
  imageRadius: 0,
};

/** 톤온톤 — 메인 컬러 하나의 명암 단계로 구성 (메인 컬러는 바꿀 수 있다) */
const TONAL: ThemeDef = {
  id: "tonal",
  name: "톤온톤",
  description: "메인 컬러 하나의 명암 단계로 구성 — 메인 컬러를 바꿀 수 있어요",
  accent: "#2f6b5b",
  swatches: ["#2f6b5b", "#2f4f8f", "#6a4c9c", "#9a3f52", "#b0632f", "#4d5563"],
  fonts: ["Pretendard", "Poppins"],
  palette: (accent) => {
    const [t1, t2, t3, t4, t5, t6] = toneScale(accent);
    return { paper: t1, surface: t2, line: t3, ink: t6, muted: t5, invert: t1, accent: t4, accent2: t3, tone1: t1, tone2: t2, tone3: t3, tone4: t4, tone5: t5, tone6: t6 };
  },
  margin: { top: 34, right: 36, bottom: 34, left: 36 },
  typography: {
    title: S({ fontFamily: "Pretendard", fontSize: 20, fontWeight: 700, tracking: -20, lineHeight: 1.2, color: "tone6" }),
    subtitle: S({ fontFamily: "Poppins", fontSize: 9, fontWeight: 500, tracking: 20, lineHeight: 1.4, color: "tone4" }),
    highlight: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 600, tracking: 0, lineHeight: 1.6, color: "tone4" }),
    body: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 400, tracking: 0, lineHeight: 1.7, color: "tone6" }),
    section: S({ fontFamily: "Poppins", fontSize: 8, fontWeight: 600, tracking: 80, lineHeight: 1.4, color: "tone4", uppercase: true }),
    label: S({ fontFamily: "Pretendard", fontSize: 6.5, fontWeight: 600, tracking: 0, lineHeight: 1.5, color: "tone6", background: "tone2", bgMode: "inline", padding: 2 }),
    caption: S({ fontFamily: "Pretendard", fontSize: 6.5, fontWeight: 500, tracking: 0, lineHeight: 1.4, color: "#ffffff" }),
    footer: S({ fontFamily: "Poppins", fontSize: 6, fontWeight: 500, tracking: 40, lineHeight: 1.2, color: "tone5", uppercase: true }),
    free: S({ fontFamily: "Pretendard", fontSize: 9.5, fontWeight: 400, tracking: 0, lineHeight: 1.6, color: "tone6" }),
  },
  footer: { divider: false, pageNumberFormat: "{nn}" },
  layouts: { case: { ...DEFAULT_LAYOUT, gap: 8 }, reference: { ...DEFAULT_LAYOUT, gap: 8 } },
  imageRadius: 6,
};

export const THEMES: ThemeDef[] = [DEFAULT_THEME, CLEAN, BOLD, EDITORIAL, MONO, TONAL];
const BY_ID = new Map(THEMES.map((t) => [t.id, t]));

export function themeById(id: TemplateId | undefined): ThemeDef {
  return BY_ID.get(id ?? "default") ?? DEFAULT_THEME;
}

export function themeOf(settings: Pick<DocSettings, "template">): ThemeDef {
  return themeById(settings.template);
}

const paletteCache = new Map<string, Palette>();

export function paletteOf(settings: Pick<DocSettings, "template" | "accent">): Palette {
  const key = `${settings.template ?? "default"}|${settings.accent}`;
  let p = paletteCache.get(key);
  if (!p) {
    p = themeOf(settings).palette(settings.accent);
    if (paletteCache.size > 200) paletteCache.clear();
    paletteCache.set(key, p);
  }
  return p;
}

export const COLOR_TOKENS: ColorToken[] = ["accent", "paper", "surface", "line", "ink", "muted", "invert", "accent2", "tone1", "tone2", "tone3", "tone4", "tone5", "tone6"];
const TOKEN_SET = new Set<string>(COLOR_TOKENS);

export function isColorToken(c: string | undefined): c is ColorToken {
  return !!c && TOKEN_SET.has(c);
}

/** 토큰이면 팔레트 색, 아니면 그대로 */
export function resolveToken(c: string | undefined, settings: Pick<DocSettings, "template" | "accent">): string | undefined {
  if (!c) return undefined;
  if (c === "accent") return settings.accent;
  return isColorToken(c) ? paletteOf(settings)[c] : c;
}

/**
 * 문서 설정에 템플릿을 적용 — 여백 · 배경 · 강조색 · 타이포 · 하단 양식 스타일을 바꾼다.
 * 쪽 크기, 부서명 등 하단 문구, 페이지 번호 설정, AI 설정은 그대로 둔다.
 */
export function applyThemeSettings(settings: DocSettings, id: TemplateId, accent?: string): DocSettings {
  const t = themeById(id);
  const main = accent ?? t.accent;
  const next: DocSettings = structuredClone(settings);
  next.template = id;
  next.accent = main;
  next.margin = { ...t.margin };
  next.background = t.palette(main).paper;
  next.typography = structuredClone(t.typography);
  next.footer = { ...next.footer, ...t.footer };
  if (id === "default") next.footer.pageNumberFormat = settings.template && settings.template !== "default" ? "{n}" : next.footer.pageNumberFormat;
  return next;
}

/** 톤온톤 메인 컬러 변경 — 배경(가장 밝은 단계)도 함께 */
export function setThemeAccent(settings: DocSettings, accent: string): DocSettings {
  const next = { ...settings, accent };
  next.background = themeOf(next).palette(accent).paper;
  return next;
}

export function themeLayout(settings: Pick<DocSettings, "template">, kind: PageKind): PageLayout {
  return { ...DEFAULT_LAYOUT, ...themeOf(settings).layouts[kind] };
}

export { PT as mmToPt };
