// 실시간 공동 편집 — 문서 JSON ↔ Yjs(CRDT) 변환. 서버와 브라우저가 같은 규칙을 쓴다.
//
// Y.Doc 구조
//   meta      Y.Map   title · query
//   settings  Y.Map   문서 설정 — 최상위 키마다 JSON 값 (같은 키를 동시에 바꾸면 나중 쪽)
//   pages     Y.Map   페이지 id → Y.Map(페이지 속성마다 JSON 값, o = 순서 키, elements = Y.Map)
//     elements Y.Map  요소 id → Y.Map(속성마다 JSON 값, z = 쌓임 순서 키, text = Y.Text)
//   tray      Y.Map   보관함 항목 id → JSON (+ _o 순서 키)
//
// 순서는 배열 대신 '분수 인덱스'(문자열 키)로 정한다 — 두 사람이 동시에 순서를 바꿔도 항목이 겹치거나 사라지지 않는다.
// 편집기는 지금처럼 JSON 을 고치고(update recipe), 바뀌기 전후 JSON 을 비교해 바뀐 속성만 Y 에 적는다(applyDocDiff).
// 글(Y.Text)은 바뀐 구간만 지우고 넣어서, 같은 글 상자를 동시에 고쳐도 글자 단위로 합쳐진다.

import * as Y from "yjs";
import type { DocumentData, Page, PageElement, TrayItem } from "./types";

export type DocContent = Pick<DocumentData, "title" | "query" | "settings" | "pages" | "tray">;

type Obj = Record<string, unknown>;

export const EMPTY_CONTENT: DocContent = { title: "", settings: {} as DocumentData["settings"], pages: [], tray: [] };

export const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

// ─── 분수 인덱스 (순서 키) ─────────────────────────────────────

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`순서 키 오류: ${a} >= ${b}`);
  if (b) {
    let n = 0;
    while ((a[n] || "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

/** a 와 b 사이의 키 (a = null 이면 맨 앞, b = null 이면 맨 뒤). 키는 끝이 '0' 이 아니다 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a && b && a >= b) return keyBetween(a, null);
  return midpoint(a ?? "", b);
}

/** 키 순서, 같은 키(동시에 같은 자리에 넣은 경우)면 id 순 */
export const byKey = (ka: string, ia: string, kb: string, ib: string) => (ka < kb ? -1 : ka > kb ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0);

/**
 * 새 순서(ids)에 맞는 키 — 이미 있는 키는 최대한 그대로 두고(가장 긴 증가 부분열), 나머지만 사이 키를 새로 만든다.
 * 그래야 다른 사람이 동시에 끼워 넣은 항목의 자리를 흔들지 않는다.
 */
export function orderKeys(ids: string[], existing: Map<string, string>): Map<string, string> {
  const seq = ids.map((id, i) => ({ i, k: existing.get(id) })).filter((x): x is { i: number; k: string } => x.k !== undefined);
  // 가장 긴 (엄격히) 증가하는 키 부분열 — O(n log n)
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let j = 0; j < seq.length; j++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]].k < seq[j].k) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[j] = tails[lo - 1];
    tails[lo] = j;
  }
  const keep = new Set<number>();
  for (let j = tails.length ? tails[tails.length - 1] : -1; j >= 0; j = prev[j]) keep.add(seq[j].i);
  const nextKept: (string | null)[] = new Array(ids.length).fill(null);
  let upcoming: string | null = null;
  for (let i = ids.length - 1; i >= 0; i--) {
    nextKept[i] = upcoming;
    if (keep.has(i)) upcoming = existing.get(ids[i])!;
  }
  const out = new Map<string, string>();
  let last: string | null = null;
  ids.forEach((id, i) => {
    const k = keep.has(i) ? existing.get(id)! : keyBetween(last, nextKept[i]);
    out.set(id, k);
    last = k;
  });
  return out;
}

// ─── Y → JSON ────────────────────────────────────────────────

export const yMeta = (d: Y.Doc) => d.getMap<unknown>("meta");
export const ySettings = (d: Y.Doc) => d.getMap<unknown>("settings");
export const yPages = (d: Y.Doc) => d.getMap<Y.Map<unknown>>("pages");
export const yTray = (d: Y.Doc) => d.getMap<Obj>("tray");

/** 이미 있는 순서 키 모음 (키가 없는 항목은 빼고) */
function existingKeys(entries: Iterable<[string, string]>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [id, k] of entries) if (k) m.set(id, k);
  return m;
}

