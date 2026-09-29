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
  /** 기록: 누가 언제 추가/수정했는지 (웹 버전) */
  createdBy?: string;
  createdByName?: string;
  updatedAt?: number;
  updatedByName?: string;
}

/** 케이스 스터디(예: 브랜드, 경쟁사, 상품) — 여러 레퍼런스를 묶는 단위 */
export interface CaseStudy {
  id: string;
  name: string;
  subtitle?: string;
  highlight?: string;
  description?: string;
  tags: string[];
  createdAt: number;
  createdByName?: string;
  updatedAt?: number;
  updatedByName?: string;
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
  /** 템플릿 장식(배경 도형·구분선 등) — 템플릿을 바꾸면 새 템플릿의 장식으로 다시 그린다 */
  deco?: boolean;
  /** 템플릿의 내용 자리 이름 (title, body, toc-name, cmp-name-0 …) — 템플릿을 바꿔도 같은 자리로 옮긴다 */
  slot?: string;
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

export type LayoutMode = "report" | "grid" | "rows" | "columns" | "mosaic";

export const LAYOUT_MODES: { key: LayoutMode; label: string; hint: string }[] = [
  { key: "rows", label: "가로 줄", hint: "왼쪽→오른쪽으로 흐르고, 같은 줄은 높이를 맞춰요 (기본)" },
  { key: "columns", label: "세로 열", hint: "위→아래로 흐르고, 같은 열은 폭을 맞춰요 (메이슨리)" },
  { key: "grid", label: "격자", hint: "같은 크기 칸으로 N단 균등 분할" },
  { key: "mosaic", label: "모자이크", hint: "비율에 맞춰 크고 작은 칸으로 나눠요" },
  { key: "report", label: "보고서형", hint: "왼쪽 1단에 쌓고 나머지는 모자이크" },
];

/** 정렬 위치 (피그마 오토 레이아웃의 정렬과 같은 개념) */
export type AlignPos = "start" | "center" | "end";

/** 이미지 영역의 오토 레이아웃 설정 */
export interface PageLayout {
  mode: LayoutMode;
  /** grid / columns 모드의 열 수 (columns 는 0 = 자동) */
  columns: number;
  /** rows 모드의 줄 수 (0 = 자동) */
  rows: number;
  /** 항목 사이 간격 pt */
  gap: number;
  /** mosaic 배열 변형 */
  seed: number;
  /** 안쪽 여백 pt (가로 · 세로) */
  padX?: number;
  padY?: number;
  /** fill: 영역을 꽉 채움(필요하면 크롭) · fit: 원본 비율 유지(크롭 없음, 남는 공간은 정렬로) */
  sizing?: "fill" | "fit";
  alignX?: AlignPos;
  alignY?: AlignPos;
}

/** 글 배치 — 짧은 글은 헤더(3~5단), 긴 글은 왼쪽 1단. auto 는 글 길이로 고른다. fixed 는 직접 옮긴 상태 */
export type TextFlowMode = "auto" | "header" | "side" | "fixed";

export interface PageFlow {
  mode: TextFlowMode;
  /** 짧은 글 자리 */
  header: Rect;
  /** 긴 글 자리 (왼쪽 단) */
  side: Rect;
  /** 긴 글 단과 이미지 영역 사이 간격 */
  gutter: number;
  /** 마지막으로 적용된 배치 */
  resolved?: "header" | "side";
}

export type PageKind = "case" | "reference" | "cover" | "section" | "blank" | "toc" | "compare" | "closing";

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
  /** 자동 레이아웃이 이미지를 채우는 영역 (글이 왼쪽 단에 있으면 그만큼 좁아진다) */
  area: Rect;
  /** 본문 글 배치 (케이스·레퍼런스 페이지) */
  flow?: PageFlow;
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

/** 문서 템플릿 — default 는 A4 부서 양식 */
export type TemplateId = "default" | "clean" | "bold" | "editorial" | "mono" | "tonal";

/**
 * 색 토큰 — 요소·타이포 색에 hex 대신 쓰면 템플릿 팔레트로 바뀐다 (템플릿·메인 컬러를 바꾸면 함께 바뀐다).
 * accent 는 문서 강조색(톤온톤은 메인 컬러).
 */
export type ColorToken = "accent" | "paper" | "surface" | "line" | "ink" | "muted" | "invert" | "accent2" | "tone1" | "tone2" | "tone3" | "tone4" | "tone5" | "tone6";

export interface DocSettings {
  /** 문서 템플릿 (없으면 default) */
  template?: TemplateId;
  pageSize: PageSizeKey;
  margin: { top: number; right: number; bottom: number; left: number };
  background: string;
  accent: string;
  footer: FooterSettings;
  header: HeaderSettings;
  pageNumberStart: number;
  typography: Record<TextRole, TextStyle>;
  aiLanguage: "ko" | "en";
  /** AI 글쓰기 관점 — 문서마다 저장되어 다음에도 기본값으로 쓰인다 */
  aiPerspective?: AiPerspective;
  /** AI 문체 — report: 보고체(명사형 종결, 기본) · sentence: 서술체 */
  aiTone?: AiTone;
}

export type AiPerspective = "design" | "planning" | "fact";
export type AiTone = "report" | "sentence";

export const AI_PERSPECTIVES: { key: AiPerspective; label: string; hint: string }[] = [
  { key: "design", label: "디자인 관점", hint: "형태·컬러·소재·타이포·공간 연출과 시각적 의도 중심" },
  { key: "planning", label: "기획 관점", hint: "목적·타깃·전략·경험 설계·기대 효과 중심" },
  { key: "fact", label: "팩트 나열", hint: "확인 가능한 정보만, 해석·평가 없이" },
];

export const AI_TONES: { key: AiTone; label: string; hint: string }[] = [
  { key: "report", label: "보고체", hint: "명사형 종결 — ~구성. ~강조. ~전달." },
  { key: "sentence", label: "서술체", hint: "평서문 — ~한다. ~이다." },
];

/** AI 로 쓰는 텍스트 항목 */
export type AiTextField = "title" | "subtitle" | "highlight" | "description" | "sectionLabel" | "captions";

/** 임시 보관함 항목 — 이미지 내용만 (위치 · 크기 없음) */
export interface TrayItem {
  id: string;
  src: string;
  refId?: string;
  natW?: number;
  natH?: number;
  caption?: string;
  sourceUrl?: string;
  fit?: "cover" | "contain";
  /** 어느 페이지에서 왔는지 (보관함에 표시) */
  from?: string;
  addedAt: number;
}

export interface DocumentData {
  id: string;
  title: string;
  query?: string;
  createdAt: number;
  updatedAt: number;
  settings: DocSettings;
  pages: Page[];
  /** 임시 보관함 — 페이지에서 빼거나 교체된 이미지 (다시 끌어다 쓸 수 있다) */
  tray?: TrayItem[];
  /** 서버 저장 버전 (동시 편집 병합 기준) */
  version?: number;
  teamId?: string;
  createdByName?: string;
  updatedByName?: string;
}

export interface DocumentSummary {
  id: string;
  title: string;
  query?: string;
  pageCount: number;
  updatedAt: number;
  createdAt: number;
  cover?: string;
  createdByName?: string;
  updatedByName?: string;
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
  perspective?: AiPerspective;
  tone?: AiTone;
  /** 지정하면 이 항목만 다시 쓴다 (항목별 다시 생성) */
  fields?: AiTextField[];
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
  /** 항목별 다시 쓰기였다면 새로 쓴 항목 */
  fields?: AiTextField[];
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
  /** 축별 제안 (분야·대상·요소·소재·기법·컬러·무드) — 바로 저장하지 않고 사용자가 채택한다 */
  axes: Record<"field" | "subject" | "element" | "material" | "color" | "mood", string[]>;
  /** 축별 제안을 한 줄로 */
  tags: string[];
  title?: string;
  /** off: AI 가 연결되지 않아 제안하지 않음 */
  engine: "ai" | "off";
  model?: string;
  notice?: string;
}

export interface AppStatus {
  ai: boolean;
  /** 글쓰기 모델 */
  model: string;
  /** 태그 제안 모델 */
  tagModel?: string;
  aiReason?: string;
}

// ─── 계정 · 팀 (웹 버전) ─────────────────────────────────────

export type Role = "owner" | "admin" | "editor" | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "소유자",
  admin: "관리자",
  editor: "편집자",
  viewer: "보기 전용",
};

