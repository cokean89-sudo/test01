// 앱 아이콘 만들기 — 상단 로고(파란 사각형 + 흰 막대 · 작은 사각형 두 개)를 PWA · 홈 화면용 PNG 로.
//   npm run icons  →  public/icons/ (icon.svg, icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png)
// 색은 디자인 토큰(color.blue.500 · color.white)에서 읽는다.

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const tokens = JSON.parse(fs.readFileSync(path.join(root, "tokens.json"), "utf8"));
const BLUE: string = tokens.color.blue["500"].$value;
const WHITE: string = tokens.color.white.$value;
const out = path.join(root, "public", "icons");
fs.mkdirSync(out, { recursive: true });

/**
 * 로고 그림 (26 단위 격자 — styles.css 의 .brand-mark 와 같은 비율).
 * inset: 마스커블 아이콘은 안전 영역(가운데 80%) 안에 들어가도록 로고를 줄인다.
 */
function svg(size: number, { rounded, inset }: { rounded: boolean; inset: number }) {
  const s = (size * (1 - inset * 2)) / 26;
  const o = size * inset;
  const r = (x: number, y: number, w: number, h: number, opacity = 1) =>
    `<rect x="${o + x * s}" y="${o + y * s}" width="${w * s}" height="${h * s}" rx="${2 * s}" fill="${WHITE}" opacity="${opacity}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rounded ? (8 / 26) * size : 0}" fill="${BLUE}"/>
  ${r(6, 6, 6, 14)}
  ${r(14, 6, 6, 6, 0.85)}
  ${r(14, 14, 6, 6, 0.85)}
</svg>`;
}

async function png(name: string, size: number, opts: { rounded: boolean; inset: number }) {
  await sharp(Buffer.from(svg(size, opts))).png({ compressionLevel: 9 }).toFile(path.join(out, name));
}

fs.writeFileSync(path.join(out, "icon.svg"), svg(64, { rounded: true, inset: 0 }));
await png("icon-192.png", 192, { rounded: true, inset: 0 });
await png("icon-512.png", 512, { rounded: true, inset: 0 });
// 안드로이드는 모양을 직접 잘라 쓰므로 꽉 찬 배경 + 안전 영역 안의 로고
await png("maskable-512.png", 512, { rounded: false, inset: 0.18 });
// iOS 홈 화면 (모서리는 iOS 가 둥글린다)
await png("apple-touch-icon.png", 180, { rounded: false, inset: 0.06 });
console.log("public/icons 생성 —", fs.readdirSync(out).join(", "));