const PAGE_ORDER = "o";
const EL_ORDER = "z";
const TRAY_ORDER = "_o";

export function yElements(page: Y.Map<unknown>): Y.Map<Y.Map<unknown>> | undefined {
  const els = page.get("elements");
  return els instanceof Y.Map ? (els as Y.Map<Y.Map<unknown>>) : undefined;
}

export function elementToJson(id: string, el: Y.Map<unknown>): PageElement {
  const out: Obj = { id };
  for (const [k, v] of el.entries()) {
    if (k === EL_ORDER) continue;
    out[k] = v instanceof Y.Text ? v.toString() : v;
  }
  return out as unknown as PageElement;
}

/** 페이지 안 요소 id 를 쌓임 순서대로 */
export function elementOrder(page: Y.Map<unknown>): string[] {
  const els = yElements(page);
  if (!els) return [];
  return [...els.entries()].map(([id, el]) => ({ id, k: String(el.get(EL_ORDER) ?? "") })).sort((a, b) => byKey(a.k, a.id, b.k, b.id)).map((x) => x.id);
}

export function pageToJson(id: string, page: Y.Map<unknown>): Page {
  const out: Obj = { id };
  for (const [k, v] of page.entries()) {
    if (k === PAGE_ORDER || k === "elements") continue;
    out[k] = v;
  }
  const els = yElements(page);
  out.elements = elementOrder(page).map((eid) => elementToJson(eid, els!.get(eid)!));
  return out as unknown as Page;
}

export function pageOrder(d: Y.Doc): string[] {
  return [...yPages(d).entries()].map(([id, p]) => ({ id, k: String(p.get(PAGE_ORDER) ?? "") })).sort((a, b) => byKey(a.k, a.id, b.k, b.id)).map((x) => x.id);
}

export function trayToJson(d: Y.Doc): TrayItem[] {
  return [...yTray(d).entries()]
    .map(([id, v]) => ({ id, k: String(v[TRAY_ORDER] ?? ""), v }))
    .sort((a, b) => byKey(a.k, a.id, b.k, b.id))
    .map(({ id, v }) => {
      const { [TRAY_ORDER]: _o, ...item } = v;
      return { ...item, id } as unknown as TrayItem;
    });
}

export function settingsToJson(d: Y.Doc): DocumentData["settings"] {
  return Object.fromEntries(ySettings(d).entries()) as unknown as DocumentData["settings"];
}

export function yToContent(d: Y.Doc): DocContent {
  const meta = yMeta(d);
  const pages = yPages(d);
  const query = meta.get("query");
  return {
    title: String(meta.get("title") ?? ""),
    ...(typeof query === "string" ? { query } : {}),
    settings: settingsToJson(d),
    pages: pageOrder(d).map((id) => pageToJson(id, pages.get(id)!)),
    tray: trayToJson(d),
  };
}

/**
 * 바뀐 부분만 다시 만드는 거울 — 편집기가 바뀌지 않은 페이지 객체를 그대로 쓰게 해서 썸네일 등이 다시 그려지지 않게 한다.
 * observeDeep 이벤트의 경로로 어떤 페이지 · 설정 · 보관함이 바뀌었는지 알아낸다.
 */
export class DocMirror {
  private pages = new Map<string, Page>();
  private settings: DocumentData["settings"] | null = null;
  private tray: TrayItem[] | null = null;
  private meta: { title: string; query?: string } | null = null;
  constructor(readonly doc: Y.Doc) {}

  /** 이벤트로 더럽혀진 부분 표시 */
  invalidate(root: "pages" | "settings" | "tray" | "meta", events: Y.YEvent<Y.AbstractType<unknown>>[]) {
    if (root === "settings") this.settings = null;
    else if (root === "tray") this.tray = null;
    else if (root === "meta") this.meta = null;
    else
      for (const e of events) {
        if (e.path.length) this.pages.delete(String(e.path[0]));
        else for (const k of e.keys.keys()) this.pages.delete(k);
      }
  }

  invalidateAll() {
    this.pages.clear();
    this.settings = this.tray = this.meta = null;
  }

