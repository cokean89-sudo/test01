// 원형 크롭 계산 — 정사각형 미리보기(지름 view px) 안에서 이미지를 옮기고 키운다.
// 상태는 미리보기 기준: x · y = 이미지 왼쪽 위 모서리의 위치(px), zoom = 1(짧은 변이 원을 꽉 채움) ~ MAX_ZOOM.
// 이미지가 원 밖으로 비지 않게 늘 가두고(clamp), 저장할 때 원본 좌표의 정사각형(cropRect)으로 바꾼다.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface CropGeom {
  /** 미리보기 지름 (px) */
  view: number;
  /** 원본 이미지 크기 */
  w: number;
  h: number;
}

export interface CropState {
  x: number;
  y: number;
  zoom: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** zoom 1 일 때 배율 — 짧은 변이 미리보기에 꼭 맞는다 */
export const baseScale = (g: CropGeom) => g.view / Math.min(g.w, g.h);
export const scaleOf = (g: CropGeom, s: CropState) => baseScale(g) * s.zoom;

/** 원 밖으로 빈 곳이 생기지 않게 위치 · 배율을 가둔다 */
export function clampCrop(g: CropGeom, s: CropState): CropState {
  const zoom = clamp(Number.isFinite(s.zoom) ? s.zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);
  const scale = baseScale(g) * zoom;
  return { zoom, x: clamp(s.x, g.view - g.w * scale, 0), y: clamp(s.y, g.view - g.h * scale, 0) };
}

/** 처음: 가운데, 원을 꽉 채우는 크기 */
export function initialCrop(g: CropGeom): CropState {
  const scale = baseScale(g);
  return { zoom: MIN_ZOOM, x: (g.view - g.w * scale) / 2, y: (g.view - g.h * scale) / 2 };
}

export function moveCrop(g: CropGeom, s: CropState, dx: number, dy: number): CropState {
  return clampCrop(g, { ...s, x: s.x + dx, y: s.y + dy });
}

/** 한 점(기본: 원 가운데)을 그 자리에 둔 채 확대 · 축소 */
export function zoomCrop(g: CropGeom, s: CropState, zoom: number, cx = g.view / 2, cy = g.view / 2): CropState {
  const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const before = scaleOf(g, s);
  const after = baseScale(g) * next;
  // 미리보기의 (cx, cy) 가 가리키는 원본 좌표가 그대로 남게
  const px = (cx - s.x) / before;
  const py = (cy - s.y) / before;
  return clampCrop(g, { zoom: next, x: cx - px * after, y: cy - py * after });
}

/** 저장할 원본 영역 — 정사각형 (sx, sy, size) */
export function cropRect(g: CropGeom, s: CropState): { sx: number; sy: number; size: number } {
  const c = clampCrop(g, s);
  const scale = scaleOf(g, c);
  const size = Math.min(g.view / scale, g.w, g.h);
  return { sx: clamp(-c.x / scale, 0, g.w - size), sy: clamp(-c.y / scale, 0, g.h - size), size };
}