export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export interface UserInfo {
  id: string;
  email: string | null;
  name: string;
  emailVerified: boolean;
  hasPassword: boolean;
  providers: string[];
  /** 의견(피드백) 목록을 볼 수 있는 관리자 */
  isAdmin?: boolean;
  /** 가입 시각 — 가입 뒤에 나온 업데이트만 '새 소식'으로 */
  createdAt?: number;
}

export interface TeamSummary {
  id: string;
  name: string;
  role: Role;
  personal: boolean;
  memberCount: number;
}

export interface Member {
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  joinedAt: number;
}

export interface TeamDetail extends TeamSummary {
  members: Member[];
  defaults: DocSettings;
  createdAt: number;
}

export interface InviteInfo {
  id: string;
  kind: "email" | "code";
  email?: string;
  code?: string;
  role: Role;
  createdByName?: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  status: "active" | "used" | "expired" | "revoked" | "locked";
}

export interface ActivityItem {
  id: number;
  userName: string;
  action: string;
  targetType?: string;
  targetId?: string;
  summary: string;
  createdAt: number;
}

export interface DuplicateInfo {
  imageUrl: string;
  existing: Reference;
}

export interface SessionInfo {
  user: UserInfo;
  teams: TeamSummary[];
}

export interface AuthProviders {
  /** public/brand/ 에 넣은 공식 로그인 심볼 파일 (없으면 기본 심볼) */
  brand?: { kakao?: string; naver?: string };
  email: boolean;
  signup: boolean;
  kakao: boolean;
  naver: boolean;
  mail: boolean;
  signupDomains: string[];
}

export interface PresenceUser {
  userId: string;
  name: string;
  pageId?: string;
}

export interface VersionInfo {
  version: number;
  title: string;
  updatedByName: string;
  updatedAt: number;
  pageCount: number;
}