  build(): DocContent {
    const d = this.doc;
    const yp = yPages(d);
    const order = pageOrder(d);
    const live = new Set(order);
    for (const id of this.pages.keys()) if (!live.has(id)) this.pages.delete(id);
    const pages = order.map((id) => {
      let p = this.pages.get(id);
      if (!p) {
        p = pageToJson(id, yp.get(id)!);
        this.pages.set(id, p);
      }
      return p;
    });
    this.settings ??= settingsToJson(d);
    this.tray ??= trayToJson(d);
    if (!this.meta) {
      const q = yMeta(d).get("query");
      this.meta = { title: String(yMeta(d).get("title") ?? ""), ...(typeof q === "string" ? { query: q } : {}) };
    }
    return { ...this.meta, settings: this.settings, pages, tray: this.tray };
  }
}

// ─── JSON 차이 → Y ────────────────────────────────────────────

/** 값 쓰기 — undefined 는 키 삭제 */
function put(map: Y.Map<unknown>, k: string, v: unknown) {
  if (v === undefined) {
    if (map.has(k)) map.delete(k);
  } else if (!same(map.get(k), v)) map.set(k, v);
}

/**
 * 글 바꾸기 — prev → next 의 바뀐 구간(앞뒤 같은 부분 제외)만 지우고 넣는다.
 * Y 의 현재 글이 prev 와 다르면(그 사이 다른 사람이 고침) 다른 사람이 고친 구간 위치에 맞춰 옮긴다.
 */
export function applyTextDiff(yt: Y.Text, prev: string, next: string) {
  if (prev === next) return;
  let { start, del, ins } = rebaseTextEdit(prev, next, yt.toString());
  start = Math.max(0, Math.min(start, yt.length));
  del = Math.max(0, Math.min(del, yt.length - start));
  if (del) yt.delete(start, del);
  if (ins) yt.insert(start, ins);
}

/** prev → next 로 고친 내용을, 그사이 다른 사람이 prev → cur 로 바꾼 글 위에 옮긴다 */
export function rebaseTextEdit(prev: string, next: string, cur: string): { start: number; del: number; ins: string } {
  const edit = textEdit(prev, next);
  let start = edit.start;
  let del = edit.del;
  if (cur !== prev) {
    const remote = textEdit(prev, cur);
    if (remote.start + remote.del <= start) start += remote.ins.length - remote.del;
    else if (remote.start >= start + del) {
      // 다른 사람이 고친 곳이 내 수정 뒤 — 그대로
    } else {
      // 같은 구간을 둘 다 고쳤다 — 겹치는 구간을 내 글로
      const s = Math.min(start, remote.start);
      const e = Math.max(start + del, remote.start + remote.del) + (remote.ins.length - remote.del);
      start = s;
      del = Math.max(0, Math.min(cur.length, e) - s);
    }
  }
  return { start, del, ins: edit.ins };
}

/** 3방향 합치기 — base 에서 내가 mine 으로, 다른 사람이 theirs 로 고쳤을 때 둘 다 살린 글 */
export function mergeText(base: string, mine: string, theirs: string): string {
  if (base === mine) return theirs;
  const r = rebaseTextEdit(base, mine, theirs);
  const start = Math.max(0, Math.min(r.start, theirs.length));
  const del = Math.max(0, Math.min(r.del, theirs.length - start));
  return theirs.slice(0, start) + r.ins + theirs.slice(start + del);
}

export function textEdit(a: string, b: string): { start: number; del: number; ins: string } {
  let s = 0;
  const max = Math.min(a.length, b.length);
  while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
  let e = 0;
  while (e < max - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
  // 서로게이트 쌍(이모지 등)을 반으로 자르지 않게
  if (s > 0 && isHighSurrogate(a.charCodeAt(s - 1))) s--;
  if (e > 0 && isLowSurrogate(a.charCodeAt(a.length - e))) e--;
  return { start: s, del: a.length - s - e, ins: b.slice(s, b.length - e) };
}
const isHighSurrogate = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLowSurrogate = (c: number) => c >= 0xdc00 && c <= 0xdfff;

function newElement(el: PageElement, z: string): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(el)) {
    if (k === "id" || v === undefined) continue;
    if (k === "text" && el.type === "text") m.set("text", new Y.Text(String(v)));
    else m.set(k, v);
  }
  m.set(EL_ORDER, z);
  return m;
}

function patchElement(y: Y.Map<unknown>, prev: PageElement | undefined, next: PageElement) {
  const p = (prev ?? {}) as unknown as Obj;
  const n = next as unknown as Obj;
  for (const k of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (k === "id" || same(p[k], n[k])) continue;
    if (k === "text" && next.type === "text") {
      const cur = y.get("text");
      if (cur instanceof Y.Text) applyTextDiff(cur, String(p.text ?? cur.toString()), String(n.text ?? ""));
      else y.set("text", new Y.Text(String(n.text ?? "")));
    } else put(y, k, n[k]);
  }
}

