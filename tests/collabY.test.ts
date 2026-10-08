// 실시간 공동 편집 — 문서 JSON ↔ Yjs 변환, 순서 키, 동시 편집 합치기, 내 수정만 되돌리기, 바뀐 곳 찾기

import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { applyDocDiff, applyTextDiff, changesOf, contentToY, DocMirror, EMPTY_CONTENT, keyBetween, mergeText, orderKeys, textEdit, yPages, yRoots, yToContent, type DocContent } from "../shared/collab";
import type { Page, PageElement } from "../shared/types";
import { createCoverPage, createReferencePage } from "../src/layout/templates";
import { defaultSettings } from "../src/lib/defaults";

const text = (id: string, t: string, extra: Partial<PageElement> = {}): PageElement => ({ id, type: "text", role: "title", text: t, x: 0, y: 0, w: 10, h: 10, ...extra }) as PageElement;
const page = (id: string, els: PageElement[], extra: Partial<Page> = {}): Page => ({
  id,
  kind: "blank",
  layout: { mode: "grid", columns: 3, rows: 0, gap: 6, seed: 0 },
  area: { x: 0, y: 0, w: 100, h: 100 },
  elements: els,
  ...extra,
});
const content = (pages: Page[], title = "문서"): DocContent => ({ title, settings: defaultSettings(), pages, tray: [] });

/** 키 순서 · undefined 를 무시하고 비교 */
const norm = (x: unknown): unknown => JSON.parse(JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v)));

function ydoc(c: DocContent) {
  const d = new Y.Doc();
  contentToY(d, c);
  return d;
}
/** 두 문서를 서로 맞춘다 (네트워크 대신) */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}
function clone(d: Y.Doc) {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
  return c;
}
/** 편집기처럼: 지금 내용을 JSON 으로 고친 뒤 차이만 적는다 */
function edit(d: Y.Doc, fn: (c: DocContent) => void, origin: unknown = "me") {
  const before = yToContent(d);
  const after = structuredClone(before);
  fn(after);
  d.transact(() => applyDocDiff(d, before, after), origin);
}

