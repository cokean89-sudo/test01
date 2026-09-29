// 이미지 끌어놓기 — 캔버스 · 왼쪽 페이지 썸네일 · 임시 보관함 사이를 오간다.
//
//  · 캔버스 밖으로 끌면 커서를 따라가는 미리보기로 바뀐다
//  · 썸네일 위에 놓으면 그 페이지로 이동, 0.5초 머물면 그 페이지로 전환되어 원하는 자리에 놓을 수 있다
//  · 다른 이미지 위에서는 '교체 / 서로 바꾸기' 두 영역, 빈 곳에 놓으면 추가 + 자동 레이아웃 재정렬
//  · 같은 페이지의 빈 곳으로 옮기는 것은 기존대로 자유 배치(캔버스가 처리)
// 결과는 한 번의 실행 취소 단위로 남고, 끌다가 취소(캔버스 밖에 놓기 · Esc)하면 기록이 남지 않는다.

import { create } from "zustand";
import type { ImageElement } from "../../../shared/types";
import type { ImageSource } from "../../layout/imageMoves";
import { useEditor } from "../../store/editor";
import { moveImages, moveToTray, replaceWith, swapWith } from "./actions";

export type DropZone = "replace" | "swap";

export type DragHover =
  | { kind: "thumb"; pageId: string; switching: boolean }
  | { kind: "tray" }
  | { kind: "image"; pageId: string; elId: string; zone: DropZone; zones: DropZone[]; split: "h" | "v" }
  | { kind: "empty"; pageId: string; point: { x: number; y: number } }
  | { kind: "free" }
  | null;

interface DragVisual {
  active: boolean;
  preview: { src: string; count: number } | null;
  x: number;
  y: number;
  hover: DragHover;
}

export const useImageDrag = create<DragVisual>(() => ({ active: false, preview: null, x: 0, y: 0, hover: null }));

/** 썸네일 위에 머물면 그 페이지로 넘어가는 시간 */
export const HOVER_SWITCH_MS = 500;

// ─── 캔버스 위치 (캔버스가 등록) ────────────────────────────────

interface CanvasProbe {
  wrap: HTMLElement;
  toPt: (clientX: number, clientY: number) => { x: number; y: number };
}
let probe: CanvasProbe | null = null;
export function registerCanvasProbe(p: CanvasProbe | null) {
  probe = p;
}

/** 같은 페이지 안에서 옮길 때의 기존 동작 (캔버스가 제공) */
export interface SamePageDelegate {
  move: (ev: PointerEvent) => void;
  revert: () => void;
  commit: () => void;
}

type Loc = { kind: "thumb"; pageId: string } | { kind: "tray" } | { kind: "canvas"; pt: { x: number; y: number } } | { kind: "none" };

function locate(ev: { clientX: number; clientY: number }): Loc {
  const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
  const thumb = el?.closest<HTMLElement>("[data-page-drop]");
  if (thumb?.dataset.pageDrop) return { kind: "thumb", pageId: thumb.dataset.pageDrop };
  if (el?.closest("[data-tray-drop]")) return { kind: "tray" };
  if (probe && el && probe.wrap.contains(el)) return { kind: "canvas", pt: probe.toPt(ev.clientX, ev.clientY) };
  return { kind: "none" };
}

/** 커서 아래의 이미지 (위에 그려진 것 우선) */
function imageAt(pageId: string, pt: { x: number; y: number }, exclude: string[]): ImageElement | undefined {
  const page = useEditor.getState().doc?.pages.find((p) => p.id === pageId);
  if (!page) return undefined;
  for (let i = page.elements.length - 1; i >= 0; i--) {
    const e = page.elements[i];
    if (e.type !== "image" || e.locked || exclude.includes(e.id)) continue;
    if (pt.x >= e.x && pt.x <= e.x + e.w && pt.y >= e.y && pt.y <= e.y + e.h) return e;
  }
  return undefined;
}

export interface ImageDrag {
  move: (ev: PointerEvent) => void;
  drop: (ev: PointerEvent) => void;
  cancel: () => void;
}

