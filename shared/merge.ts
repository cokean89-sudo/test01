// 문서 3-way 병합 — 여러 사람이 동시에 편집해도 서로 다른 페이지·요소의 변경은 모두 살린다.
// base: 두 사람이 공통으로 출발한 버전, mine: 내 변경, theirs: 서버에 먼저 저장된 다른 사람 변경.
// 같은 요소의 같은 속성을 둘 다 바꾼 경우에만 충돌이며, 이때는 mine(나중에 저장한 쪽)이 이긴다.

import type { DocumentData, Page, PageElement } from "./types";

type Obj = Record<string, unknown>;

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export interface MergeResult<T> {
  value: T;
  conflicts: string[];
}

/** 객체의 최상위 키 단위 3-way 병합 */
function mergeKeys<T extends Obj>(base: T | undefined, mine: T, theirs: T, path: string, conflicts: string[]): T {
  const out: Obj = {};
  const keys = new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base ?? {})]);
  for (const k of keys) {
    const b = base?.[k];
    const m = mine[k];
    const t = theirs[k];
    let v: unknown;
    if (same(m, b)) v = t;
    else if (same(t, b) || same(m, t)) v = m;
    else {
      v = m;
      conflicts.push(`${path}.${k}`);
    }
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** id 를 가진 항목 목록의 3-way 병합 (순서 포함) */
function mergeList<T extends { id: string }>(
  base: T[],
  mine: T[],
  theirs: T[],
  mergeItem: (b: T | undefined, m: T, t: T, conflicts: string[]) => T,
  path: string,
  conflicts: string[],
): T[] {
  const B = new Map(base.map((x) => [x.id, x]));
  const M = new Map(mine.map((x) => [x.id, x]));
  const T = new Map(theirs.map((x) => [x.id, x]));
  const result = new Map<string, T>();
  for (const id of new Set([...B.keys(), ...M.keys(), ...T.keys()])) {
    const b = B.get(id);
    const m = M.get(id);
    const t = T.get(id);
    let v: T | undefined;
    if (same(m, b)) v = t;
    else if (same(t, b) || same(m, t)) v = m;
    else if (!m) v = t; // 내가 지웠지만 상대가 고쳤다 → 고친 내용을 살린다
    else if (!t) v = m; // 상대가 지웠지만 내가 고쳤다 → 내 내용을 살린다
    else v = mergeItem(b, m, t, conflicts);
    if (v) result.set(id, v);
  }

  const bo = base.map((x) => x.id);
  const mo = mine.map((x) => x.id);
  const to = theirs.map((x) => x.id);
  let order: string[];
  if (same(mo, bo)) order = to;
  else if (same(to, bo)) order = mo;
  else {
    // 내 순서를 기준으로, 상대가 새로 추가한 항목은 상대 쪽 앞 항목 뒤에 끼운다
    order = [...mo];
    to.forEach((id, i) => {
      if (order.includes(id) || B.has(id)) return;
      const prev = to.slice(0, i).reverse().find((p) => order.includes(p));
      order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
    });
    if (conflicts && !same(mo, to)) conflicts.push(`${path}.order`);
  }
  const out = order.filter((id) => result.has(id)).map((id) => result.get(id)!);
  for (const [id, v] of result) if (!order.includes(id)) out.push(v);
  return out;
}

function mergeElement(b: PageElement | undefined, m: PageElement, t: PageElement, conflicts: string[]): PageElement {
  return mergeKeys(b as unknown as Obj, m as unknown as Obj, t as unknown as Obj, `element:${m.id}`, conflicts) as unknown as PageElement;
}

function mergePage(b: Page | undefined, m: Page, t: Page, conflicts: string[]): Page {
  const { elements: be = [], ...bRest } = b ?? ({} as Page);
  const { elements: me, ...mRest } = m;
  const { elements: te, ...tRest } = t;
  const props = mergeKeys(b ? (bRest as Obj) : undefined, mRest as Obj, tRest as Obj, `page:${m.id}`, conflicts);
  const elements = mergeList(be, me, te, mergeElement, `page:${m.id}.elements`, conflicts);
  return { ...(props as unknown as Page), elements };
}

export function mergeDocuments(base: DocumentData, mine: DocumentData, theirs: DocumentData): MergeResult<DocumentData> {
  const conflicts: string[] = [];
  const { pages: bp, settings: bs, tray: bt, ...bRest } = base;
  const { pages: mp, settings: ms, tray: mt, ...mRest } = mine;
  const { pages: tp, settings: ts, tray: tt, ...tRest } = theirs;
  const top = mergeKeys(bRest as Obj, mRest as Obj, tRest as Obj, "doc", conflicts);
  const settings = mergeKeys(bs as unknown as Obj, ms as unknown as Obj, ts as unknown as Obj, "settings", conflicts);
  const pages = mergeList(bp, mp, tp, mergePage, "pages", conflicts);
  // 임시 보관함도 항목(id) 단위로 합친다 — 두 사람이 동시에 넣고 빼도 서로의 항목이 사라지지 않는다
  const tray = mergeList(bt ?? [], mt ?? [], tt ?? [], (_b, m) => m, "tray", conflicts);
  const value = { ...(top as unknown as DocumentData), settings: settings as unknown as DocumentData["settings"], pages };
  if (tray.length || mt || tt) value.tray = tray;
  return { value, conflicts };
}
