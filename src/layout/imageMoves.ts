// 페이지 간 이미지 이동 · 교체 · 서로 바꾸기 · 임시 보관함 — 문서 draft 를 직접 바꾸는 순수 함수.
// 편집기는 이 함수들을 useEditor.update(한 번의 실행 취소 단위) 안에서 부른다.
//
// 공동 편집 병합: 다른 페이지로 옮기는 이미지는 새 id 로 만든다. 누군가 동시에 원래 이미지를 고쳐도
// 병합 결과에 같은 id 가 두 페이지에 생기지 않고, 고친 내용도 사라지지 않는다.

import type { DocSettings, DocumentData, ImageElement, Page, PageElement, TextElement, TrayItem } from "../../shared/types";
import { uid } from "../lib/id";
import { relayoutPage } from "./templates";

export type ImageSource = { kind: "page"; pageId: string; ids: string[] } | { kind: "tray"; ids: string[] };

/** 이미지 내용(무엇을 보여주는지) — 위치 · 크기 · 자동 레이아웃 여부와 별개 */
const CONTENT_KEYS = ["src", "refId", "natW", "natH", "caption", "sourceUrl", "focusX", "focusY"] as const;
type ImageContent = Pick<ImageElement, (typeof CONTENT_KEYS)[number]> & { fit?: ImageElement["fit"] };

function contentOf(el: ImageElement | TrayItem): ImageContent {
  const c: ImageContent = { src: el.src, fit: el.fit };
  for (const k of CONTENT_KEYS) if (k in el && (el as ImageElement)[k] !== undefined) (c as Record<string, unknown>)[k] = (el as ImageElement)[k];
  return c;
}

function setContent(el: ImageElement, c: ImageContent) {
  for (const k of CONTENT_KEYS) delete (el as Partial<ImageElement>)[k];
  Object.assign(el, c);
  el.src = c.src ?? "";
  if (c.fit) el.fit = c.fit;
}

const pageOf = (doc: DocumentData, id: string) => doc.pages.find((p) => p.id === id);
const isImage = (e: PageElement | undefined): e is ImageElement => e?.type === "image";
const managedImages = (p: Page) => p.elements.filter((e): e is ImageElement => e.type === "image" && !!e.managed && !e.logo);

function pageLabel(p: Page): string {
  const title = p.elements.find((e): e is TextElement => e.type === "text" && !e.deco && (e.slot === "title" || e.role === "title"))?.text;
  return (p.group || title || "").replace(/\s+/g, " ").slice(0, 40);
}

// ─── 보관함 ─────────────────────────────────────────────────

export function toTrayItem(el: ImageElement, from?: string): TrayItem {
  const c = contentOf(el);
  return { id: uid("tr"), ...c, src: c.src ?? "", fit: el.fit, from, addedAt: Date.now() };
}

/** 보관함 항목 → 새 이미지 요소 (자동 레이아웃에 넣으면 relayout 이 자리를 정한다) */
export function fromTrayItem(item: TrayItem, managed = true): ImageElement {
  const aspect = item.natW && item.natH ? item.natW / item.natH : 4 / 3;
  return {
    id: uid("i"),
    type: "image",
    ...contentOf(item),
    src: item.src,
    fit: item.fit ?? "cover",
    managed,
    captionPos: "none",
    x: 0,
    y: 0,
    w: 120,
    h: 120 / aspect,
  };
}

/** 이미지들을 보관함으로 — 회색 빈 자리(src 없음)는 버린다 */
export function pushToTray(doc: DocumentData, els: ImageElement[], from?: string) {
  const items = els.filter((e) => e.src).map((e) => toTrayItem(e, from));
  if (items.length) doc.tray = [...items, ...(doc.tray ?? [])].slice(0, 200);
}

export function removeFromTray(doc: DocumentData, ids: string[]): TrayItem[] {
  const taken = (doc.tray ?? []).filter((t) => ids.includes(t.id));
  doc.tray = (doc.tray ?? []).filter((t) => !ids.includes(t.id));
  return ids.map((id) => taken.find((t) => t.id === id)).filter((t): t is TrayItem => !!t);
}

// ─── 꺼내기 (원본에서 빼기) ──────────────────────────────────────

