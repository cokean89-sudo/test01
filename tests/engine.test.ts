import { describe, expect, it } from "vitest";
import type { Rect } from "../shared/types";
import { computeLayout, layoutGrid, layoutMosaic, partition } from "../src/layout/engine";

const AREA: Rect = { x: 20, y: 100, w: 800, h: 460 };
const ASPECTS = [1.5, 0.66, 1.33, 2.1, 1, 0.8, 1.7, 1.2, 0.62];
const EPS = 0.01;

function assertTiles(rects: Rect[], area: Rect) {
  for (const r of rects) {
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
    expect(r.x).toBeGreaterThanOrEqual(area.x - EPS);
    expect(r.y).toBeGreaterThanOrEqual(area.y - EPS);
    expect(r.x + r.w).toBeLessThanOrEqual(area.x + area.w + EPS);
    expect(r.y + r.h).toBeLessThanOrEqual(area.y + area.h + EPS);
  }
  // 겹침 없음
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
      expect(overlap, `rect ${i} overlaps ${j}`).toBe(false);
    }
  }
  // 영역 오른쪽/아래 끝까지 채움
  expect(Math.max(...rects.map((r) => r.x + r.w))).toBeCloseTo(area.x + area.w, 3);
  expect(Math.max(...rects.map((r) => r.y + r.h))).toBeCloseTo(area.y + area.h, 3);
}

describe("layout engine", () => {
  it("grid: N열로 나누고 마지막 줄은 가로를 채운다", () => {
    const rects = layoutGrid(7, AREA, 3, 6);
    expect(rects).toHaveLength(7);
    assertTiles(rects, AREA);
    const last = rects[6];
    expect(last.w).toBeCloseTo(AREA.w, 5);
    expect(rects[0].w).toBeCloseTo((AREA.w - 12) / 3, 5);
  });

  it("grid: 이미지가 열 수보다 적으면 그 수만큼만 나눈다", () => {
    const rects = layoutGrid(2, AREA, 4, 6);
    expect(rects[0].w).toBeCloseTo((AREA.w - 6) / 2, 5);
  });

  for (const mode of ["grid", "rows", "columns", "mosaic"] as const) {
    it(`${mode}: 영역 안에서 겹치지 않게 빈틈없이 채운다`, () => {
      for (let n = 1; n <= ASPECTS.length; n++) {
        const rects = computeLayout(ASPECTS.slice(0, n), AREA, { mode, columns: 3, rows: 0, gap: 6, seed: 0 });
        expect(rects).toHaveLength(n);
        assertTiles(rects, AREA);
      }
    });
  }

  it("rows: 같은 줄의 이미지는 높이가 같고 비율을 유지한다", () => {
    const aspects = [1.5, 1.5, 0.75, 2];
    const rects = computeLayout(aspects, AREA, { mode: "rows", columns: 0, rows: 1, gap: 0, seed: 0 });
    const h = rects[0].h;
    for (const r of rects) expect(r.h).toBeCloseTo(h, 5);
    expect(rects[0].w / rects[2].w).toBeCloseTo(2, 5);
  });

  it("columns: 지정한 열 수를 따른다", () => {
    const rects = computeLayout(ASPECTS, AREA, { mode: "columns", columns: 4, rows: 0, gap: 6, seed: 0 });
    const xs = new Set(rects.map((r) => r.x.toFixed(2)));
    expect(xs.size).toBe(4);
  });

  it("mosaic: seed 가 같으면 같은 결과, 다르면 다른 배열이 나올 수 있다", () => {
    const a = layoutMosaic(ASPECTS, AREA, 6, 0);
    const b = layoutMosaic(ASPECTS, AREA, 6, 0);
    expect(a).toEqual(b);
    const variants = new Set([0, 1, 2, 3, 4].map((s) => JSON.stringify(layoutMosaic(ASPECTS, AREA, 6, s))));
    expect(variants.size).toBeGreaterThan(1);
  });

  it("partition: 순서를 지키며 합이 고르게 나눈다", () => {
    const groups = partition([1, 1, 1, 1, 4], 2);
    expect(groups).toEqual([[0, 1, 2, 3], [4]]);
    expect(partition([1, 2, 3], 5)).toHaveLength(3);
  });

  it("잘못된 비율은 기본값으로 처리한다", () => {
    const rects = computeLayout([0, NaN, -1, Infinity], AREA, { mode: "rows", columns: 0, rows: 0, gap: 4, seed: 0 });
    expect(rects).toHaveLength(4);
    assertTiles(rects, AREA);
  });
});