function newPage(page: Page, o: string): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(page)) {
    if (k === "id" || k === "elements" || v === undefined) continue;
    m.set(k, v);
  }
  m.set(PAGE_ORDER, o);
  const els = new Y.Map<Y.Map<unknown>>();
  m.set("elements", els);
  const keys = orderKeys(
    page.elements.map((e) => e.id),
    new Map(),
  );
  for (const el of page.elements) els.set(el.id, newElement(el, keys.get(el.id)!));
  return m;
}

function patchPage(y: Y.Map<unknown>, prev: Page | undefined, next: Page) {
  const p = (prev ?? { elements: [] }) as unknown as Obj;
  const n = next as unknown as Obj;
  for (const k of new Set([...Object.keys(p), ...Object.keys(n)])) {
    if (k === "id" || k === "elements" || same(p[k], n[k])) continue;
    put(y, k, n[k]);
  }
  let els = yElements(y);
  if (!els) {
    els = new Y.Map<Y.Map<unknown>>();
    y.set("elements", els);
  }
  const prevEls = new Map((prev?.elements ?? []).map((e) => [e.id, e]));
  const nextIds = next.elements.map((e) => e.id);
  const nextSet = new Set(nextIds);
  for (const id of prevEls.keys()) if (!nextSet.has(id) && els.has(id)) els.delete(id);
  const orderChanged = !same(
    (prev?.elements ?? []).map((e) => e.id),
    nextIds,
  );
  const added = nextIds.filter((id) => !els!.has(id));
  const keys = orderChanged || added.length ? orderKeys(nextIds, existingKeys([...els.entries()].map(([id, m]) => [id, String(m.get(EL_ORDER) ?? "")]))) : null;
  for (const el of next.elements) {
    const cur = els.get(el.id);
    if (!cur) els.set(el.id, newElement(el, keys!.get(el.id)!));
    else {
      const before = prevEls.get(el.id);
      if (before !== el && !(before && same(before, el))) patchElement(cur, before ?? elementToJson(el.id, cur), el);
      if (keys) put(cur, EL_ORDER, keys.get(el.id));
    }
  }
}

/**
 * prev → next 로 바뀐 것만 Y 에 적는다. prev 는 next 가 출발한 상태(편집기의 직전 문서, 또는 예전 저장 버전).
 * Y 가 그 사이 다른 사람 변경으로 달라졌어도 내가 바꾼 것만 얹히므로 3-way 병합과 같은 결과가 된다.
 * 트랜잭션(origin)은 부르는 쪽에서 연다.
 */
export function applyDocDiff(d: Y.Doc, prev: DocContent, next: DocContent) {
  const meta = yMeta(d);
  if (prev.title !== next.title) put(meta, "title", next.title);
  if (prev.query !== next.query) put(meta, "query", next.query);

  const ps = (prev.settings ?? {}) as unknown as Obj;
  const ns = (next.settings ?? {}) as unknown as Obj;
  const settings = ySettings(d);
  if (ps !== ns) for (const k of new Set([...Object.keys(ps), ...Object.keys(ns)])) if (!same(ps[k], ns[k])) put(settings, k, ns[k]);

  const pages = yPages(d);
  if (prev.pages !== next.pages) {
    const prevPages = new Map(prev.pages.map((p) => [p.id, p]));
    const nextIds = next.pages.map((p) => p.id);
    const nextSet = new Set(nextIds);
    for (const id of prevPages.keys()) if (!nextSet.has(id) && pages.has(id)) pages.delete(id);
    const orderChanged = !same(
      prev.pages.map((p) => p.id),
      nextIds,
    );
    const added = nextIds.filter((id) => !pages.has(id));
    const keys = orderChanged || added.length ? orderKeys(nextIds, existingKeys([...pages.entries()].map(([id, m]) => [id, String(m.get(PAGE_ORDER) ?? "")]))) : null;
    for (const page of next.pages) {
      const cur = pages.get(page.id);
      if (!cur) pages.set(page.id, newPage(page, keys!.get(page.id)!));
      else {
        const before = prevPages.get(page.id);
        // 바뀌지 않은 페이지는 한 번에 건너뛴다 (편집기는 문서 전체를 복사해서 고치므로 객체는 늘 새것)
        if (before !== page && !(before && same(before, page))) patchPage(cur, before ?? pageToJson(page.id, cur), page);
        if (keys) put(cur, PAGE_ORDER, keys.get(page.id));
      }
    }
  }

  const pt = prev.tray ?? [];
  const nt = next.tray ?? [];
  if (pt !== nt && !same(pt, nt)) {
    const tray = yTray(d);
    const nextIds = nt.map((t) => t.id);
    const nextSet = new Set(nextIds);
    for (const t of pt) if (!nextSet.has(t.id) && tray.has(t.id)) tray.delete(t.id);
    const keys = orderKeys(nextIds, existingKeys([...tray.entries()].map(([id, v]) => [id, String(v[TRAY_ORDER] ?? "")])));
    const prevById = new Map(pt.map((t) => [t.id, t]));
    for (const t of nt) {
      const cur = tray.get(t.id);
      const { id: _id, ...item } = t;
      const value = { ...item, [TRAY_ORDER]: keys.get(t.id)! };
      if (!cur || !same(prevById.get(t.id), t) || cur[TRAY_ORDER] !== value[TRAY_ORDER]) tray.set(t.id, value);
    }
  }
}