/** 끌기 시작 — source 는 페이지의 이미지들 또는 보관함 항목들 */
export function createImageDrag(source: ImageSource, preview: { src: string; count: number }, same?: SamePageDelegate): ImageDrag {
  let hover: DragHover = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerPage: string | null = null;
  let reverted = true;
  let done = false;
  let listening = false;
  // 끄는 중 Esc = 취소 (편집기의 Esc 단축키보다 먼저 받는다)
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cancel();
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    timerPage = null;
  };
  const revert = () => {
    if (!reverted) same?.revert();
    reverted = true;
  };

  function update(ev: { clientX: number; clientY: number }) {
    if (!listening) {
      window.addEventListener("keydown", onKey, true);
      listening = true;
    }
    const loc = locate(ev);
    const cur = useEditor.getState().pageId;
    if (loc.kind !== "thumb") clearTimer();
    const samePage = source.kind === "page" && source.pageId === cur;

    if (loc.kind === "canvas" && cur) {
      const t = imageAt(cur, loc.pt, samePage ? source.ids : []);
      if (t && source.ids.length === 1) {
        revert();
        const zones: DropZone[] = t.src && source.kind === "page" ? ["replace", "swap"] : ["replace"];
        const split = t.w >= t.h ? "h" : "v";
        const first = split === "h" ? loc.pt.x < t.x + t.w / 2 : loc.pt.y < t.y + t.h / 2;
        hover = { kind: "image", pageId: cur, elId: t.id, zone: zones.length === 1 || first ? "replace" : "swap", zones, split };
      } else if (samePage && same) {
        same.move(ev as PointerEvent);
        reverted = false;
        hover = { kind: "free" };
      } else {
        revert();
        hover = samePage ? null : { kind: "empty", pageId: cur, point: loc.pt };
      }
    } else if (loc.kind === "thumb") {
      revert();
      const isSource = source.kind === "page" && loc.pageId === source.pageId && loc.pageId === cur;
      hover = isSource ? null : { kind: "thumb", pageId: loc.pageId, switching: loc.pageId !== cur };
      if (loc.pageId !== cur && timerPage !== loc.pageId) {
        clearTimer();
        timerPage = loc.pageId;
        const target = loc.pageId;
        timer = setTimeout(() => {
          timer = null;
          timerPage = null;
          useEditor.getState().setPage(target);
          if (hover?.kind === "thumb" && hover.pageId === target) hover = { ...hover, switching: false };
          useImageDrag.setState({ hover });
        }, HOVER_SWITCH_MS);
      }
    } else if (loc.kind === "tray") {
      revert();
      hover = source.kind === "page" ? { kind: "tray" } : null;
    } else {
      revert();
      hover = null;
    }
    useImageDrag.setState({ active: true, preview: hover?.kind === "free" ? null : preview, x: ev.clientX, y: ev.clientY, hover });
  }

  function finish() {
    done = true;
    clearTimer();
    window.removeEventListener("keydown", onKey, true);
    useImageDrag.setState({ active: false, preview: null, hover: null });
  }

  function cancel() {
    if (done) return;
    revert();
    finish();
    useEditor.getState().cancelTx();
  }

  return {
    move(ev) {
      if (!done) update(ev);
    },
    drop(ev) {
      if (done) return;
      update(ev);
      const h = hover;
      finish();
      if (h?.kind === "free") {
        same?.commit();
        return;
      }
      // 같은 페이지에서 끌던 임시 이동은 없던 일로 하고, 결과만 한 번의 기록으로 남긴다
      useEditor.getState().cancelTx();
      if (!h) return;
      if (h.kind === "image") {
        if (h.zone === "swap" && source.kind === "page") swapWith({ pageId: source.pageId, elId: source.ids[0] }, { pageId: h.pageId, elId: h.elId });
        else replaceWith(source, { pageId: h.pageId, elId: h.elId });
      } else if (h.kind === "empty") moveImages(source, h.pageId, h.point);
      else if (h.kind === "thumb") moveImages(source, h.pageId);
      else if (h.kind === "tray" && source.kind === "page") moveToTray(source.pageId, source.ids);
    },
    cancel,
  };
}
