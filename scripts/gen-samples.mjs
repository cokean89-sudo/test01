// 샘플 데이터용 플레이스홀더 이미지(SVG) 생성기 — `node scripts/gen-samples.mjs`
import fs from "node:fs";
import path from "node:path";

const out = path.resolve("public/samples");
fs.mkdirSync(out, { recursive: true });

const star = (cx, cy, r, points = 5, inner = 0.45) => {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 ? r * inner : r;
    const a = (Math.PI * i) / points - Math.PI / 2;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
};

const motifs = {
  stadium: (w, h, c) => `<ellipse cx="${w / 2}" cy="${h * 0.58}" rx="${w * 0.4}" ry="${h * 0.2}" fill="${c}" opacity=".9"/>
    ${Array.from({ length: 14 }, (_, i) => `<line x1="${w * 0.12 + i * w * 0.058}" y1="${h * 0.4}" x2="${w * 0.2 + i * w * 0.05}" y2="${h * 0.76}" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>`).join("")}`,
  bowl: (w, h, c) => `<rect x="0" y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="#2e7d32"/>
    <path d="M0 ${h * 0.62} Q ${w / 2} ${h * 0.3} ${w} ${h * 0.62}" fill="${c}" opacity=".85"/>
    <ellipse cx="${w / 2}" cy="${h * 0.22}" rx="${w * 0.32}" ry="${h * 0.14}" fill="#111" opacity=".75"/>`,
  store: (w, h, c) => Array.from({ length: 6 }, (_, i) => `<rect x="${w * 0.08 + i * w * 0.145}" y="${h * 0.3}" width="${w * 0.1}" height="${h * 0.45}" rx="12" fill="${i % 2 ? c : "#fff"}" opacity=".9"/>`).join(""),
  corridor: (w, h, c) => `<polygon points="0,0 ${w * 0.55},${h * 0.3} ${w * 0.55},${h * 0.7} 0,${h}" fill="#000" opacity=".35"/><rect x="${w * 0.62}" y="${h * 0.2}" width="${w * 0.3}" height="${h * 0.6}" fill="${c}"/><circle cx="${w * 0.77}" cy="${h * 0.5}" r="${h * 0.2}" fill="#fff" opacity=".8"/>`,
  people: (w, h, c) => Array.from({ length: 5 }, (_, i) => `<circle cx="${w * 0.15 + i * w * 0.17}" cy="${h * 0.42}" r="${h * 0.08}" fill="#fff" opacity=".85"/><rect x="${w * 0.1 + i * w * 0.17}" y="${h * 0.52}" width="${w * 0.1}" height="${h * 0.4}" rx="20" fill="${c}"/>`).join(""),
  star: (w, h, c) => `<polygon points="${star(w / 2, h / 2, Math.min(w, h) * 0.34)}" fill="${c}" stroke="#fff" stroke-width="8"/>
    ${Array.from({ length: 16 }, (_, i) => `<circle cx="${(w * ((i * 37) % 100)) / 100}" cy="${(h * ((i * 53) % 100)) / 100}" r="6" fill="#fff" opacity=".8"/>`).join("")}`,
  sparkle: (w, h, c) => Array.from({ length: 24 }, (_, i) => `<polygon points="${star((w * ((i * 29 + 11) % 90 + 5)) / 100, (h * ((i * 47 + 7) % 80 + 10)) / 100, 18 + (i % 4) * 10, 4, 0.3)}" fill="${i % 3 ? c : "#fff"}"/>`).join(""),
  arrow: (w, h, c) => `<circle cx="${w * 0.45}" cy="${h * 0.32}" r="${w * 0.28}" fill="#fff" stroke="${c}" stroke-width="18"/><path d="M ${w * 0.78} ${h * 0.12} Q ${w * 0.95} ${h * 0.5} ${w * 0.5} ${h * 0.72}" stroke="#f5c400" stroke-width="40" fill="none"/><rect x="${w * 0.46}" y="${h * 0.72}" width="${w * 0.06}" height="${h * 0.28}" fill="#1c3f8f"/>`,
  arc: (w, h, c) => `<path d="M ${w * 0.18} ${h * 0.7} Q ${w * 0.55} ${h * 0.05} ${w * 0.95} ${h * 0.75}" stroke="${c}" stroke-width="26" fill="none" stroke-dasharray="4 10"/><polygon points="${star(w * 0.2, h * 0.68, h * 0.18, 8, 0.35)}" fill="#fff"/>`,
  gate: (w, h, c) => [0.42, 0.3, 0.18].map((s, i) => `<polygon points="${star(w / 2, h * 0.6, h * s * 1.4)}" fill="none" stroke="${c}" stroke-width="${22 - i * 5}"/>`).join(""),
  wire: (w, h, c) => `<polygon points="${star(w / 2, h / 2, Math.min(w, h) * 0.4, 8, 0.25)}" fill="none" stroke="${c}" stroke-width="6"/><polygon points="${star(w / 2, h / 2, Math.min(w, h) * 0.3, 8, 0.25)}" fill="none" stroke="#fff" stroke-width="3"/>`,
  logoStadium: (w, h) => `<ellipse cx="${w / 2}" cy="${h * 0.38}" rx="${w * 0.38}" ry="${h * 0.2}" fill="none" stroke="#111" stroke-width="6"/>${Array.from({ length: 9 }, (_, i) => `<line x1="${w * 0.2 + i * w * 0.07}" y1="${h * 0.2}" x2="${w * 0.26 + i * w * 0.06}" y2="${h * 0.56}" stroke="#111" stroke-width="4"/>`).join("")}<text x="${w / 2}" y="${h * 0.86}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${h * 0.17}" fill="#0b3b8c">ARENA</text>`,
  logoCrest: (w, h) => `<circle cx="${w / 2}" cy="${h / 2}" r="${h * 0.46}" fill="#dc052d"/><circle cx="${w / 2}" cy="${h / 2}" r="${h * 0.3}" fill="#fff"/>${Array.from({ length: 4 }, (_, i) => `<rect x="${w / 2 - h * 0.2 + i * h * 0.1}" y="${h * 0.32}" width="${h * 0.05}" height="${h * 0.36}" fill="#0066b2" transform="rotate(20 ${w / 2} ${h / 2})"/>`).join("")}`,
};