/** 원본(페이지 또는 보관함)에서 이미지를 빼고, 다른 곳에 넣을 새 요소들을 돌려준다 */
function takeSource(doc: DocumentData, src: ImageSource, settings: DocSettings): { els: ImageElement[]; wasManaged: boolean[] } {
  if (src.kind === "tray") {
    const items = removeFromTray(doc, src.ids);
    return { els: items.map((t) => fromTrayItem(t, true)), wasManaged: items.map(() => true) };
  }
  const page = pageOf(doc, src.pageId);
  if (!page) return { els: [], wasManaged: [] };
  const picked = src.ids.map((id) => page.elements.find((e) => e.id === id)).filter(isImage);
  const ids = new Set(picked.map((e) => e.id));
  page.elements = page.elements.filter((e) => !ids.has(e.id) && !(e.type === "text" && e.labelFor && ids.has(e.labelFor)));
  const idx = doc.pages.indexOf(page);
  if (picked.some((e) => e.managed || e.logo)) doc.pages[idx] = relayoutPage(page, settings);
  return {
    els: picked.map((e) => ({ ...structuredClone(e), id: uid("i"), logo: undefined })),
    wasManaged: picked.map((e) => !!e.managed || !!e.logo),
  };
}

// ─── 넣기 ───────────────────────────────────────────────────

/** 읽는 순서(위→아래, 왼→오른쪽)로 point 가 들어갈 자동 레이아웃 순번 */
function insertIndex(page: Page, point?: { x: number; y: number }): number {
  const managed = managedImages(page);
  if (!point) return managed.length;
  const rowTol = 12;
  const i = managed.findIndex((m) => {
    const cy = m.y + m.h / 2;
    const sameRow = Math.abs(point.y - cy) <= Math.max(rowTol, m.h / 2);
    return sameRow ? point.x < m.x + m.w / 2 : point.y < m.y;
  });
  return i < 0 ? managed.length : i;
}

/**
 * 페이지에 자동 레이아웃 이미지로 넣는다 — 회색 빈 자리가 있으면 그 자리부터 채우고,
 * 남는 것은 point 에 가까운 순서 자리에 끼운 뒤 다시 배치한다. 넣은 요소 id 를 돌려준다.
 */
export function insertManaged(doc: DocumentData, pageId: string, els: ImageElement[], settings: DocSettings, point?: { x: number; y: number }): string[] {
  const idx = doc.pages.findIndex((p) => p.id === pageId);
  if (idx < 0 || !els.length) return [];
  const page = doc.pages[idx];
  const placed: string[] = [];
  const empties = managedImages(page).filter((e) => !e.src);
  const rest: ImageElement[] = [];
  els.forEach((el, i) => {
    const slot = empties[i];
    if (slot) {
      setContent(slot, contentOf(el));
      placed.push(slot.id);
    } else rest.push({ ...el, managed: true, logo: undefined, rotation: 0 });
  });
  if (rest.length) {
    const order = managedImages(page);
    const at = insertIndex(page, point);
    const before = order[at];
    const pos = before ? page.elements.indexOf(before) : page.elements.length;
    page.elements.splice(pos, 0, ...rest);
    placed.push(...rest.map((e) => e.id));
  }
  doc.pages[idx] = relayoutPage(page, settings);
  return placed;
}

/** 다른 페이지(또는 보관함)의 이미지를 이 페이지로 옮긴다 */
export function moveImagesToPage(doc: DocumentData, src: ImageSource, toPageId: string, settings: DocSettings, point?: { x: number; y: number }): string[] {
  if (src.kind === "page" && src.pageId === toPageId) return [];
  const { els } = takeSource(doc, src, settings);
  return insertManaged(doc, toPageId, els, settings, point);
}

/** 교체 — 대상 이미지 자리에 새 이미지를 넣고, 원래 이미지는 보관함으로 */
export function replaceImage(doc: DocumentData, src: ImageSource, target: { pageId: string; elId: string }, settings: DocSettings): string | null {
  const tp = pageOf(doc, target.pageId);
  const t = tp?.elements.find((e) => e.id === target.elId);
  if (!tp || !isImage(t)) return null;
  if (src.kind === "page" && src.pageId === target.pageId && src.ids[0] === target.elId) return null;
  const old = structuredClone(t);
  const { els } = takeSource(doc, { ...src, ids: src.ids.slice(0, 1) } as ImageSource, settings);
  if (!els[0]) return null;
  // 원본을 빼면서 대상 페이지가 다시 배치됐을 수 있으니 새로 찾는다
  const page = pageOf(doc, target.pageId)!;
  const el = page.elements.find((e): e is ImageElement => e.id === target.elId && e.type === "image");
  if (!el) return null;
  setContent(el, contentOf(els[0]));
  pushToTray(doc, [old], pageLabel(page));
  const idx = doc.pages.indexOf(page);
  if (el.managed || el.logo) doc.pages[idx] = relayoutPage(page, settings);
  return el.id;
}