/** 빈 Y.Doc 에 문서 내용을 처음 넣는다 */
export function contentToY(d: Y.Doc, content: DocContent, origin: unknown = "load") {
  d.transact(() => applyDocDiff(d, EMPTY_CONTENT, content), origin);
}

/** 루트 타입 4개 — 실행 취소 · 관찰 대상 */
export const yRoots = (d: Y.Doc) => [yMeta(d), ySettings(d), yPages(d), yTray(d)] as Y.AbstractType<unknown>[];

// ─── 이벤트 경로 해석 (활동 기록 · 담당 페이지 확인) ───────────────

export interface ChangeRef {
  /** 페이지 id (문서 설정 · 보관함 · 제목이면 없음) */
  pageId?: string;
  /** 요소 id */
  elementId?: string;
  /** 바뀐 속성 이름 — 페이지/요소 추가·삭제면 없음 */
  key?: string;
  kind: "meta" | "settings" | "tray" | "page" | "element";
}

/**
 * 한 트랜잭션에서 바뀐 곳 — 루트에서부터의 경로로 정리한다.
 * (트랜잭션의 changed: 바뀐 타입 → 바뀐 키 집합, Y.Text 는 null 키)
 */
export function changesOf(d: Y.Doc, tr: Y.Transaction): ChangeRef[] {
  const out: ChangeRef[] = [];
  const pagesRoot = yPages(d) as unknown as Y.AbstractType<unknown>;
  const metaRoot = yMeta(d) as unknown as Y.AbstractType<unknown>;
  const settingsRoot = ySettings(d) as unknown as Y.AbstractType<unknown>;
  const trayRoot = yTray(d) as unknown as Y.AbstractType<unknown>;
  for (const [changedType, keys] of tr.changed) {
    const type = changedType as unknown as Y.AbstractType<unknown>;
    if (type === metaRoot) {
      for (const k of keys) if (k) out.push({ kind: "meta", key: k });
      continue;
    }
    if (type === settingsRoot) {
      for (const k of keys) if (k) out.push({ kind: "settings", key: k });
      continue;
    }
    if (type === trayRoot) {
      out.push({ kind: "tray" });
      continue;
    }
    if (type === pagesRoot) {
      for (const k of keys) if (k) out.push({ kind: "page", pageId: k });
      continue;
    }
    // 페이지 맵 / 요소 맵 / 요소 / 글 — 부모를 따라 올라가 페이지 · 요소 id 를 찾는다
    const path: string[] = [];
    let t: Y.AbstractType<unknown> | null = type;
    while (t && t !== pagesRoot) {
      const item: Y.Item | null = t._item;
      if (!item || item.parentSub == null) break;
      path.unshift(item.parentSub);
      t = item.parent as Y.AbstractType<unknown> | null;
    }
    if (t !== pagesRoot || !path.length) continue;
    // path: [pageId] · [pageId, "elements"] · [pageId, "elements", elId] · [pageId, "elements", elId, "text"]
    const [pageId, , elementId, sub] = path;
    if (path.length === 1) for (const k of keys) out.push({ kind: "page", pageId, key: k ?? undefined });
    else if (path.length === 2) for (const k of keys) out.push({ kind: "element", pageId, elementId: k ?? undefined });
    else if (path.length === 3) for (const k of keys) out.push({ kind: "element", pageId, elementId, key: k ?? undefined });
    else if (sub === "text") out.push({ kind: "element", pageId, elementId, key: "text" });
  }
  return out;
}
