// 자동 레이아웃 엔진 — 이미지 비율(가로/세로) 목록과 영역을 받아 각 이미지의 칸(Rect)을 계산한다.
// 모든 함수는 순수 함수이며, 결과 칸은 항상 영역을 빈틈없이 채운다(비율 차이는 cover 크롭으로 흡수).

import type { LayoutMode, Rect } from "../../shared/types";

export interface LayoutOptions {
  mode: LayoutMode;
  columns: number;
  rows: number;
  gap: number;
  seed: number;
}

const DEFAULT_ASPECT = 4 / 3;

export function safeAspect(a: number | undefined): number {
  return a && Number.isFinite(a) && a > 0 ? Math.min(Math.max(a, 0.15), 8) : DEFAULT_ASPECT;
}

export function computeLayout(aspects: number[], area: Rect, opts: LayoutOptions): Rect[] {
  const list = aspects.map(safeAspect);
  if (list.length === 0 || area.w <= 0 || area.h <= 0) return [];
  switch (opts.mode) {
    case "report":
      return layoutReport(list, area, opts.gap, opts.seed);
    case "grid":
      return layoutGrid(list.length, area, opts.columns, opts.gap);
    case "rows":
      return layoutRows(list, area, opts.gap, opts.rows);
    case "columns":
      return layoutColumns(list, area, opts.gap, opts.columns);
    case "mosaic":
      return layoutMosaic(list, area, opts.gap, opts.seed);
  }
}

// ─── Grid ───────────────────────────────────────────────────

