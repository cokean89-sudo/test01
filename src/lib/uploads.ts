// 이미지 파일 올리기 — 끌어놓기 · 붙여넣기에서 파일 고르기, 올리기 전 확인, 용량 표시

import { UPLOAD_ACCEPT, UPLOAD_MAX_MB } from "../../shared/files";

export const ACCEPT_ATTR = UPLOAD_ACCEPT.join(",");
const EXT = /\.(jpe?g|png|webp|gif)$/i;

/** 끌어놓기 · 붙여넣기에 들어 있는 이미지 파일 (웹페이지에서 끈 이미지는 파일이 아니라 링크로 들어온다) */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files];
  // 일부 브라우저는 붙여넣기한 스크린샷을 files 가 아니라 items 로만 준다
  if (!files.length) for (const it of data.items ?? []) if (it.kind === "file") files.push(...[it.getAsFile()].filter((f): f is File => !!f));
  return files.filter((f) => f.type.startsWith("image/") || EXT.test(f.name));
}

export const hasFiles = (data: DataTransfer | null) => !!data && [...(data.types ?? [])].includes("Files");

/** 올리기 전에 거를 것 — 쉬운 말로 이유를 돌려준다 */
export function checkFile(f: File): string | null {
  const okType = UPLOAD_ACCEPT.includes(f.type) || (!f.type && EXT.test(f.name));
  if (!okType) {
    const ext = /\.([a-z0-9]{1,5})$/i.exec(f.name)?.[1]?.toUpperCase();
    return `${ext ? `${ext} 파일` : "이 형식"}은 올릴 수 없어요 (JPG · PNG · WebP · GIF만)`;
  }
  if (f.size > UPLOAD_MAX_MB * 1024 * 1024) return `${formatBytes(f.size)} — 파일당 ${UPLOAD_MAX_MB}MB까지 올릴 수 있어요`;
  return null;
}

/** 파일 이름 → 제목 후보. 붙여넣은 스크린샷(image.png 등)은 비워 둔다 */
export function titleFromName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return /^(image|clipboard|스크린샷|screenshot)?\s*[\d_\-.:() ]*$/i.test(base) ? "" : base.slice(0, 100);
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1).replace(/\.0$/, "")}GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

/** 여러 작업을 n개씩 동시에 */
export async function eachLimit<T>(items: T[], n: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}
