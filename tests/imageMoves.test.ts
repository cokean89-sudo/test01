// 페이지 간 이미지 이동 · 교체 · 서로 바꾸기 · 임시 보관함 · 붙여넣기 · 보관함 병합

import { describe, expect, it } from "vitest";
import { mergeDocuments } from "../shared/merge";
import type { DocumentData, ImageElement, Page, Reference } from "../shared/types";
import { fromTrayItem, insertManaged, moveImagesToPage, pasteElements, replaceImage, sendToTray, swapImages } from "../src/layout/imageMoves";
import { createCasePage, createReferencePage, textEl } from "../src/layout/templates";
import { defaultSettings } from "../src/lib/defaults";

const ref = (id: string, w = 1200, h = 900): Reference => ({ id, imageUrl: `https://img.example.com/${id}.jpg`, tags: [], kind: "image", source: "manual", width: w, height: h, createdAt: 0 });
const s = defaultSettings();

function doc(): DocumentData {
  const a = createReferencePage(s, { title: "A", images: [ref("a1"), ref("a2"), ref("a3")] });
  const b = createReferencePage(s, { title: "B", images: [ref("b1"), ref("b2")] });
  const c = createReferencePage(s, { title: "C", images: [], placeholders: 2 });
  return { id: "d", title: "t", createdAt: 0, updatedAt: 0, settings: s, pages: [a, b, c], tray: [] };
}
const imgs = (p: Page) => p.elements.filter((e): e is ImageElement => e.type === "image" && !!e.managed && !e.logo);
const srcs = (p: Page) => imgs(p).map((e) => e.src.split("/").pop()!.replace(".jpg", ""));
const inArea = (p: Page) =>
  imgs(p).every((e) => e.x >= p.area.x - 0.5 && e.y >= p.area.y - 0.5 && e.x + e.w <= p.area.x + p.area.w + 0.5 && e.y + e.h <= p.area.y + p.area.h + 0.5);

describe("페이지 간 이동", () => {
  it("썸네일에 놓기: 원래 페이지에서 빠지고 대상 페이지 자동 레이아웃 끝에 들어가 재정렬", () => {
    const d = doc();
    const [a, b] = d.pages;
    const id = imgs(a)[1].id;
    const placed = moveImagesToPage(d, { kind: "page", pageId: a.id, ids: [id] }, b.id, s);
    expect(srcs(d.pages[0])).toEqual(["a1", "a3"]);
    expect(srcs(d.pages[1])).toEqual(["b1", "b2", "a2"]);
    // 새 id (병합 시 같은 id 가 두 페이지에 생기지 않게)
    expect(placed[0]).not.toBe(id);
    expect(inArea(d.pages[0]) && inArea(d.pages[1])).toBe(true);
  });

  it("빈 회색 자리가 있으면 그 자리부터 채운다", () => {
    const d = doc();
    const [a, , c] = d.pages;
    const empties = imgs(c).map((e) => e.id);
    const placed = moveImagesToPage(d, { kind: "page", pageId: a.id, ids: imgs(a).slice(0, 2).map((e) => e.id) }, c.id, s);
    expect(placed).toEqual(empties);
    expect(srcs(d.pages[2])).toEqual(["a1", "a2"]);
  });

  it("놓은 위치에 가까운 순서로 끼운다", () => {
    const d = doc();
    const [a, b] = d.pages;
    const first = imgs(b)[0];
    moveImagesToPage(d, { kind: "page", pageId: a.id, ids: [imgs(a)[0].id] }, b.id, s, { x: first.x + 1, y: first.y + first.h / 2 });
    expect(srcs(d.pages[1])[0]).toBe("a1");
  });

  it("여러 장을 한 번에", () => {
    const d = doc();
    const [a, b] = d.pages;
    moveImagesToPage(d, { kind: "page", pageId: a.id, ids: imgs(a).map((e) => e.id) }, b.id, s);
    expect(imgs(d.pages[0])).toHaveLength(0);
    expect(srcs(d.pages[1])).toEqual(["b1", "b2", "a1", "a2", "a3"]);
  });
});

