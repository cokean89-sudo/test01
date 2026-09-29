// 떠 있는 메뉴 · 팝오버 위치 — 버튼(anchor) 옆에 두되 화면 밖으로 나가면 위 / 왼쪽으로 뒤집는다

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Placement {
  left: number;
  top: number;
  /** 위아래 어느 쪽에도 다 들어가지 않을 때만 — 이 높이로 줄이고 메뉴 안에서 스크롤 */
  maxHeight?: number;
  /** 위로 뒤집힘 */
  up: boolean;
  /** 기본 정렬의 반대쪽으로 뒤집힘 */
  flippedX: boolean;
}

/**
 * @param align  left = 버튼 왼쪽 끝에 맞춰 오른쪽으로 펼침, right = 버튼 오른쪽 끝에 맞춰 왼쪽으로 펼침
 * @param gap    버튼과 메뉴 사이
 * @param margin 화면 가장자리에서 띄울 거리
 */
export function placePopover(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  align: "left" | "right" = "left",
  gap = 6,
  margin = 8,
): Placement {
  // ── 세로: 아래가 기본, 모자라면 위, 둘 다 모자라면 넓은 쪽에 맞춰 줄인다
  const below = viewport.height - margin - (anchor.bottom + gap);
  const above = anchor.top - gap - margin;
  let up = false;
  let top: number;
  let maxHeight: number | undefined;
  if (size.height <= below) {
    top = anchor.bottom + gap;
  } else if (size.height <= above) {
    up = true;
    top = anchor.top - gap - size.height;
  } else if (above > below) {
    up = true;
    maxHeight = Math.max(above, 0);
    top = margin;
  } else {
    maxHeight = Math.max(below, 0);
    top = anchor.bottom + gap;
  }

  // ── 가로: 기본 정렬로 넘치면 반대로, 그래도 넘치면 화면 안으로 밀어 넣는다
  const fromLeft = anchor.left;
  const fromRight = anchor.right - size.width;
  const fits = (x: number) => x >= margin && x + size.width <= viewport.width - margin;
  let left = align === "left" ? fromLeft : fromRight;
  let flippedX = false;
  if (!fits(left)) {
    const other = align === "left" ? fromRight : fromLeft;
    if (fits(other)) {
      left = other;
      flippedX = true;
    }
  }
  left = Math.min(Math.max(left, margin), Math.max(margin, viewport.width - margin - size.width));

  return { left, top, maxHeight, up, flippedX };
}