/** N단 그리드. 마지막 줄은 남은 칸 수로 가로를 채운다. */
export function layoutGrid(n: number, area: Rect, columns: number, gap: number): Rect[] {
  if (n <= 0) return [];
  const cols = Math.max(1, Math.min(Math.round(columns) || 1, n));
  const rowCount = Math.ceil(n / cols);
  const cellH = (area.h - gap * (rowCount - 1)) / rowCount;
  const out: Rect[] = [];
  for (let r = 0; r < rowCount; r++) {
    const start = r * cols;
    const count = Math.min(cols, n - start);
    const cellW = (area.w - gap * (count - 1)) / count;
    for (let c = 0; c < count; c++) {
      out.push({
        x: area.x + c * (cellW + gap),
        y: area.y + r * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
  }
  return out;
}

// ─── Justified rows / columns ───────────────────────────────

/**
 * 순서를 유지한 채 weights 를 k 개의 연속 그룹으로 나눈다.
 * 각 그룹 합이 평균에 가깝도록(제곱 오차 최소) DP 로 계산.
 */
export function partition(weights: number[], k: number): number[][] {
  const n = weights.length;
  const groups = Math.max(1, Math.min(k, n));
  const prefix = [0];
  for (const w of weights) prefix.push(prefix[prefix.length - 1] + w);
  const target = prefix[n] / groups;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(groups + 1).fill(Infinity));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array(groups + 1).fill(0));
  dp[0][0] = 0;
  for (let j = 1; j <= groups; j++) {
    for (let i = j; i <= n; i++) {
      for (let p = j - 1; p < i; p++) {
        const s = prefix[i] - prefix[p] - target;
        const cost = dp[p][j - 1] + s * s;
        if (cost < dp[i][j]) {
          dp[i][j] = cost;
          from[i][j] = p;
        }
      }
    }
  }
  const result: number[][] = [];
  let i = n;
  for (let j = groups; j >= 1; j--) {
    const p = from[i][j];
    result.unshift(range(p, i));
    i = p;
  }
  return result;
}

interface Strip {
  items: number[];
  /** 교차축 길이 (rows 모드면 줄 높이) */
  cross: number;
}

/**
 * 한 축(main)을 꽉 채우는 줄(strip)들로 배치한다.
 * weights[i] = 교차축 1 단위당 main 축 길이 (rows 모드: 가로/세로 비율).
 */
function justify(weights: number[], main: number, cross: number, gap: number, fixedCount: number): Strip[] {
  const n = weights.length;
  const evaluate = (k: number): { strips: Strip[]; score: number } => {
    const strips = partition(weights, k).map((items) => {
      const sum = items.reduce((acc, i) => acc + weights[i], 0);
      return { items, cross: (main - gap * (items.length - 1)) / sum };
    });
    const total = strips.reduce((acc, s) => acc + s.cross, 0) + gap * (strips.length - 1);
    return { strips, score: Math.abs(Math.log(total / cross)) };
  };

  let best: { strips: Strip[]; score: number };
  if (fixedCount > 0) {
    best = evaluate(Math.min(fixedCount, n));
  } else {
    best = evaluate(1);
    for (let k = 2; k <= n; k++) {
      const cand = evaluate(k);
      if (cand.score < best.score) best = cand;
    }
  }
  // 교차축 합이 영역과 정확히 같도록 스케일 (차이는 크롭으로 흡수)
  const natural = best.strips.reduce((acc, s) => acc + s.cross, 0);
  const avail = cross - gap * (best.strips.length - 1);
  const scale = avail / natural;
  return best.strips.map((s) => ({ ...s, cross: s.cross * scale }));
}

/** 자유 · 가로 정렬: 같은 줄의 이미지는 높이가 같고, 각 줄은 영역 가로폭을 꽉 채운다. */
export function layoutRows(aspects: number[], area: Rect, gap: number, rows = 0): Rect[] {
  const strips = justify(aspects, area.w, area.h, gap, rows);
  const out: Rect[] = new Array(aspects.length);
  let y = area.y;
  for (const strip of strips) {
    const sum = strip.items.reduce((acc, i) => acc + aspects[i], 0);
    const availW = area.w - gap * (strip.items.length - 1);
    let x = area.x;
    for (const i of strip.items) {
      const w = (availW * aspects[i]) / sum;
      out[i] = { x, y, w, h: strip.cross };
      x += w + gap;
    }
    y += strip.cross + gap;
  }
  return out;
}

/** 자유 · 세로 정렬(메이슨리): 같은 열의 이미지는 폭이 같고, 각 열은 영역 높이를 꽉 채운다. */
export function layoutColumns(aspects: number[], area: Rect, gap: number, columns = 0): Rect[] {
  const inv = aspects.map((a) => 1 / a);
  const strips = justify(inv, area.h, area.w, gap, columns);
  const out: Rect[] = new Array(aspects.length);
  let x = area.x;
  for (const strip of strips) {
    const sum = strip.items.reduce((acc, i) => acc + inv[i], 0);
    const availH = area.h - gap * (strip.items.length - 1);
    let y = area.y;
    for (const i of strip.items) {
      const h = (availH * inv[i]) / sum;
      out[i] = { x, y, w: strip.cross, h };
      y += h + gap;
    }
    x += strip.cross + gap;
  }
  return out;
}

// ─── Mosaic (guillotine collage) ────────────────────────────

type MosaicNode = { leaf: number } | { dir: "h" | "v"; a: MosaicNode; b: MosaicNode };

function nodeAspect(node: MosaicNode, aspects: number[]): number {
  if ("leaf" in node) return aspects[node.leaf];
  const a = nodeAspect(node.a, aspects);
  const b = nodeAspect(node.b, aspects);
  return node.dir === "h" ? a + b : 1 / (1 / a + 1 / b);
}

function randomTree(lo: number, hi: number, rand: () => number): MosaicNode {
  if (hi - lo === 1) return { leaf: lo };
  const size = hi - lo;
  // 가운데 근처에서 분할해 균형 잡힌 트리를 만든다
  const mid = lo + Math.max(1, Math.min(size - 1, Math.round(size / 2 + (rand() - 0.5) * Math.max(1, size / 2))));
  return {
    dir: rand() < 0.5 ? "h" : "v",
    a: randomTree(lo, mid, rand),
    b: randomTree(mid, hi, rand),
  };
}

function placeTree(node: MosaicNode, rect: Rect, aspects: number[], gap: number, out: Rect[]): void {
  if ("leaf" in node) {
    out[node.leaf] = rect;
    return;
  }
  const a = nodeAspect(node.a, aspects);
  const b = nodeAspect(node.b, aspects);
  if (node.dir === "h") {
    const avail = Math.max(0, rect.w - gap);
    const wa = (avail * a) / (a + b);
    placeTree(node.a, { x: rect.x, y: rect.y, w: wa, h: rect.h }, aspects, gap, out);
    placeTree(node.b, { x: rect.x + wa + gap, y: rect.y, w: avail - wa, h: rect.h }, aspects, gap, out);
  } else {
    const avail = Math.max(0, rect.h - gap);
    const ha = (avail * (1 / a)) / (1 / a + 1 / b);
    placeTree(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ha }, aspects, gap, out);
    placeTree(node.b, { x: rect.x, y: rect.y + ha + gap, w: rect.w, h: avail - ha }, aspects, gap, out);
  }
}