describe("교체 · 서로 바꾸기", () => {
  it("교체: 대상 자리에 새 이미지, 원래 이미지는 보관함으로", () => {
    const d = doc();
    const [a, b] = d.pages;
    const target = imgs(b)[0];
    replaceImage(d, { kind: "page", pageId: a.id, ids: [imgs(a)[2].id] }, { pageId: b.id, elId: target.id }, s);
    expect(srcs(d.pages[1])).toEqual(["a3", "b2"]);
    expect(srcs(d.pages[0])).toEqual(["a1", "a2"]);
    expect(d.tray!.map((t) => t.src)).toEqual([ref("b1").imageUrl]);
    expect(d.tray![0].from).toBe("B");
  });

  it("서로 바꾸기: 다른 페이지의 두 이미지 내용을 맞바꾼다 (자리 · 크기는 그대로)", () => {
    const d = doc();
    const [a, b] = d.pages;
    swapImages(d, { pageId: a.id, elId: imgs(a)[0].id }, { pageId: b.id, elId: imgs(b)[1].id }, s);
    expect(srcs(d.pages[0])).toEqual(["b2", "a2", "a3"]);
    expect(srcs(d.pages[1])).toEqual(["b1", "a1"]);
    expect(d.tray).toEqual([]);
  });

  it("같은 페이지에서 서로 바꾸기", () => {
    const d = doc();
    const a = d.pages[0];
    swapImages(d, { pageId: a.id, elId: imgs(a)[0].id }, { pageId: a.id, elId: imgs(a)[2].id }, s);
    expect(srcs(d.pages[0])).toEqual(["a3", "a2", "a1"]);
  });
});

describe("임시 보관함", () => {
  it("보내기 → 다시 꺼내 쓰기", () => {
    const d = doc();
    const a = d.pages[0];
    sendToTray(d, a.id, [imgs(a)[0].id], s);
    expect(srcs(d.pages[0])).toEqual(["a2", "a3"]);
    expect(d.tray).toHaveLength(1);
    expect(d.tray![0]).toMatchObject({ src: ref("a1").imageUrl, natW: 1200, natH: 900 });
    moveImagesToPage(d, { kind: "tray", ids: [d.tray![0].id] }, d.pages[1].id, s);
    expect(d.tray).toHaveLength(0);
    expect(srcs(d.pages[1])).toEqual(["b1", "b2", "a1"]);
  });

  it("회색 빈 자리는 보관함에 넣지 않는다", () => {
    const d = doc();
    const c = d.pages[2];
    sendToTray(d, c.id, imgs(c).map((e) => e.id), s);
    expect(d.tray).toEqual([]);
  });

  it("보관함 항목 → 이미지 요소 (비율 유지)", () => {
    const el = fromTrayItem({ id: "t", src: "https://x/y.jpg", natW: 800, natH: 400, addedAt: 0 });
    expect(el.w / el.h).toBeCloseTo(2, 5);
    expect(el.managed).toBe(true);
  });
});

