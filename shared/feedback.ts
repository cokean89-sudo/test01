// 의견 보내기 — 화면(입력 폼)과 서버(검증·저장)가 같은 기준을 쓴다.

export type FeedbackKind = "bug" | "idea" | "other";

export const FEEDBACK_KINDS: { key: FeedbackKind; label: string; placeholder: string }[] = [
  { key: "bug", label: "오류 신고", placeholder: "어떤 화면에서 무엇을 했을 때 어떤 문제가 생겼는지 적어 주세요." },
  { key: "idea", label: "개선 요청", placeholder: "불편했던 점이나 있으면 좋겠는 기능을 적어 주세요." },
  { key: "other", label: "기타", placeholder: "하고 싶은 말을 자유롭게 적어 주세요." },
];

export const FEEDBACK_LIMITS = {
  messageMax: 5000,
  maxFiles: 3,
  fileBytes: 5 * 1024 * 1024,
  /** 사용자당 전송 횟수 */
  perHour: 5,
  perDay: 20,
};

export const FEEDBACK_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type FeedbackMime = (typeof FEEDBACK_MIME)[number];

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  pageUrl: string;
  /** 화면 크기 (예: 1440×900) */
  viewport?: string;
  screenshots: { name: string; dataUrl: string }[];
}

export interface FeedbackFileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  message: string;
  userId: string | null;
  userEmail: string | null;
  userName: string;
  pageUrl: string;
  browser: string;
  userAgent: string;
  createdAt: number;
  /** sent: 발송 · skipped: 메일 미설정 · failed: 실패 · pending: 발송 중 */
  mailStatus: "pending" | "sent" | "skipped" | "failed";
  mailError?: string;
  status: "open" | "done";
  files: FeedbackFileInfo[];
}

/** 페이지 주소에서 인증·재설정·초대 토큰 같은 비밀값을 가린다 */
export function maskSensitiveUrl(url: string): string {
  return url
    .replace(/#\/(verify|reset|invite)\/[^/?#]+/g, "#/$1/***")
    .replace(/([?&](?:token|code|state|key|password|pw)=)[^&#]*/gi, "$1***")
    .slice(0, 2000);
}

/** User-Agent → "Chrome 131 · Windows" 처럼 읽기 쉬운 브라우저·OS */
export function describeUserAgent(ua: string): string {
  const pick = (re: RegExp) => ua.match(re)?.[1];
  let browser = "알 수 없는 브라우저";
  let v: string | undefined;
  if ((v = pick(/Edg(?:e|A|iOS)?\/(\d+)/))) browser = `Edge ${v}`;
  else if ((v = pick(/Whale\/(\d+)/))) browser = `Whale ${v}`;
  else if ((v = pick(/SamsungBrowser\/(\d+)/))) browser = `Samsung Internet ${v}`;
  else if ((v = pick(/KAKAOTALK\s?(\d+)/i))) browser = `카카오톡 인앱 ${v}`;
  else if ((v = pick(/NAVER\(inapp;[^)]*?(\d+\.\d+)/))) browser = `네이버 인앱 ${v}`;
  else if ((v = pick(/(?:OPR|Opera)\/(\d+)/))) browser = `Opera ${v}`;
  else if ((v = pick(/Firefox\/(\d+)/)) || (v = pick(/FxiOS\/(\d+)/))) browser = `Firefox ${v}`;
  else if ((v = pick(/CriOS\/(\d+)/)) || (v = pick(/Chrome\/(\d+)/))) browser = `Chrome ${v}`;
  else if (/Safari\//.test(ua) && (v = pick(/Version\/(\d+(?:\.\d+)?)/))) browser = `Safari ${v}`;

  let os = "알 수 없는 OS";
  if (/iPhone|iPad|iPod/.test(ua)) os = `iOS ${(pick(/OS (\d+(?:_\d+)?)/) ?? "").replace("_", ".")}`.trim();
  else if (/Android/.test(ua)) os = `Android ${pick(/Android (\d+(?:\.\d+)?)/) ?? ""}`.trim();
  else if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return `${browser} · ${os}`;
}

/** 파일 앞부분(매직 바이트)으로 실제 이미지 형식을 알아낸다 — 확장자·선언된 형식은 믿지 않는다 */
export function sniffImage(bytes: Uint8Array): FeedbackMime | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

const EXT: Record<FeedbackMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** 첨부 파일 이름 — 경로·제어 문자를 없애고 실제 형식의 확장자를 붙인다 */
export function safeFileName(name: string, mime: FeedbackMime, index: number): string {
  const base = name
    .normalize("NFC")
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 60);
  return `${base || `screenshot-${index + 1}`}.${EXT[mime]}`;
}
