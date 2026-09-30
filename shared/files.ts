// 서버에 저장한 이미지의 주소 — 저장소(디스크 · R2 · S3)와 상관없이 늘 /api/files/<id>.webp
// 권한 확인은 서버가 한다 (팀원만 볼 수 있음).

const FILE_URL = /^\/api\/files\/([A-Za-z0-9_-]{4,40})(\.thumb)?\.webp$/;

export const fileUrl = (id: string) => `/api/files/${id}.webp`;
export const fileThumbUrl = (id: string) => `/api/files/${id}.thumb.webp`;

/** /api/files/<id>.webp(또는 썸네일) → id, 아니면 null */
export function fileIdOf(url: string | undefined): string | null {
  return url ? (FILE_URL.exec(url)?.[1] ?? null) : null;
}

export const isStoredImage = (url: string | undefined) => fileIdOf(url) !== null;

/** 문서 · 레퍼런스에 들어갈 수 있는 이미지 주소: http(s) 링크, 앱 샘플, 서버에 저장한 이미지 */
export const SAFE_IMAGE_SRC = /^(https?:\/\/|\/samples\/[\w.-]+$|\/api\/files\/[A-Za-z0-9_-]{4,40}(\.thumb)?\.webp$)/i;

export const UPLOAD_ACCEPT = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const UPLOAD_MAX_MB = 20;
