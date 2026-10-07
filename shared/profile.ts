// 프로필 — 팀 · 개인 프로필 이미지, 기본 이모지, 사용자 고유 색.
//
// 색은 이름(키)으로만 저장하고 화면에서는 tokens.json 의 color.profile.<키> 토큰으로 칠한다.
//   진한 색  var(--color-profile-<키>)       팀 기본 이미지 배경 · 사용자 고유 색(선택 테두리 · 깃발 · 히스토리)
//   연한 색  var(--color-profile-<키>-soft)  개인 이모지 배경
// 이모지 그림은 Microsoft Fluent Emoji 3D (MIT 라이선스, public/emoji/LICENSE) — `npm run emoji` 로 받는다.

export const PROFILE_COLORS = [
  { key: "red", label: "빨강" },
  { key: "orange", label: "주황" },
  { key: "yellow", label: "노랑" },
  { key: "lime", label: "연두" },
  { key: "green", label: "초록" },
  { key: "teal", label: "청록" },
  { key: "cyan", label: "하늘" },
  { key: "blue", label: "파랑" },
  { key: "indigo", label: "남색" },
  { key: "violet", label: "보라" },
  { key: "grape", label: "자주" },
  { key: "pink", label: "분홍" },
] as const;

export type ProfileColor = (typeof PROFILE_COLORS)[number]["key"];

const COLOR_KEYS: readonly string[] = PROFILE_COLORS.map((c) => c.key);
export const isProfileColor = (v: unknown): v is ProfileColor => typeof v === "string" && COLOR_KEYS.includes(v);

/** 진한 색 — 사용자 고유 색 · 팀 기본 이미지. 공동 작업 기능(선택 테두리 · 깃발 · 히스토리)은 이 값을 그대로 쓴다 */
export const profileColorVar = (key: ProfileColor) => `var(--color-profile-${key})`;
/** 연한 색 — 이모지 뒤 원형 배경 */
export const profileSoftVar = (key: ProfileColor) => `var(--color-profile-${key}-soft)`;

export interface EmojiItem {
  id: string;
  label: string;
  /** Fluent Emoji 저장소의 폴더 이름 (assets/<이름>/3D/…) */
  fluent: string;
}

export const EMOJI_CATEGORIES: { key: string; label: string; items: EmojiItem[] }[] = [
  {
    key: "animals",
    label: "동물",
    items: [
      { id: "cat", label: "고양이", fluent: "Cat face" },
      { id: "dog", label: "강아지", fluent: "Dog face" },
      { id: "fox", label: "여우", fluent: "Fox" },
      { id: "panda", label: "판다", fluent: "Panda" },
      { id: "rabbit", label: "토끼", fluent: "Rabbit face" },
      { id: "bear", label: "곰", fluent: "Bear" },
      { id: "koala", label: "코알라", fluent: "Koala" },
      { id: "tiger", label: "호랑이", fluent: "Tiger face" },
      { id: "lion", label: "사자", fluent: "Lion" },
      { id: "frog", label: "개구리", fluent: "Frog" },
      { id: "penguin", label: "펭귄", fluent: "Penguin" },
      { id: "unicorn", label: "유니콘", fluent: "Unicorn" },
    ],
  },
  {
    key: "faces",
    label: "표정",
    items: [
      { id: "grin", label: "활짝 웃는 얼굴", fluent: "Grinning face" },
      { id: "cool", label: "선글라스", fluent: "Smiling face with sunglasses" },
      { id: "starstruck", label: "반짝이는 눈", fluent: "Star-struck" },
      { id: "hearteyes", label: "하트 눈", fluent: "Smiling face with heart-eyes" },
      { id: "party", label: "파티", fluent: "Partying face" },
      { id: "nerd", label: "안경", fluent: "Nerd face" },
      { id: "thinking", label: "생각 중", fluent: "Thinking face" },
      { id: "wink", label: "윙크", fluent: "Winking face" },
      { id: "halo", label: "천사", fluent: "Smiling face with halo" },
      { id: "monocle", label: "외알 안경", fluent: "Face with monocle" },
      { id: "ghost", label: "유령", fluent: "Ghost" },
      { id: "robot", label: "로봇", fluent: "Robot" },
    ],
  },
  {
    key: "objects",
    label: "사물",
    items: [
      { id: "rocket", label: "로켓", fluent: "Rocket" },
      { id: "bulb", label: "전구", fluent: "Light bulb" },
      { id: "palette", label: "팔레트", fluent: "Artist palette" },
      { id: "camera", label: "카메라", fluent: "Camera" },
      { id: "laptop", label: "노트북", fluent: "Laptop" },
      { id: "crystal", label: "수정 구슬", fluent: "Crystal ball" },
      { id: "gem", label: "보석", fluent: "Gem stone" },
      { id: "headphone", label: "헤드폰", fluent: "Headphone" },
      { id: "game", label: "게임기", fluent: "Video game" },
      { id: "books", label: "책", fluent: "Books" },
      { id: "trophy", label: "트로피", fluent: "Trophy" },
      { id: "crown", label: "왕관", fluent: "Crown" },
    ],
  },
  {
    key: "nature",
    label: "자연 · 음식",
    items: [
      { id: "sunflower", label: "해바라기", fluent: "Sunflower" },
      { id: "cactus", label: "선인장", fluent: "Cactus" },
      { id: "clover", label: "네잎클로버", fluent: "Four leaf clover" },
      { id: "blossom", label: "벚꽃", fluent: "Cherry blossom" },
      { id: "rainbow", label: "무지개", fluent: "Rainbow" },
      { id: "fire", label: "불꽃", fluent: "Fire" },
      { id: "star", label: "별", fluent: "Glowing star" },
      { id: "avocado", label: "아보카도", fluent: "Avocado" },
      { id: "donut", label: "도넛", fluent: "Doughnut" },
      { id: "pizza", label: "피자", fluent: "Pizza" },
      { id: "strawberry", label: "딸기", fluent: "Strawberry" },
      { id: "coffee", label: "커피", fluent: "Hot beverage" },
    ],
  },
];

