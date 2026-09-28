import type { DocSettings, FooterSettings, PageLayout, TextRole, TextStyle } from "../../shared/types";

export const KO_SANS = "Pretendard";
export const EN_DISPLAY = "Poppins";

/** 첨부 예시(보고서형 케이스 스터디) 기준 기본 타이포 — A4 가로 pt 단위 */
export const REPORT_TYPOGRAPHY: Record<TextRole, TextStyle> = {
  title: { fontFamily: EN_DISPLAY, fontSize: 20, fontWeight: 600, tracking: -10, lineHeight: 1.15, color: "#111111" },
  subtitle: { fontFamily: EN_DISPLAY, fontSize: 12.5, fontWeight: 400, tracking: -5, lineHeight: 1.2, color: "#111111" },
  highlight: { fontFamily: KO_SANS, fontSize: 8.5, fontWeight: 700, tracking: -10, lineHeight: 1.3, color: "accent" },
  body: { fontFamily: KO_SANS, fontSize: 7.2, fontWeight: 400, tracking: -15, lineHeight: 1.4, color: "#333333" },
  section: { fontFamily: KO_SANS, fontSize: 8.5, fontWeight: 700, tracking: 0, lineHeight: 1.3, color: "#111111" },
  label: {
    fontFamily: KO_SANS,
    fontSize: 6.5,
    fontWeight: 600,
    tracking: 0,
    lineHeight: 1.5,
    color: "#222222",
    background: "#d9d9d9",
    bgMode: "inline",
    padding: 2,
  },
  caption: { fontFamily: KO_SANS, fontSize: 6.5, fontWeight: 500, tracking: -10, lineHeight: 1.4, color: "#ffffff" },
  footer: { fontFamily: KO_SANS, fontSize: 5.5, fontWeight: 400, tracking: 20, lineHeight: 1.2, color: "#333333", uppercase: true },
  free: { fontFamily: KO_SANS, fontSize: 9, fontWeight: 400, tracking: 0, lineHeight: 1.5, color: "#111111" },
};

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
    label: "보고서 (좌 조직명 · 우 문서명+번호)",
    footer: {
      show: true,
      left: "SHINSEGAE BRAND OFFICE",
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
      left: "BRAND STRATEGY",
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

/** 템플릿 기본 배치 — 케이스: 보고서형, 레퍼런스: 세로 정렬(메이슨리) */
export const DEFAULT_LAYOUT: PageLayout = { mode: "report", columns: 3, rows: 0, gap: 6, seed: 0 };

export function defaultSettings(): DocSettings {
  return {
    pageSize: "a4-landscape",
    // 첨부 보고서 템플릿(A4 가로) 실측 기준
    margin: { top: 34, right: 20, bottom: 22, left: 20 },
    background: "#ffffff",
    accent: "#c8102e",
    footer: { ...FOOTER_PRESETS[0].footer },
    header: { show: false, left: "", right: "", divider: false },
    pageNumberStart: 1,
    typography: structuredClone(REPORT_TYPOGRAPHY),
    aiLanguage: "ko",
  };
}

export function formatPageNumber(format: string, n: number, total: number): string {
  return format
    .replaceAll("{nn}", String(n).padStart(2, "0"))
    .replaceAll("{n}", String(n))
    .replaceAll("{total}", String(total));
}