/** 배치 품질 점수 (낮을수록 좋음): 크롭 왜곡 + 칸 크기 편차 + 극단적 비율 */
export function layoutPenalty(rects: Rect[], aspects: number[]): number {
  let crop = 0;
  let extreme = 0;
  let minA = Infinity;
  let maxA = 0;
  rects.forEach((r, i) => {
    const cell = r.w / Math.max(r.h, 0.001);
    crop += Math.abs(Math.log(cell / aspects[i]));
    if (cell > 4 || cell < 0.25) extreme += 1;
    const area = r.w * r.h;
    minA = Math.min(minA, area);
    maxA = Math.max(maxA, area);
  });
  const imbalance = Math.log(maxA / Math.max(minA, 0.001));
  return crop / rects.length + 0.12 * imbalance + 0.6 * extreme;
}

/** 자유 · 모자이크: 비율에 맞춰 영역을 재귀 분할해 크고 작은 칸을 만든다. seed 로 다른 배열을 고를 수 있다. */
export function layoutMosaic(aspects: number[], area: Rect, gap: number, seed = 0): Rect[] {
  const n = aspects.length;
  if (n === 1) return [{ ...area }];
  const rand = mulberry32(seed * 9973 + n * 31 + 7);
  const trials = Math.min(600, 80 + n * 40);
  let best: Rect[] = [];
  let bestScore = Infinity;
  for (let t = 0; t < trials; t++) {
    const tree = randomTree(0, n, rand);
    const out: Rect[] = new Array(n);
    placeTree(tree, { ...area }, aspects, gap, out);
    const score = layoutPenalty(out, aspects);
    if (score < bestScore) {
      bestScore = score;
      best = out;
    }
  }
  return best;
}

// ─── Report (케이스 스터디 템플릿) ──────────────────────────────

/**
 * 보고서형: 왼쪽 1/3 폭의 열에 앞쪽 항목(로고 패널 + 이미지)을 같은 높이로 쌓고,
 * 나머지 2/3 영역은 모자이크로 채운다. 첨부 템플릿(케이스 스터디 페이지)의 구성.
 */
export function layoutReport(aspects: number[], area: Rect, gap: number, seed = 0): Rect[] {
  const n = aspects.length;
  if (n <= 2) return layoutRows(aspects, area, gap, 1);
  const leftCount = n >= 7 ? 3 : n >= 4 ? 2 : 1;
  const colW = (area.w - gap * 2) / 3;
  const cellH = (area.h - gap * (leftCount - 1)) / leftCount;
  const left: Rect[] = [];
  for (let i = 0; i < leftCount; i++) left.push({ x: area.x, y: area.y + i * (cellH + gap), w: colW, h: cellH });
  const right: Rect = { x: area.x + colW + gap, y: area.y, w: area.w - colW - gap, h: area.h };
  return [...left, ...layoutMosaic(aspects.slice(leftCount), right, gap, seed)];
}

// ─── utils ──────────────────────────────────────────────────

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
