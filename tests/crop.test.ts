// 원형 크롭 계산 — 이동 · 확대가 원 밖으로 비지 않고, 저장 영역이 원본 좌표의 정사각형이 되는지

import { describe, expect, it } from "vitest";
import { baseScale, clampCrop, cropRect, initialCrop, MAX_ZOOM, MIN_ZOOM, moveCrop, zoomCrop, type CropGeom } from "../src/lib/crop";

/** 소수점 오차는 무시하고 비교 */
function expectRect(r: { sx: number; sy: number; size: number }, want: { sx: number; sy: number; size: number }) {
  expect(r.sx).toBeCloseTo(want.sx, 6);
  expect(r.sy).toBeCloseTo(want.sy, 6);
  expect(r.size).toBeCloseTo(want.size, 6);
}

const wide: CropGeom = { view: 280, w: 1600, h: 1200 };
const tall: CropGeom = { view: 280, w: 600, h: 1800 };

describe("원형 크롭", () => {
  it("처음에는 가운데, 짧은 변이 원을 꽉 채운다", () => {
    const s = initialCrop(wide);
    expect(s.zoom).toBe(MIN_ZOOM);
    expect(baseScale(wide)).toBeCloseTo(280 / 1200);
    // 가로로 긴 사진: 위아래는 딱 맞고 좌우가 같은 만큼 넘친다
    expect(s.y).toBeCloseTo(0);
    expect(s.x).toBeCloseTo((280 - 1600 * (280 / 1200)) / 2);
    expectRect(cropRect(wide, s), { sx: 200, sy: 0, size: 1200 });
    expectRect(cropRect(tall, initialCrop(tall)), { sx: 0, sy: 600, size: 600 });
  });

  it("끌어도 원 밖으로 빈 곳이 생기지 않는다", () => {
    const s = initialCrop(wide);
    const far = moveCrop(wide, s, 10_000, 10_000);
    expect(far).toMatchObject({ x: 0, y: 0 });
    expectRect(cropRect(wide, far), { sx: 0, sy: 0, size: 1200 });
    const other = moveCrop(wide, s, -10_000, -10_000);
    expectRect(cropRect(wide, other), { sx: 400, sy: 0, size: 1200 });
  });

  it("확대하면 저장 영역이 작아지고, 가운데 점은 그대로 남는다", () => {
    const s = initialCrop(wide);
    const z = zoomCrop(wide, s, 2);
    expect(z.zoom).toBe(2);
    const r = cropRect(wide, z);
    expect(r.size).toBeCloseTo(600);
    // 가운데(원본 800, 600)가 그대로 가운데
    expect(r.sx + r.size / 2).toBeCloseTo(800);
    expect(r.sy + r.size / 2).toBeCloseTo(600);
  });

  it("한 점을 기준으로 확대하면 그 점이 그 자리에 남는다 (휠 · 두 손가락)", () => {
    const s = zoomCrop(wide, initialCrop(wide), 1.5);
    const cx = 70;
    const cy = 200;
    const before = { x: (cx - s.x) / (baseScale(wide) * s.zoom), y: (cy - s.y) / (baseScale(wide) * s.zoom) };
    const z = zoomCrop(wide, s, 3, cx, cy);
    const after = { x: (cx - z.x) / (baseScale(wide) * z.zoom), y: (cy - z.y) / (baseScale(wide) * z.zoom) };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("배율은 1 ~ 4배로 제한되고, 잘못된 값은 1배로", () => {
    const s = initialCrop(wide);
    expect(zoomCrop(wide, s, 99).zoom).toBe(MAX_ZOOM);
    expect(zoomCrop(wide, s, 0.2).zoom).toBe(MIN_ZOOM);
    expect(clampCrop(wide, { ...s, zoom: Number.NaN }).zoom).toBe(MIN_ZOOM);
  });

  it("축소해도 원 밖으로 빈 곳이 생기지 않게 위치를 다시 맞춘다", () => {
    const zoomed = moveCrop(wide, zoomCrop(wide, initialCrop(wide), 4), -10_000, -10_000);
    const back = zoomCrop(wide, zoomed, 1);
    const r = cropRect(wide, back);
    expect(r.size).toBeCloseTo(1200);
    expect(r.sx + r.size).toBeLessThanOrEqual(1600 + 1e-6);
    expect(r.sy).toBeGreaterThanOrEqual(0);
  });

  it("정사각형 · 작은 사진도 그대로 동작한다", () => {
    const sq: CropGeom = { view: 200, w: 64, h: 64 };
    expectRect(cropRect(sq, initialCrop(sq)), { sx: 0, sy: 0, size: 64 });
    const r = cropRect(sq, zoomCrop(sq, initialCrop(sq), 2));
    expect(r.size).toBeCloseTo(32);
    expect(r.sx).toBeCloseTo(16);
  });
});