const samples = [
  ["arena-night", 2.1, "#0b0b16", "#3a0710", "stadium", "#e21b2d", "Stadium · Night facade"],
  ["arena-stands", 0.62, "#140606", "#5c0b12", "bowl", "#c8102e", "Stadium · Interior bowl"],
  ["arena-aerial", 1.7, "#9ec5e8", "#e8eef4", "stadium", "#f4f6f8", "Stadium · Aerial day"],
  ["arena-tricolor", 1.05, "#1a2a55", "#3a5fa8", "stadium", "#f2b705", "Stadium · Light show"],
  ["arena-museum", 1.04, "#0f1320", "#2a3350", "corridor", "#d61f2c", "Museum · Corridor"],
  ["arena-bowl", 1.7, "#1d0508", "#6b0f1a", "bowl", "#d11a2a", "Stadium · Match day"],
  ["arena-store", 1.7, "#2b0f12", "#8a1b24", "store", "#e02a36", "Megastore · Kit wall"],
  ["arena-tour", 1.7, "#3b0a0d", "#b3131f", "people", "#1d1d1d", "Stadium tour · Visitors"],
  ["logo-stadium", 1.6, "#ffffff", "#ffffff", "logoStadium", "#111", ""],
  ["logo-crest", 1.0, "#ffffff", "#ffffff", "logoCrest", "#dc052d", ""],
  ["star-stardust", 1.33, "#050505", "#1e1206", "sparkle", "#ffb347", "Neon sign · Stardust"],
  ["star-marquee", 1.34, "#2d7fd3", "#7fb8f0", "star", "#f7a51c", "Marquee star"],
  ["star-arrow-day", 0.66, "#1f5fd6", "#4f8ff0", "arrow", "#d7263d", "Arrow sign · Day"],
  ["star-arrow-night", 0.66, "#050510", "#15153a", "arrow", "#3d5afe", "Arrow sign · Night"],
  ["star-shooting", 2.1, "#070b18", "#1b2340", "arc", "#cfd8ff", "Shooting star light"],
  ["star-gate", 2.0, "#6b6b6b", "#b7b2a8", "gate", "#ffc21a", "Star gate · Photo zone"],
  ["star-tower", 1.0, "#1aa6c9", "#6fd0e6", "sparkle", "#f08a4b", "Star tower sculpture"],
  ["star-wire", 0.86, "#07070d", "#20202e", "wire", "#e8f0ff", "Wire star sculpture"],
  ["star-street", 0.86, "#1a2140", "#4b5a8c", "arc", "#ff3b3b", "Street star lights"],
];

for (const [name, aspect, c1, c2, motif, color, label] of samples) {
  const w = 1200;
  const h = Math.round(w / aspect);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
${motifs[motif](w, h, color)}
${label ? `<text x="36" y="${h - 36}" font-family="Arial, sans-serif" font-size="34" fill="#fff" fill-opacity=".85">SAMPLE · ${label}</text>` : ""}
</svg>`;
  fs.writeFileSync(path.join(out, name + ".svg"), svg);
}
console.log("generated", samples.length, "samples in", out);
