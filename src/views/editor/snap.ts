import type { DocSettings, Page, Rect } from "../../../shared/types";
import { pageSize } from "../../components/PageView";

export interface SnapLines {
  xs: number[];
  ys: number[];
}

/** 스냅 기준선: 페이지 가장자리·중앙·여백·이미지 영역·다른 요소의 가장자리/중앙 */
export function snapLines(page: Page, settings: DocSettings, exclude: Set<string>): SnapLines {
  const { W, H } = pageSize(settings);
  const m = settings.margin;
  const xs = [0, W, W / 2, m.left, W - m.right, page.area.x, page.area.x + page.area.w];
  const ys = [0, H, H / 2, m.top, H - m.bottom, page.area.y, page.area.y + page.area.h];
  for (const e of page.elements) {
    if (exclude.has(e.id)) continue;
    xs.push(e.x, e.x + e.w / 2, e.x + e.w);
    ys.push(e.y, e.y + e.h / 2, e.y + e.h);
  }
  return { xs, ys };
}

function nearest(values: number[], lines: number[], threshold: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const v of values) {
    for (const l of lines) {
      const d = l - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, line: l };
    }
  }
  return best;
}

/** 이동 중인 상자(box + dx,dy)를 기준선에 붙인다 */
export function snapMove(box: Rect, dx: number, dy: number, lines: SnapLines, threshold: number) {
  const x = box.x + dx;
  const y = box.y + dy;
  const sx = nearest([x, x + box.w / 2, x + box.w], lines.xs, threshold);
  const sy = nearest([y, y + box.h / 2, y + box.h], lines.ys, threshold);
  return {
    dx: dx + (sx?.delta ?? 0),
    dy: dy + (sy?.delta ?? 0),
    gx: sx ? [sx.line] : [],
    gy: sy ? [sy.line] : [],
  };
}

/** 한 좌표(모서리)를 기준선에 붙인다 */
export function snapValue(v: number, lines: number[], threshold: number): { v: number; guide?: number } {
  const s = nearest([v], lines, threshold);
  return s ? { v: v + s.delta, guide: s.line } : { v };
}
