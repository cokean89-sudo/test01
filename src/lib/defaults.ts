import type { DocSettings, FooterSettings, PageLayout, TextRole, TextStyle } from "../../shared/types";

export const KO_SANS = "Pretendard";
export const EN_DISPLAY = "Poppins";

/** 텍스트 기본색 — 첨부 A4 템플릿의 먹색 */
export const INK = "#231f20";

/**
 * 첨부 A4 템플릿(A4_Template_New.pdf) 실측 기본 타이포 — pt 단위.
 * Title 17/21 · Sub-Title 12/16 · 본문 10/17 · 하단 5.5
 */
export const REPORT_TYPOGRAPHY: Record<TextRole, TextStyle> = {
  title: { fontFamily: EN_DISPLAY, fontSize: 17, fontWeight: 600, tracking: 0, lineHeight: 21 / 17, color: INK },
  subtitle: { fontFamily: EN_DISPLAY, fontSize: 12, fontWeight: 400, tracking: 0, lineHeight: 16 / 12, color: INK },
  highlight: { fontFamily: KO_SANS, fontSize: 10, fontWeight: 600, tracking: 0, lineHeight: 1.7, color: "accent" },
  body: { fontFamily: KO_SANS, fontSize: 10, fontWeight: 300, tracking: 0, lineHeight: 1.7, color: INK },
  section: { fontFamily: EN_DISPLAY, fontSize: 10, fontWeight: 500, tracking: 0, lineHeight: 1.4, color: INK },
  label: {
    fontFamily: KO_SANS,
    fontSize: 6.5,
    fontWeight: 600,
    tracking: 0,
    lineHeight: 1.5,
    color: INK,
    background: "#e6e7e8",
    bgMode: "inline",
    padding: 2,
  },
  caption: { fontFamily: KO_SANS, fontSize: 6.5, fontWeight: 500, tracking: -10, lineHeight: 1.4, color: "#ffffff" },
  footer: { fontFamily: EN_DISPLAY, fontSize: 5.5, fontWeight: 300, tracking: 0, lineHeight: 1.2, color: INK, uppercase: true },
  free: { fontFamily: KO_SANS, fontSize: 10, fontWeight: 400, tracking: 0, lineHeight: 1.6, color: INK },
};

/** 부서명 기본 문구 — 팀 기본 설정에서 바꾼다 */
export const DEFAULT_DEPT = "OO TEAM";

export const TYPOGRAPHY_PRESETS: { key: string; label: string; apply: Partial<Record<TextRole, TextStyle>> }[] = [
  { key: "report", label: "리포트 (Poppins + Pretendard)", apply: REPORT_TYPOGRAPHY },
  {
    key: "minimal",
    label: "미니멀 (Inter + Pretendard)",
    apply: {
      title: { fontFamily: "Inter", fontWeight: 700, tracking: -30 },
      subtitle: { fontFamily: "Inter", fontWeight: 400 },
      footer: { fontFamily: "Inter" },
    },
  },
  {
    key: "editorial",
    label: "에디토리얼 (Playfair + Noto Serif KR)",
    apply: {
      title: { fontFamily: "Playfair Display", fontWeight: 700, tracking: -10, fontSize: 24 },
      subtitle: { fontFamily: "Playfair Display", fontWeight: 400, italic: true },
      body: { fontFamily: "Noto Serif KR", lineHeight: 1.75 },
      highlight: { fontFamily: "Noto Serif KR" },
    },
  },
  {
    key: "bold",
    label: "볼드 (Montserrat + Pretendard)",
    apply: {
      title: { fontFamily: "Montserrat", fontWeight: 800, tracking: -20, uppercase: true },
      subtitle: { fontFamily: "Montserrat", fontWeight: 500 },
      section: { fontFamily: "Montserrat", fontWeight: 800, uppercase: true, tracking: 40 },
    },
  },
];

export const FOOTER_PRESETS: { key: string; label: string; footer: FooterSettings }[] = [
  {
    key: "report",
    label: "보고서 (좌 부서명 · 우 문서명+번호)",
    footer: {
      show: true,
      left: DEFAULT_DEPT,
      center: "",
      right: "{title}",
      pageNumber: true,
      pageNumberPos: "right",
      pageNumberFormat: "{n}",
      divider: false,
    },
  },
  {
    key: "center-number",
    label: "가운데 페이지 번호",
    footer: {
      show: true,
      left: "",
      center: "",
      right: "",
      pageNumber: true,
      pageNumberPos: "center",
      pageNumberFormat: "{n} / {total}",
      divider: false,
    },
  },
  {
    key: "line",
    label: "구분선 + 좌우 태그라인",
    footer: {
      show: true,
      left: DEFAULT_DEPT,
      center: "",
      right: "CASE STUDY",
      pageNumber: true,
      pageNumberPos: "right",
      pageNumberFormat: "{nn}",
      divider: true,
    },
  },
  {
    key: "none",
    label: "없음",
    footer: {
      show: false,
      left: "",
      center: "",
      right: "",
      pageNumber: false,
      pageNumberPos: "right",
      pageNumberFormat: "{n}",
      divider: false,
    },
  },
];

/** 이미지 영역 기본 오토 레이아웃 — 가로 줄(높이 맞춤), 간격 6pt, 꽉 채우기 */
export const DEFAULT_LAYOUT: PageLayout = { mode: "rows", columns: 3, rows: 0, gap: 6, seed: 0, padX: 0, padY: 0, sizing: "fill", alignX: "center", alignY: "center" };

/** mm → pt */
export const MM = 72 / 25.4;

export function defaultSettings(): DocSettings {
  return {
    pageSize: "a4-landscape",
    // 첨부 A4 템플릿 실측: 좌우 10mm, 헤더 시작 13mm, 본문 끝 198mm(하단 12mm)
    margin: { top: round2(13 * MM), right: round2(10 * MM), bottom: round2(12 * MM), left: round2(10 * MM) },
    background: "#ffffff",
    accent: "#c8102e",
    footer: { ...FOOTER_PRESETS[0].footer },
    header: { show: false, left: "", right: "", divider: false },
    pageNumberStart: 1,
    typography: structuredClone(REPORT_TYPOGRAPHY),
    aiLanguage: "ko",
    aiPerspective: "design",
    aiTone: "report",
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function formatPageNumber(format: string, n: number, total: number): string {
  return format
    .replaceAll("{nn}", String(n).padStart(2, "0"))
    .replaceAll("{n}", String(n))
    .replaceAll("{total}", String(total));
}