describe("순서 키 (분수 인덱스)", () => {
  it("두 키 사이 키는 늘 그 사이에 있고, 끝이 0 이 아니다", () => {
    let a: string | null = null;
    let b: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(a, b);
      if (a) expect(k > a).toBe(true);
      if (b) expect(k < b).toBe(true);
      expect(k.endsWith("0")).toBe(false);
      keys.push(k);
      // 번갈아 앞 · 뒤로 좁혀 간다 (가장 나쁜 경우)
      if (i % 2) a = k;
      else b = k;
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("새 순서에 맞는 키 — 이미 있는 키는 최대한 그대로", () => {
    const existing = orderKeys(["a", "b", "c", "d", "e"], new Map());
    const moved = orderKeys(["a", "c", "d", "e", "b"], existing);
    const changed = [...moved].filter(([id, k]) => existing.get(id) !== k).map(([id]) => id);
    expect(changed).toEqual(["b"]);
    const sorted = [...moved].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([id]) => id);
    expect(sorted).toEqual(["a", "c", "d", "e", "b"]);
    // 새 항목은 이웃 사이에
    const added = orderKeys(["a", "x", "c", "d", "e", "b"], moved);
    expect([...added].sort((x, y) => (x[1] < y[1] ? -1 : 1)).map(([id]) => id)).toEqual(["a", "x", "c", "d", "e", "b"]);
    expect([...added].filter(([id, k]) => moved.get(id) !== k).map(([id]) => id)).toEqual(["x"]);
  });
});

describe("문서 JSON ↔ Yjs", () => {
  it("실제 템플릿 문서가 그대로 왕복한다", () => {
    const settings = defaultSettings();
    const img = { id: "r1", imageUrl: "https://e.com/a.jpg", title: "A", tags: ["패키지"], width: 800, height: 600 } as never;
    const pages = [createCoverPage(settings, { title: "케이스 스터디" }), createReferencePage(settings, { title: "레퍼런스", images: [img, img] })];
    const c: DocContent = { title: "왕복", query: "#패키지", settings, pages, tray: [{ id: "t1", src: "https://e.com/1.jpg", addedAt: 1 }] };
    expect(norm(yToContent(ydoc(c)))).toEqual(norm(c));
  });

  it("글 하나를 고치면 그 글만 바뀐다 (변경이 작다)", () => {
    const c = content([page("p1", [text("a", "안녕하세요"), text("b", "B")]), page("p2", [text("c", "C")])]);
    const d = ydoc(c);
    const updates: Uint8Array[] = [];
    d.on("update", (u: Uint8Array) => updates.push(u));
    edit(d, (x) => ((x.pages[0].elements[0] as { text: string }).text = "안녕하세요!"));
    expect(updates).toHaveLength(1);
    expect(updates[0].length).toBeLessThan(40);
    expect((yToContent(d).pages[0].elements[0] as { text: string }).text).toBe("안녕하세요!");
  });

  it("거울: 바뀐 페이지만 새 객체, 나머지는 그대로", () => {
    const d = ydoc(content([page("p1", [text("a", "A")]), page("p2", [text("b", "B")])]));
    const mirror = new DocMirror(d);
    yPages(d).observeDeep((events) => mirror.invalidate("pages", events));
    const first = mirror.build();
    edit(d, (x) => ((x.pages[1].elements[0] as { text: string }).text = "B2"));
    const second = mirror.build();
    expect(second.pages[0]).toBe(first.pages[0]);
    expect(second.pages[1]).not.toBe(first.pages[1]);
    expect(second.settings).toBe(first.settings);
  });

  it("빈 문서에서 시작해도 같다", () => {
    const d = new Y.Doc();
    const c = content([page("p1", [text("a", "A")])]);
    d.transact(() => applyDocDiff(d, EMPTY_CONTENT, c));
    expect(norm(yToContent(d))).toEqual(norm(c));
  });
});

describe("동시 편집 합치기", () => {
  const base = () => ydoc(content([page("p1", [text("a", "Hello"), text("b", "B")]), page("p2", [text("c", "C")])]));

  it("같은 글 상자를 동시에 고쳐도 글자 단위로 합쳐진다", () => {
    const a = base();
    const b = clone(a);
    edit(a, (x) => ((x.pages[0].elements[0] as { text: string }).text = "Hello A"));
    edit(b, (x) => ((x.pages[0].elements[0] as { text: string }).text = "B Hello"));
    sync(a, b);
    expect((yToContent(a).pages[0].elements[0] as { text: string }).text).toBe("B Hello A");
    expect(norm(yToContent(a))).toEqual(norm(yToContent(b)));
  });

  it("같은 요소의 다른 속성 · 다른 페이지 변경은 모두 살아남는다", () => {
    const a = base();
    const b = clone(a);
    edit(a, (x) => Object.assign(x.pages[0].elements[1], { x: 50 }));
    edit(b, (x) => {
      Object.assign(x.pages[0].elements[1], { y: 70 });
      (x.pages[1].elements[0] as { text: string }).text = "C!";
    });
    sync(a, b);
    const r = yToContent(a);
    expect(r.pages[0].elements[1]).toMatchObject({ x: 50, y: 70 });
    expect((r.pages[1].elements[0] as { text: string }).text).toBe("C!");
  });

  it("동시에 순서를 바꾸고 페이지를 넣어도 겹치거나 사라지지 않는다", () => {
    const a = base();
    const b = clone(a);
    edit(a, (x) => x.pages.reverse());
    edit(b, (x) => x.pages.splice(1, 0, page("p3", [text("d", "D")])));
    sync(a, b);
    const ids = yToContent(a).pages.map((p) => p.id);
    expect(ids.sort()).toEqual(["p1", "p2", "p3"]);
    expect(yToContent(a).pages.map((p) => p.id)).toEqual(yToContent(b).pages.map((p) => p.id));
  });

  it("두 사람이 같은 자리에 페이지를 넣어도 둘 다 남는다", () => {
    const a = base();
    const b = clone(a);
    edit(a, (x) => x.pages.splice(1, 0, page("pa", [])));
    edit(b, (x) => x.pages.splice(1, 0, page("pb", [])));
    sync(a, b);
    const ids = yToContent(a).pages.map((p) => p.id);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe("p1");
    expect(ids.slice(1, 3).sort()).toEqual(["pa", "pb"]);
  });

  it("요소를 다른 페이지로 옮기면 한 번의 변경으로 옮겨진다", () => {
    const a = base();
    const b = clone(a);
    edit(a, (x) => {
      const [el] = x.pages[0].elements.splice(1, 1);
      x.pages[1].elements.push(el);
    });
    sync(a, b);
    const r = yToContent(b);
    expect(r.pages[0].elements.map((e) => e.id)).toEqual(["a"]);
    expect(r.pages[1].elements.map((e) => e.id)).toEqual(["c", "b"]);
  });

  it("예전 저장 버전 기준 차이도 그 사이 다른 사람 변경을 지우지 않는다 (3-way)", () => {
    const d = base();
    const v1 = yToContent(d);
    edit(d, (x) => ((x.pages[1].elements[0] as { text: string }).text = "다른 사람"));
    const mine = structuredClone(v1);
    (mine.pages[0].elements[0] as { text: string }).text = "내 수정";
    d.transact(() => applyDocDiff(d, v1, mine));
    const r = yToContent(d);
    expect((r.pages[0].elements[0] as { text: string }).text).toBe("내 수정");
    expect((r.pages[1].elements[0] as { text: string }).text).toBe("다른 사람");
  });
});

describe("실행 취소 — 내 수정만", () => {
  it("다른 사람이 고친 것은 그대로 두고 내 것만 되돌린다", () => {
    const ME = { me: true };
    const a = ydoc(content([page("p1", [text("t", "제목"), text("s", "부제", { role: "subtitle" })])]));
    const b = clone(a);
    const um = new Y.UndoManager(yRoots(a), { trackedOrigins: new Set([ME]), captureTimeout: 0 });
    edit(a, (x) => ((x.pages[0].elements[0] as { text: string }).text = "내 제목"), ME);
    sync(a, b);
    edit(b, (x) => ((x.pages[0].elements[1] as { text: string }).text = "남의 부제"), "other");
    sync(a, b);
    um.undo();
    sync(a, b);
    for (const d of [a, b]) {
      const els = yToContent(d).pages[0].elements as { text: string }[];
      expect(els.map((e) => e.text)).toEqual(["제목", "남의 부제"]);
    }
  });

  it("같은 값을 그 뒤에 다른 사람이 다시 고쳤으면 그 값을 덮지 않는다", () => {
    const ME = { me: true };
    const a = ydoc(content([page("p1", [text("t", "T", { x: 0 })])]));
    const b = clone(a);
    const um = new Y.UndoManager(yRoots(a), { trackedOrigins: new Set([ME]), captureTimeout: 0 });
    edit(a, (x) => Object.assign(x.pages[0].elements[0], { x: 10 }), ME);
    sync(a, b);
    edit(b, (x) => Object.assign(x.pages[0].elements[0], { x: 20 }), "other");
    sync(a, b);
    um.undo();
    sync(a, b);
    expect(yToContent(a).pages[0].elements[0].x).toBe(20);
  });
});

describe("바뀐 곳 찾기 (활동 기록 · 담당 페이지)", () => {
  it("글 · 속성 · 요소 추가 · 페이지 추가를 경로로 알려 준다", () => {
    const d = ydoc(content([page("p1", [text("a", "A")]), page("p2", [])]));
    const seen: ReturnType<typeof changesOf>[] = [];
    d.on("afterTransaction", (tr: Y.Transaction) => seen.push(changesOf(d, tr)));
    edit(d, (x) => ((x.pages[0].elements[0] as { text: string }).text = "A!"));
    edit(d, (x) => Object.assign(x.pages[0].elements[0], { x: 5, w: 30 }));
    edit(d, (x) => x.pages[1].elements.push(text("n", "새 글")));
    edit(d, (x) => x.pages.push(page("p3", [])));
    edit(d, (x) => (x.title = "새 제목"));
    expect(seen[0]).toEqual([{ kind: "element", pageId: "p1", elementId: "a", key: "text" }]);
    expect(seen[1].map((c) => c.key).sort()).toEqual(["w", "x"]);
    expect(seen[2]).toEqual([{ kind: "element", pageId: "p2", elementId: "n" }]);
    expect(seen[3]).toEqual([{ kind: "page", pageId: "p3" }]);
    expect(seen[4]).toEqual([{ kind: "meta", key: "title" }]);
  });
});

describe("글 차이", () => {
  it("바뀐 구간만, 이모지를 반으로 자르지 않는다", () => {
    expect(textEdit("안녕하세요", "안녕!하세요")).toEqual({ start: 2, del: 0, ins: "!" });
    expect(textEdit("abc", "abc")).toEqual({ start: 3, del: 0, ins: "" });
    const e = textEdit("a😀b", "a😃b");
    expect("a😀b".slice(0, e.start) + e.ins + "a😀b".slice(e.start + e.del)).toBe("a😃b");
  });

  it("그 사이 다른 사람이 앞부분을 고쳤으면 내 수정 위치를 옮긴다", () => {
    const d = new Y.Doc();
    const t = d.getText("t");
    t.insert(0, "Hello world");
    t.insert(0, ">> "); // 다른 사람
    applyTextDiff(t, "Hello world", "Hello brave world");
    expect(t.toString()).toBe(">> Hello brave world");
  });

  it("3방향 합치기 — 휴대폰 글 고치기 창을 연 사이 다른 사람이 고친 내용도 남는다", () => {
    expect(mergeText("Hello world", "Hello brave world", ">> Hello world")).toBe(">> Hello brave world");
    expect(mergeText("Hello world", "Hello world!", "Hi world")).toBe("Hi world!");
    expect(mergeText("abc", "abc", "abcd")).toBe("abcd");
    expect(mergeText("abc", "xbc", "abc")).toBe("xbc");
  });
});
