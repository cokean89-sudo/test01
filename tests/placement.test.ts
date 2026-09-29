// 메뉴 위치 — 기본은 아래 · 버튼 정렬, 가장자리에서는 위 · 반대쪽으로 뒤집기, 둘 다 모자라면 줄이고 스크롤

import { describe, expect, it } from "vitest";
import { placePopover } from "../src/lib/placement";

const vp = { width: 1000, height: 800 };
const box = (left: number, top: number, w = 24, h = 24) => ({ left, top, right: left + w, bottom: top + h });
const menu = { width: 200, height: 180 };

describe("placePopover", () => {
  it("공간이 있으면 버튼 아래, 왼쪽 끝 맞춤", () => {
    const p = placePopover(box(100, 100), menu, vp, "left");
    expect(p).toEqual({ left: 100, top: 130, maxHeight: undefined, up: false, flippedX: false });
  });

  it("오른쪽 정렬은 버튼 오른쪽 끝에 맞춘다", () => {
    const p = placePopover(box(500, 100), menu, vp, "right");
    expect(p.left).toBe(524 - 200);
  });

  it("아래가 모자라면 위로 뒤집는다", () => {
    const a = box(100, 700);
    const p = placePopover(a, menu, vp, "left");
    expect(p.up).toBe(true);
    expect(p.top + menu.height).toBe(a.top - 6);
  });

  it("오른쪽 가장자리에서 넘치면 왼쪽으로 뒤집는다", () => {
    const a = box(900, 100);
    const p = placePopover(a, menu, vp, "left");
    expect(p.flippedX).toBe(true);
    expect(p.left).toBe(a.right - menu.width);
    expect(p.left + menu.width).toBeLessThanOrEqual(vp.width - 8);
  });

  it("왼쪽 가장자리에서 오른쪽 정렬이 넘치면 반대로", () => {
    const p = placePopover(box(20, 100), menu, vp, "right");
    expect(p.flippedX).toBe(true);
    expect(p.left).toBe(20);
  });

  it("양쪽 다 넘치면(메뉴가 화면보다 넓음) 화면 안으로 민다", () => {
    const p = placePopover(box(50, 100), { width: 990, height: 100 }, vp, "left");
    expect(p.left).toBe(8);
  });

  it("위아래 모두 모자라면 넓은 쪽에 맞춰 높이를 줄인다", () => {
    const tall = { width: 200, height: 700 };
    const low = placePopover(box(100, 500), tall, vp, "left"); // 위가 더 넓음
    expect(low.up).toBe(true);
    expect(low.top).toBe(8);
    expect(low.maxHeight).toBe(500 - 6 - 8);
    const high = placePopover(box(100, 150), tall, vp, "left"); // 아래가 더 넓음
    expect(high.up).toBe(false);
    expect(high.top).toBe(180);
    expect(high.maxHeight).toBe(800 - 8 - 180);
  });
});