describe("붙여넣기 (⌘C · ⌘X · ⌘V)", () => {
  it("같은 페이지에 복사해 붙이면 옆에 복제 (자유 배치)", () => {
    const d = doc();
    const a = d.pages[0];
    const el = imgs(a)[0];
    const ids = pasteElements(d, { pageId: a.id, cut: false, elements: [structuredClone(el)] }, a.id, s);
    const copy = d.pages[0].elements.find((e) => e.id === ids[0]) as ImageElement;
    expect(copy.managed).toBe(false);
    expect(copy.x).toBeCloseTo(el.x + 10);
  });

  it("다른 페이지에 붙이면 자동 레이아웃 이미지는 그 페이지 자동 레이아웃으로, 글은 같은 위치에", () => {
    const d = doc();
    const [a, b] = d.pages;
    const el = imgs(a)[0];
    const note = textEl("free", "메모", { x: 40, y: 50, w: 100, h: 20 });
    const ids = pasteElements(d, { pageId: a.id, cut: true, elements: [structuredClone(el), note] }, b.id, s);
    expect(ids).toHaveLength(2);
    expect(srcs(d.pages[1])).toEqual(["b1", "b2", "a1"]);
    const t = d.pages[1].elements.find((e) => e.type === "text" && e.text === "메모")!;
    expect([t.x, t.y]).toEqual([40, 50]);
  });

  it("로고는 다른 페이지에 자유 이미지로 (라벨 연결은 끊는다)", () => {
    const logo: Reference = { ...ref("logo"), kind: "logo", logoLabel: "Brand" };
    const cp = createCasePage(s, { title: "C", images: [ref("x")], logos: [logo] });
    const d = doc();
    d.pages.push(cp);
    const els = cp.elements.filter((e) => (e.type === "image" && e.logo) || (e.type === "text" && e.labelFor));
    pasteElements(d, { pageId: cp.id, cut: false, elements: structuredClone(els) }, d.pages[0].id, s);
    const pasted = d.pages[0].elements.filter((e) => e.type === "image" && e.src.endsWith("logo.jpg")) as ImageElement[];
    expect(pasted).toHaveLength(1);
    expect(pasted[0].logo).toBeFalsy();
    expect(d.pages[0].elements.some((e) => e.type === "text" && e.labelFor)).toBe(false);
  });
});

describe("공동 편집 병합", () => {
  it("보관함은 항목 단위로 합친다 — 두 사람이 동시에 넣어도 모두 남는다", () => {
    const base = doc();
    const mine = structuredClone(base);
    const theirs = structuredClone(base);
    sendToTray(mine, mine.pages[0].id, [imgs(mine.pages[0])[0].id], s);
    sendToTray(theirs, theirs.pages[1].id, [imgs(theirs.pages[1])[0].id], s);
    const merged = mergeDocuments(base, mine, theirs).value;
    expect(merged.tray!.map((t) => t.src.split("/").pop()).sort()).toEqual(["a1.jpg", "b1.jpg"]);
    expect(srcs(merged.pages[0])).toEqual(["a2", "a3"]);
    expect(srcs(merged.pages[1])).toEqual(["b2"]);
  });

  it("내가 다른 페이지로 옮기는 동안 상대가 원래 이미지를 고쳐도 id 가 겹치지 않고 내용도 안 사라진다", () => {
    const base = doc();
    const mine = structuredClone(base);
    const theirs = structuredClone(base);
    const id = imgs(base.pages[0])[0].id;
    moveImagesToPage(mine, { kind: "page", pageId: mine.pages[0].id, ids: [id] }, mine.pages[1].id, s);
    const t = theirs.pages[0].elements.find((e) => e.id === id) as ImageElement;
    t.caption = "상대가 고친 캡션";
    const merged = mergeDocuments(base, mine, theirs).value;
    const all = merged.pages.flatMap((p) => p.elements.map((e) => e.id));
    expect(new Set(all).size).toBe(all.length);
    expect(merged.pages[0].elements.some((e) => e.type === "image" && e.caption === "상대가 고친 캡션")).toBe(true);
    expect(srcs(merged.pages[1])).toContain("a1");
  });

  it("insertManaged 는 대상 페이지를 다시 배치한다", () => {
    const d = doc();
    insertManaged(d, d.pages[1].id, [fromTrayItem({ id: "x", src: "https://img.example.com/z.jpg", natW: 500, natH: 1000, addedAt: 0 })], s);
    expect(inArea(d.pages[1])).toBe(true);
    expect(srcs(d.pages[1])).toEqual(["b1", "b2", "z"]);
  });
});
