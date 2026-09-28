// 서버·클라이언트가 함께 쓰는 데이터 모델.
// 모든 페이지 좌표/크기 단위는 pt(1/72 inch) — 인쇄·PPTX 변환 시 그대로 쓸 수 있다.

export type RefSource = "pinterest" | "web" | "image" | "manual" | "sample";

/** 레퍼런스 1장. 이미지는 저장하지 않고 원본 URL을 그대로 참조한다. */
export interface Reference {
  id: string;
  imageUrl: string;
  sourceUrl?: string;
  title?: string;
  note?: string;
  tags: string[];
  caseId?: string;
  /** logo 로 지정하면 케이스 페이지의 로고 패널에 배치된다 */
  kind: "image" | "logo";
  logoLabel?: string;
  width?: number;
  height?: number;
  source: RefSource;
  createdAt: number;
}

/** 케이스 스터디(예: 경기장, 브랜드, 매장) — 여러 레퍼런스를 묶는 단위 */
export interface CaseStudy {
  id: string;
  name: string;
  subtitle?: string;
  highlight?: string;
  description?: string;
  tags: string[];
  createdAt: number;
}

// ─── Document ───────────────────────────────────────────────

export type PageSizeKey = "a4-landscape" | "a4-portrait" | "a3-landscape" | "wide-16-9";

export const PAGE_SIZES: Record<PageSizeKey, { label: string; w: number; h: number; css: string }> = {
  "a4-landscape": { label: "A4 가로", w: 842, h: 595, css: "297mm 210mm" },
  "a4-portrait": { label: "A4 세로", w: 595, h: 842, css: "210mm 297mm" },
  "a3-landscape": { label: "A3 가로", w: 1191, h: 842, css: "420mm 297mm" },
  "wide-16-9": { label: "16:9 와이드", w: 960, h: 540, css: "338.67mm 190.5mm" },
};

export type TextRole =
  | "title"
  | "subtitle"
  | "highlight"
  | "body"
  | "label"
  | "section"
  | "caption"
  | "footer"
  | "free";

export const TEXT_ROLES: { key: TextRole; label: string }[] = [
  { key: "title", label: "타이틀" },
  { key: "subtitle", label: "서브타이틀" },
  { key: "highlight", label: "하이라이트(강조 라인)" },
  { key: "body", label: "본문 설명" },
  { key: "section", label: "섹션 라벨" },
  { key: "label", label: "칩 라벨" },
  { key: "caption", label: "이미지 캡션" },
  { key: "footer", label: "하단 태그라인" },
  { key: "free", label: "자유 텍스트" },
];

export interface TextStyle {
  fontFamily?: string;
  /** pt */
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  /** 1/1000 em (디자인 툴의 자간 단위와 동일) */
  tracking?: number;
  /** 배수 (1.4 = 140%) */
  lineHeight?: number;
  /** '#rrggbb' 또는 'accent'(문서 강조색) */
  color?: string;
  align?: "left" | "center" | "right" | "justify";
  vAlign?: "top" | "middle" | "bottom";
  background?: string;
  /** box: 박스 전체 배경, inline: 글자 뒤에만(칩/형광펜) */
  bgMode?: "box" | "inline";
  /** pt */
  padding?: number;
  uppercase?: boolean;
}

interface BaseElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
}

export interface TextElement extends BaseElement {
  type: "text";
  role: TextRole;
  text: string;
  style?: TextStyle;
  /** 케이스 페이지 로고 패널의 라벨이면 해당 로고 이미지 id */
  labelFor?: string;
}

export type CaptionPos = "none" | "overlay-bottom" | "overlay-top" | "below";

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  refId?: string;
  natW?: number;
  natH?: number;
  fit: "cover" | "contain";
  /** 0~100 — cover 크롭 시 초점 */
  focusX?: number;
  focusY?: number;
  radius?: number;
  /** 자동 레이아웃 대상이면 true (드래그로 옮기면 해제됨) */
  managed?: boolean;
  /** 케이스 페이지 로고 패널 소속 */
  logo?: boolean;
  caption?: string;
  captionPos?: CaptionPos;
  captionStyle?: TextStyle;
  sourceUrl?: string;
}

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: "rect" | "ellipse" | "line";
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
}

export type PageElement = TextElement | ImageElement | ShapeElement;