/** 서로 바꾸기 — 두 이미지의 내용을 맞바꾼다 (위치 · 크기 · 자동 레이아웃 여부는 그 자리 그대로) */
export function swapImages(doc: DocumentData, a: { pageId: string; elId: string }, b: { pageId: string; elId: string }, settings: DocSettings): boolean {
  const pa = pageOf(doc, a.pageId);
  const pb = pageOf(doc, b.pageId);
  const ea = pa?.elements.find((e) => e.id === a.elId);
  const eb = pb?.elements.find((e) => e.id === b.elId);
  if (!pa || !pb || !isImage(ea) || !isImage(eb) || ea === eb) return false;
  const ca = contentOf(ea);
  const cb = contentOf(eb);
  setContent(ea, cb);
  setContent(eb, ca);
  for (const p of new Set([pa, pb])) {
    const idx = doc.pages.indexOf(p);
    if (p.elements.some((e) => (e === ea || e === eb) && (e as ImageElement).managed)) doc.pages[idx] = relayoutPage(p, settings);
  }
  return true;
}

/** 보관함으로 보내기 — 페이지에서 빼고 자동 레이아웃을 다시 맞춘다 */
export function sendToTray(doc: DocumentData, pageId: string, ids: string[], settings: DocSettings) {
  const page = pageOf(doc, pageId);
  if (!page) return;
  const imgs = ids.map((id) => page.elements.find((e) => e.id === id)).filter(isImage);
  pushToTray(doc, imgs, pageLabel(page));
  takeSource(doc, { kind: "page", pageId, ids: imgs.map((e) => e.id) }, settings);
}

// ─── 클립보드 (⌘C · ⌘X · ⌘V) ──────────────────────────────────

export interface ClipboardData {
  pageId: string;
  cut: boolean;
  elements: PageElement[];
}

/**
 * 붙여넣기 — 같은 페이지에 복사해 붙이면 살짝 옆에 복제(자유 배치).
 * 다른 페이지이거나 잘라낸 것이면: 자동 레이아웃이던 이미지는 그 페이지 자동 레이아웃에 넣어 다시 배치하고,
 * 나머지 요소는 같은 위치에 둔다. 새로 만든 요소 id 를 돌려준다.
 */
export function pasteElements(doc: DocumentData, clip: ClipboardData, toPageId: string, settings: DocSettings): string[] {
  const idx = doc.pages.findIndex((p) => p.id === toPageId);
  if (idx < 0 || !clip.elements.length) return [];
  const duplicate = clip.pageId === toPageId && !clip.cut;
  const idMap = new Map<string, string>();
  const copies = clip.elements.map((e) => {
    const c = structuredClone(e) as PageElement;
    c.id = uid(e.type[0]);
    idMap.set(e.id, c.id);
    delete c.deco;
    delete c.slot;
    if (duplicate) {
      c.x += 10;
      c.y += 10;
    }
    return c;
  });
  for (const c of copies) if (c.type === "text" && c.labelFor) c.labelFor = idMap.get(c.labelFor);
  const toLayout = copies.filter((c): c is ImageElement => c.type === "image" && !duplicate && !!c.managed && !c.logo);
  const free = copies
    .filter((c) => !toLayout.includes(c as ImageElement))
    .map((c) => {
      // 로고 패널 · 라벨 연결은 원래 페이지 구성에 묶여 있으니 자유 요소로 붙인다
      if (c.type === "image") {
        c.managed = false;
        c.logo = undefined;
      }
      if (c.type === "text") delete c.labelFor;
      return c;
    });
  doc.pages[idx].elements.push(...free);
  const placed = toLayout.length ? insertManaged(doc, toPageId, toLayout, settings) : [];
  return [...free.map((c) => c.id), ...placed];
}
