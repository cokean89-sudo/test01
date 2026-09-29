// 태그 규칙 — 서버(AI 제안 후처리)와 화면(태그 관리)이 같은 기준을 쓴다.

/** 태그 축: AI 가 축별로 1~2개씩 제안한다 */
export type TagAxis = "field" | "subject" | "element" | "material" | "color" | "mood";

export const TAG_AXES: { key: TagAxis; label: string; hint: string; examples: string[] }[] = [
  { key: "field", label: "분야", hint: "업종·영역", examples: ["스포츠", "리테일", "전시", "F&B"] },
  { key: "subject", label: "대상", hint: "무엇·어디", examples: ["스타디움", "팝업스토어", "파사드"] },
  { key: "element", label: "요소", hint: "눈에 띄는 구성 요소", examples: ["사인물", "조명", "그래픽월", "굿즈"] },
  { key: "material", label: "소재·기법", hint: "재료·가공·표현 기법", examples: ["ETFE", "네온", "미디어파사드", "패턴"] },
  { key: "color", label: "컬러", hint: "주조색", examples: ["레드", "모노톤", "파스텔"] },
  { key: "mood", label: "무드", hint: "분위기", examples: ["야간", "미니멀", "다이내믹"] },
];

export type TagAxes = Record<TagAxis, string[]>;

export function emptyAxes(): TagAxes {
  return { field: [], subject: [], element: [], material: [], color: [], mood: [] };
}

/** 검색에 쓸모없는 단어 — 파일·사이트 흔적, 너무 일반적인 말 */
const BANNED = new Set(
  [
    "pinterest", "pin", "pins", "pinimg", "image", "images", "img", "photo", "photos", "picture", "jpg", "jpeg", "png", "gif", "webp",
    "svg", "avif", "www", "com", "net", "org", "http", "https", "html", "url", "link", "original", "originals", "file", "download",
    "이미지", "사진", "그림", "핀", "핀터레스트", "링크", "파일", "레퍼런스", "reference", "references", "etc", "기타",
  ].map((w) => w.toLowerCase()),
);

/** 비교용 키 — 대소문자·띄어쓰기·하이픈·밑줄·점 무시 ("야간 조명" = "야간조명", "Night-Light" = "night light") */
export function tagKey(tag: string): string {
  return tag.normalize("NFC").toLowerCase().replace(/[\s\-_.·/]+/g, "").trim();
}

export function cleanTag(raw: string): string {
  return raw.normalize("NFC").replace(/^#+/, "").replace(/\s+/g, " ").trim();
}

/** 태그로 쓰면 안 되는 단어인지 */
export function isBannedTag(raw: string): boolean {
  const t = cleanTag(raw);
  const key = tagKey(t);
  if (!key) return true;
  if ([...key].length < 2) return true; // 1글자
  if (/^[\d\s.,:%x×-]+$/.test(t)) return true; // 숫자만 (1200x800, 2024 등)
  if (/^https?:|www\.|\.(com|net|org|kr)\b/i.test(t)) return true;
  if (BANNED.has(key) || BANNED.has(t.toLowerCase())) return true;
  if (t.length > 30) return true;
  return false;
}

/** 라이브러리에 같은 뜻(키가 같은)의 태그가 있으면 그 표기를 쓴다 */
export function canonicalTag(tag: string, vocabulary: string[]): string {
  const key = tagKey(tag);
  return vocabulary.find((v) => tagKey(v) === key) ?? cleanTag(tag);
}

/**
 * AI 제안 후처리 — 금지어 제거, 기존 표기로 바꾸기, 이미 붙은 태그·다른 축과 중복 제거, 축별 최대 2개.
 */
export function refineAxes(raw: Partial<Record<TagAxis, string[]>>, vocabulary: string[] = [], existing: string[] = []): TagAxes {
  const out = emptyAxes();
  const seen = new Set(existing.map(tagKey));
  for (const { key } of TAG_AXES) {
    for (const t of raw[key] ?? []) {
      if (typeof t !== "string" || isBannedTag(t)) continue;
      const tag = canonicalTag(t, vocabulary);
      const k = tagKey(tag);
      if (seen.has(k)) continue;
      seen.add(k);
      if (out[key].length < 2) out[key].push(tag);
    }
  }
  return out;
}

export function flattenAxes(axes: TagAxes): string[] {
  return TAG_AXES.flatMap((a) => axes[a.key]);
}

/** 같은 키로 묶이는 태그들 (태그 관리의 '비슷한 태그' 추천) */
export function similarGroups(tags: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const t of tags) {
    const k = tagKey(t);
    const list = groups.get(k) ?? [];
    if (!list.includes(t)) list.push(t);
    groups.set(k, list);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
