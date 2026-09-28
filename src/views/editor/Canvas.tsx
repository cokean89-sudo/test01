import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { ImageElement, PageElement, Rect } from "../../../shared/types";
import { PageView, pageSize } from "../../components/PageView";
import { uid } from "../../lib/id";
import { useCurrentPage, useEditor, withPage } from "../../store/editor";
import { effectiveArea } from "../../layout/templates";
import { addElement, bbox, isFlowText, newText, patchElements, swapManaged } from "./actions";
import { snapLines, snapMove, snapValue } from "./snap";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function Canvas() {
  const doc = useEditor((s) => s.doc)!;
  const page = useCurrentPage();
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const editingId = useEditor((s) => s.editingId);
  const zoom = useEditor((s) => s.zoom);
  const { W, H } = pageSize(doc.settings);

  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 900, h: 700 });
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ src: string; rect: Rect } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(0.1, Math.min((box.w - 80) / W, (box.h - 80) / H));
  const scale = zoom === "fit" ? fit : zoom;
  useEffect(() => useEditor.getState().setFitScale(fit), [fit]);

  if (!page) return <div className="canvas-wrap" ref={wrapRef} />;
  const pageIndex = doc.pages.findIndex((p) => p.id === page.id);
  const px = (pt: number) => pt * scale;
  const rectPx = (r: Rect): CSSProperties => ({ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) });

  const toPt = (e: { clientX: number; clientY: number }) => {
    const r = pageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const listen = (onMove: (ev: PointerEvent) => void, onUp: (ev: PointerEvent) => void) => {
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      onUp(ev);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  // ─── element drag ─────────────────────────────────────────
  function onElementDown(e: React.PointerEvent, el: PageElement) {
    if (tool !== "select" || e.button !== 0 || !page) return;
    e.stopPropagation();
    const state = useEditor.getState();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      state.select(state.selection.includes(el.id) ? state.selection.filter((i) => i !== el.id) : [...state.selection, el.id]);
      return;
    }
    let sel = state.selection;
    if (!sel.includes(el.id)) {
      sel = [el.id];
      state.select(sel);
    }
    const movers = page.elements.filter((x) => sel.includes(x.id) && !x.locked);
    if (!movers.length) return;
    const start = toPt(e);
    const orig = new Map(movers.map((m) => [m.id, { x: m.x, y: m.y }]));
    const moverBox = bbox(movers);
    const lines = snapLines(page, doc.settings, new Set(sel));
    const swapSource = movers.length === 1 && movers[0].type === "image" && movers[0].managed && !movers[0].logo ? movers[0] : null;
    const swapTargets = swapSource ? page.elements.filter((x): x is ImageElement => x.type === "image" && !!x.managed && !x.logo && x.id !== swapSource.id) : [];
    let moved = false;
    let target: string | null = null;

    listen(
      (ev) => {
        const p = toPt(ev);
        let dx = p.x - start.x;
        let dy = p.y - start.y;
        if (!moved && Math.hypot(dx, dy) * scale < 3) return;
        if (!moved) useEditor.getState().begin();
        moved = true;
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const s = ev.altKey ? { dx, dy, gx: [], gy: [] } : snapMove(moverBox, dx, dy, lines, 6 / scale);
        setGuides({ x: s.gx, y: s.gy });
        const patches: Record<string, Partial<PageElement>> = {};
        for (const m of movers) patches[m.id] = { x: orig.get(m.id)!.x + s.dx, y: orig.get(m.id)!.y + s.dy };
        useEditor.getState().patchTransient(page.id, patches);
        if (swapSource) {
          target = swapTargets.find((t) => p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h)?.id ?? null;
          setDropTarget(target);
          setGhost({ src: swapSource.src, rect: { ...swapSource, x: orig.get(swapSource.id)!.x + s.dx, y: orig.get(swapSource.id)!.y + s.dy } });
        }
      },
      () => {
        setGuides({ x: [], y: [] });
        setDropTarget(null);
        setGhost(null);
        if (!moved) return;
        const ed = useEditor.getState();
        if (swapSource && target) {
          ed.patchTransient(page.id, { [swapSource.id]: orig.get(swapSource.id)! });
          swapManaged(page.id, swapSource.id, target);
        } else {
          // 직접 옮긴 이미지는 자동 레이아웃에서, 본문 글은 글 배치에서 분리
          ed.update((d) =>
            withPage(d, page.id, (pg) => {
              for (const el of pg.elements) {
                if (!orig.has(el.id)) continue;
                if (el.type === "image" && (el.managed || el.logo)) {
                  el.managed = false;
                  el.logo = undefined;
                }
                if (pg.flow && isFlowText(el)) pg.flow.mode = "fixed";
              }
            }),
          );
        }
        ed.end();
      },
    );
  }

  // ─── resize ───────────────────────────────────────────────
  function onHandleDown(e: React.PointerEvent, el: PageElement, handle: Handle) {
    if (!page) return;
    e.stopPropagation();
    const start = toPt(e);
    const o = { x: el.x, y: el.y, w: el.w, h: el.h };
    const ratio = o.w / Math.max(o.h, 0.01);
    const lines = snapLines(page, doc.settings, new Set([el.id]));
    const keepRatio = el.type === "image";
    let moved = false;
    listen(
      (ev) => {
        const p = toPt(ev);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        if (!moved) useEditor.getState().begin();
        moved = true;
        let { x, y, w, h } = o;
        const gx: number[] = [];
        const gy: number[] = [];
        const th = ev.altKey ? 0 : 6 / scale;
        if (handle.includes("e")) {
          const s = snapValue(o.x + o.w + dx, lines.xs, th);
          w = s.v - o.x;
          if (s.guide !== undefined) gx.push(s.guide);
        }
        if (handle.includes("w")) {
          const s = snapValue(o.x + dx, lines.xs, th);
          x = s.v;
          w = o.x + o.w - x;
          if (s.guide !== undefined) gx.push(s.guide);
        }
        if (handle.includes("s")) {
          const s = snapValue(o.y + o.h + dy, lines.ys, th);
          h = s.v - o.y;
          if (s.guide !== undefined) gy.push(s.guide);
        }
        if (handle.startsWith("n")) {
          const s = snapValue(o.y + dy, lines.ys, th);
          y = s.v;
          h = o.y + o.h - y;
          if (s.guide !== undefined) gy.push(s.guide);
        }
        const corner = handle.length === 2;
        if (corner && (ev.shiftKey !== keepRatio)) {
          // 비율 유지 (이미지는 기본, Shift 로 해제 / 나머지는 Shift 로 유지)
          if (Math.abs(w - o.w) / o.w > Math.abs(h - o.h) / o.h) h = w / ratio;
          else w = h * ratio;
          if (handle.includes("w")) x = o.x + o.w - w;
          if (handle.startsWith("n")) y = o.y + o.h - h;
        }
        if (w < 4) {
          if (handle.includes("w")) x = o.x + o.w - 4;
          w = 4;
        }
        if (h < 2) {
          if (handle.startsWith("n")) y = o.y + o.h - 2;
          h = 2;
        }
        setGuides({ x: gx, y: gy });
        useEditor.getState().patchTransient(page.id, { [el.id]: { x, y, w, h } });
      },
      () => {
        setGuides({ x: [], y: [] });
        if (!moved) return;
        const ed = useEditor.getState();
        if ((el.type === "image" && (el.managed || el.logo)) || (page.flow && isFlowText(el))) {
          ed.update((d) =>
            withPage(d, page.id, (pg) => {
              const t = pg.elements.find((x) => x.id === el.id);
              if (t?.type === "image") {
                t.managed = false;
                t.logo = undefined;
              }
              if (t && pg.flow && isFlowText(t)) pg.flow.mode = "fixed";
            }),
          );
        }
        ed.end();
      },
    );
  }

  // ─── background: marquee / create ─────────────────────────
  function onBackgroundDown(e: React.PointerEvent) {
    if (e.button !== 0 || !page || !pageRef.current) return;
    const ed = useEditor.getState();
    if (ed.editingId) return; // 텍스트 편집 중이면 blur 로 커밋만
    const start = toPt(e);
    if (tool === "select") {
      if (!e.shiftKey) ed.select([]);
      const base = e.shiftKey ? ed.selection : [];
      listen(
        (ev) => {
          const p = toPt(ev);
          const r = { x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
          setMarquee(r);
          const hit = page.elements.filter((el) => el.x < r.x + r.w && el.x + el.w > r.x && el.y < r.y + r.h && el.y + el.h > r.y).map((el) => el.id);
          useEditor.getState().select([...new Set([...base, ...hit])]);
        },
        () => setMarquee(null),
      );
      return;
    }
    listen(
      (ev) => {
        const p = toPt(ev);
        setDraft({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
      },
      (ev) => {
        setDraft(null);
        const p = toPt(ev);
        let r = { x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
        const tiny = r.w < 4 && r.h < 4;
        // 도구를 먼저 선택 도구로 되돌린다 (setTool 은 편집 상태를 해제하므로 요소 추가보다 앞에서)
        useEditor.getState().setTool("select");
        if (tool === "text") {
          if (tiny) r = { x: start.x, y: start.y, w: 180, h: 24 };
          addElement(newText(r, "free"), { edit: true });
        } else if (tool === "line") {
          if (tiny) r = { x: start.x, y: start.y, w: 120, h: 4 };
          else if (r.w >= r.h) r = { ...r, h: 4, y: start.y - 2 };
          else r = { ...r, w: 4, x: start.x - 2 };
          addElement({ id: uid("s"), type: "shape", shape: "line", ...r, stroke: "#111111", strokeWidth: 0.75 });
        } else {
          if (tiny) r = { x: start.x, y: start.y, w: 120, h: 80 };
          addElement({ id: uid("s"), type: "shape", shape: tool === "ellipse" ? "ellipse" : "rect", ...r, fill: "#e8e8e8" });
        }
      },
    );
  }

  const selectedEls = page.elements.filter((e) => selection.includes(e.id));
  const single = selectedEls.length === 1 ? selectedEls[0] : null;
  const managedCount = page.elements.filter((e) => e.type === "image" && (e.managed || e.logo)).length;

  return (
    <div className={"canvas-wrap tool-" + tool} ref={wrapRef} onPointerDown={onBackgroundDown}>
      <div className="canvas-stage" style={{ width: px(W), height: px(H) }}>
        <div ref={pageRef} className="canvas-page" style={{ width: px(W) }}>
          <PageView
            page={page}
            settings={doc.settings}
            index={pageIndex}
            total={doc.pages.length}
            mode="edit"
            docTitle={doc.title}
            editingId={editingId}
            onTextCommit={(id, text) => {
              const ed = useEditor.getState();
              ed.setEditing(null);
              const cur = page.elements.find((x) => x.id === id);
              if (cur?.type === "text" && cur.role === "free" && !text.trim()) {
                // 내용 없이 끝낸 자유 텍스트 상자는 지운다
                ed.update((d) => withPage(d, page.id, (pg) => void (pg.elements = pg.elements.filter((x) => x.id !== id))));
              } else if (cur?.type === "text" && cur.text !== text) {
                // 본문 길이에 따라 짧은 글/긴 글 배치를 다시 고른다
                patchElements([id], { text });
              }
            }}
            onImageNatural={(id, w, h) => useEditor.getState().patchTransient(page.id, { [id]: { natW: w, natH: h } })}
          />
        </div>
        <div className="canvas-overlay">
          {managedCount > 0 && <div className="area-outline" style={rectPx(effectiveArea(page))} title="자동 레이아웃 영역" />}
          {page.elements.map((el) => (
            <div
              key={el.id}
              className={
                "hit" +
                (selection.includes(el.id) ? " selected" : "") +
                (dropTarget === el.id ? " drop-target" : "") +
                (el.locked ? " locked" : "") +
                (el.type === "image" && el.managed ? " managed" : "")
              }
              style={{ ...rectPx(el), pointerEvents: editingId === el.id ? "none" : undefined }}
              onPointerDown={(e) => onElementDown(e, el)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (el.locked) return;
                if (el.type === "text") useEditor.getState().setEditing(el.id);
                else if (el.type === "image") useEditor.getState().setModal({ type: "picker", mode: "replace", targetId: el.id });
              }}
            />
          ))}
          {selectedEls.length > 1 && <div className="sel-box multi" style={rectPx(bbox(selectedEls))} />}
          {single && !single.locked && editingId !== single.id && (
            <div className="sel-box" style={rectPx(single)}>
              {HANDLES.map((h) => (
                <span key={h} className={"handle h-" + h} onPointerDown={(e) => onHandleDown(e, single, h)} />
              ))}
              <span className="size-badge">
                {Math.round(single.w)} × {Math.round(single.h)}
              </span>
            </div>
          )}
          {guides.x.map((x, i) => (
            <div key={"gx" + i} className="guide guide-v" style={{ left: px(x) }} />
          ))}
          {guides.y.map((y, i) => (
            <div key={"gy" + i} className="guide guide-h" style={{ top: px(y) }} />
          ))}
          {ghost && (
            <div className="drag-ghost" style={rectPx(ghost.rect)}>
              <img src={ghost.src} alt="" referrerPolicy="no-referrer" />
              {dropTarget && <span>놓으면 자리 바꾸기</span>}
            </div>
          )}
          {marquee && <div className="marquee" style={rectPx(marquee)} />}
          {draft && <div className="marquee draft" style={rectPx(draft)} />}
        </div>
      </div>
    </div>
  );
}
