// 샘플 데이터용 더미 이미지(회색 박스 SVG) 생성기 — `node scripts/gen-samples.mjs`
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("public/samples");
fs.mkdirSync(out, { recursive: true });

// [파일명, 가로/세로 비율, 로고 여부]
const samples = [
  ["arena-night", 2.1],
  ["arena-stands", 0.62],
  ["arena-aerial", 1.7],
  ["arena-tricolor", 1.05],
  ["arena-museum", 1.04],
  ["arena-bowl", 1.7],
  ["arena-store", 1.7],
  ["arena-tour", 1.7],
  ["logo-stadium", 1.6, true],
  ["logo-crest", 1.0, true],
  ["star-stardust", 1.33],
  ["star-marquee", 1.34],
  ["star-arrow-day", 0.66],
  ["star-arrow-night", 0.66],
  ["star-shooting", 2.1],
  ["star-gate", 2.0],
  ["star-tower", 1.0],
  ["star-wire", 0.86],
  ["star-street", 0.86],
];

const r = (n) => Math.round(n * 10) / 10;

/** 가운데 이미지 아이콘 (산 + 해) */
function icon(w, h, color) {
  const s = Math.min(w, h) * 0.16;
  const x = w / 2 - s;
  const y = h / 2 - s * 0.8;
  const W = s * 2;
  const H = s * 1.6;
  return `<g fill="none" stroke="${color}" stroke-width="${r(s * 0.1)}" stroke-linejoin="round">
  <rect x="${r(x)}" y="${r(y)}" width="${r(W)}" height="${r(H)}" rx="${r(s * 0.12)}"/>
  <path d="M${r(x)} ${r(y + H * 0.75)} L${r(x + W * 0.3)} ${r(y + H * 0.42)} L${r(x + W * 0.52)} ${r(y + H * 0.66)} L${r(x + W * 0.68)} ${r(y + H * 0.5)} L${r(x + W)} ${r(y + H * 0.88)}"/>
  <circle cx="${r(x + W * 0.7)}" cy="${r(y + H * 0.28)}" r="${r(s * 0.16)}"/>
</g>`;
}

for (const [name, aspect, logo] of samples) {
  const w = 1200;
  const h = Math.round(w / aspect);
  const body = logo
    ? `<rect width="${w}" height="${h}" fill="#e6e6e6"/>
<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${r(Math.min(w, h) * 0.16)}" letter-spacing="${r(Math.min(w, h) * 0.02)}" fill="#a6a6a6">LOGO</text>`
    : `<rect width="${w}" height="${h}" fill="#d9d9d9"/>
${icon(w, h, "#bdbdbd")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${body}
</svg>
`;
  fs.writeFileSync(path.join(out, name + ".svg"), svg);
}
console.log("generated", samples.length, "samples in", out);