export const EMOJIS: EmojiItem[] = EMOJI_CATEGORIES.flatMap((c) => c.items);
const EMOJI_IDS: readonly string[] = EMOJIS.map((e) => e.id);
export const isEmojiId = (v: unknown): v is string => typeof v === "string" && EMOJI_IDS.includes(v);
export const emojiLabel = (id: string) => EMOJIS.find((e) => e.id === id)?.label ?? "이모지";
export const emojiUrl = (id: string) => `/emoji/${id}.webp`;

/** 올린 프로필 사진 주소 — 사진을 바꾸면 id 도 바뀌어서 브라우저가 오래 캐시해도 된다 */
export const avatarUrl = (id: string) => `/api/avatars/${id}.webp`;
export const AVATAR_URL = /^\/api\/avatars\/([A-Za-z0-9_-]{4,40})\.webp$/;
/** 프로필 사진 크기 (정사각형, 원형으로 보여 준다) */
export const AVATAR_EDGE = 512;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** 개인 프로필 — 사진이 없으면 이모지 + 배경색 */
export interface UserProfile {
  /** 사용자 고유 색 */
  color: ProfileColor;
  emoji: string;
  bg: ProfileColor;
  /** 올린 사진 (/api/avatars/<id>.webp) */
  image?: string;
}

/** 팀 프로필 — 사진이 없으면 팀 색 + 팀 이름 첫 글자 */
export interface TeamProfile {
  color: ProfileColor;
  image?: string;
}

const pick = <T>(list: readonly T[], rand: () => number) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

/** 가입 · 팀 만들기 때 무작위 배정 */
export function randomUserLook(rand: () => number = Math.random): { color: ProfileColor; emoji: string; bg: ProfileColor } {
  return { color: pick(PROFILE_COLORS, rand).key, emoji: pick(EMOJIS, rand).id, bg: pick(PROFILE_COLORS, rand).key };
}

export const randomColor = (rand: () => number = Math.random): ProfileColor => pick(PROFILE_COLORS, rand).key;

/** 저장된 값이 없거나 목록에서 빠진 값일 때 id 로 늘 같은 기본값 (화면마다 달라지지 않게) */
export function stableIndex(seed: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % n;
}

export function userProfileOf(id: string, row: { color?: string | null; avatar_emoji?: string | null; avatar_bg?: string | null; avatar_id?: string | null }): UserProfile {
  return {
    color: isProfileColor(row.color) ? row.color : PROFILE_COLORS[stableIndex(id, PROFILE_COLORS.length)].key,
    emoji: isEmojiId(row.avatar_emoji) ? row.avatar_emoji : EMOJIS[stableIndex(id + ":e", EMOJIS.length)].id,
    bg: isProfileColor(row.avatar_bg) ? row.avatar_bg : PROFILE_COLORS[stableIndex(id + ":b", PROFILE_COLORS.length)].key,
    ...(row.avatar_id ? { image: avatarUrl(row.avatar_id) } : {}),
  };
}

export function teamProfileOf(id: string, row: { color?: string | null; avatar_id?: string | null }): TeamProfile {
  return {
    color: isProfileColor(row.color) ? row.color : PROFILE_COLORS[stableIndex(id, PROFILE_COLORS.length)].key,
    ...(row.avatar_id ? { image: avatarUrl(row.avatar_id) } : {}),
  };
}

/** 이름 첫 글자 (팀 기본 이미지) — 공백 · 기호는 건너뛴다 */
export function initialOf(name: string): string {
  const ch = [...name.trim()].find((c) => /[\p{L}\p{N}]/u.test(c));
  return (ch ?? "?").toUpperCase();
}
