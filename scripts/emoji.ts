// 프로필 기본 이모지 — Microsoft Fluent Emoji 3D (MIT 라이선스)를 받아 public/emoji 에 넣는다.
//   npm run emoji            목록(shared/profile.ts 의 EMOJI_CATEGORIES)에 있는 것 중 없는 것만 받기
//   npm run emoji -- --force 모두 다시 받기
//
// 원본: https://github.com/microsoft/fluentui-emoji (assets/<이름>/3D/<이름>_3d.png, 256px PNG)
// → 160×160 WebP 로 줄인다 (프로필 원 안에서 최대 96px · 레티나 2배).
// 라이선스 전문은 public/emoji/LICENSE 에 함께 둔다. 애플 이모지 등 다른 그림은 쓰지 않는다.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { EMOJIS } from "../shared/profile";

const RAW = "https://raw.githubusercontent.com/microsoft/fluentui-emoji/main";
const OUT = fileURLToPath(new URL("../public/emoji/", import.meta.url));
export const EMOJI_EDGE = 160;

export const sourceUrl = (fluent: string) => `${RAW}/assets/${encodeURIComponent(fluent)}/3D/${encodeURIComponent(fluent.toLowerCase().replace(/ /g, "_"))}_3d.png`;

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const force = process.argv.includes("--force");
  mkdirSync(OUT, { recursive: true });
  // 받은 원본은 따로 만든 빈 임시 폴더에만 둔다
  const tmp = mkdtempSync(path.join(os.tmpdir(), "fluent-emoji-"));
  try {
    writeFileSync(path.join(OUT, "LICENSE"), await download(`${RAW}/LICENSE`));
    let got = 0;
    for (const e of EMOJIS) {
      const out = path.join(OUT, `${e.id}.webp`);
      if (!force && existsSync(out)) continue;
      const png = await download(sourceUrl(e.fluent));
      const src = path.join(tmp, `${e.id}.png`);
      writeFileSync(src, png);
      await sharp(src).resize(EMOJI_EDGE, EMOJI_EDGE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(out);
      got++;
    }
    // 목록에서 빠진 그림은 지운다
    const keep = new Set(EMOJIS.map((e) => `${e.id}.webp`));
    const removed = readdirSync(OUT).filter((f) => f.endsWith(".webp") && !keep.has(f));
    for (const f of removed) rmSync(path.join(OUT, f));
    console.log(`이모지 ${EMOJIS.length}개 — 새로 받음 ${got}개${removed.length ? ` · 지움 ${removed.length}개` : ""} → ${OUT}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error("이모지를 받지 못했어요:", (err as Error).message);
    process.exit(1);
  });
}