export type LayoutMode = "grid" | "rows" | "columns" | "mosaic";

export const LAYOUT_MODES: { key: LayoutMode; label: string; hint: string }[] = [
  { key: "grid", label: "그리드 (N단)", hint: "지정한 열 수로 균등 분할" },
  { key: "rows", label: "자유 · 가로 정렬", hint: "이미지 비율 유지, 줄 단위 배치" },
  { key: "columns", label: "자유 · 세로 정렬", hint: "이미지 비율 유지, 열 단위(메이슨리) 배치" },
  { key: "mosaic", label: "자유 · 모자이크", hint: "비율에 맞춰 크고 작은 칸으로 분할" },
];

export interface PageLayout {
  mode: LayoutMode;
  /** grid / columns 모드의 열 수 (columns 는 0 = 자동) */
  columns: number;
  /** rows 모드의 줄 수 (0 = 자동) */
  rows: number;
  /** pt */
  gap: number;
  /** mosaic 배열 변형 */
  seed: number;
}

export type PageKind = "case" | "reference" | "cover" | "section" | "blank";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Page {
  id: string;
  kind: PageKind;
  /** 태그 그룹명 / 케이스명 */
  group?: string;
  caseId?: string;
  layout: PageLayout;
  /** 자동 레이아웃이 이미지를 채우는 영역 */
  area: Rect;
  elements: PageElement[];
  hideFooter?: boolean;
  background?: string;
  notes?: string;
}

export interface FooterSettings {
  show: boolean;
  left: string;
  center: string;
  right: string;
  pageNumber: boolean;
  pageNumberPos: "left" | "center" | "right";
  /** {n} 페이지 번호, {nn} 두 자리, {total} 전체 페이지 */
  pageNumberFormat: string;
  divider: boolean;
}

export interface HeaderSettings {
  show: boolean;
  left: string;
  right: string;
  divider: boolean;
}

export interface DocSettings {
  pageSize: PageSizeKey;
  margin: { top: number; right: number; bottom: number; left: number };
  background: string;
  accent: string;
  footer: FooterSettings;
  header: HeaderSettings;
  pageNumberStart: number;
  typography: Record<TextRole, TextStyle>;
  aiLanguage: "ko" | "en";
}

export interface DocumentData {
  id: string;
  title: string;
  query?: string;
  createdAt: number;
  updatedAt: number;
  settings: DocSettings;
  pages: Page[];
}

export interface DocumentSummary {
  id: string;
  title: string;
  query?: string;
  pageCount: number;
  updatedAt: number;
  createdAt: number;
  cover?: string;
}

// ─── API payloads ───────────────────────────────────────────

export interface ScrapeItem {
  imageUrl: string;
  title?: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
}

export interface ScrapeResult {
  kind: "pinterest-pin" | "pinterest-board" | "webpage" | "image";
  url: string;
  title?: string;
  description?: string;
  items: ScrapeItem[];
}

export interface AnalyzeImage {
  url: string;
  title?: string;
  note?: string;
  tags?: string[];
}

export interface AnalyzeRequest {
  kind: PageKind;
  language: "ko" | "en";
  group?: string;
  keywords?: string[];
  caseInfo?: { name?: string; subtitle?: string; highlight?: string; description?: string };
  current?: { title?: string; subtitle?: string; highlight?: string; description?: string };
  images: AnalyzeImage[];
  instruction?: string;
}

export interface AnalyzeResult {
  title: string;
  subtitle: string;
  highlight: string;
  description: string;
  sectionLabel: string;
  captions: string[];
  tags: string[];
  /** ai: Claude 응답, heuristic: API 키가 없을 때의 규칙 기반 결과 */
  engine: "ai" | "heuristic";
  model?: string;
  notice?: string;
}

export interface TagSuggestRequest {
  imageUrl: string;
  title?: string;
  note?: string;
  existingTags?: string[];
  /** 라이브러리에서 이미 쓰는 태그 — 가능하면 재사용하도록 전달 */
  vocabulary?: string[];
  language: "ko" | "en";
}

export interface TagSuggestResult {
  tags: string[];
  title?: string;
  engine: "ai" | "heuristic";
  notice?: string;
}

export interface AppStatus {
  ai: boolean;
  model: string;
  aiReason?: string;
}
