// 임시 보관함 — 페이지에서 빼거나 교체된 이미지가 모인다. 끌어서 페이지 · 썸네일에 다시 쓸 수 있다.

import { useState } from "react";
import type { TrayItem } from "../../../shared/types";
import { Icon } from "../../components/icons";
import { SmartImage } from "../../components/SmartImage";
import { useEditor } from "../../store/editor";
import { moveImages, trayClear, trayRemove } from "./actions";
import { createImageDrag, useImageDrag } from "./imageDrag";

const OPEN_KEY = "rb.trayOpen";

export function TrayShelf() {
  const tray = useEditor((s) => s.doc?.tray ?? []);
  const readOnly = useEditor((s) => s.readOnly);
  const over = useImageDrag((s) => s.hover?.kind === "tray");
  const dragging = useImageDrag((s) => s.active);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      /* 저장 못 해도 동작에는 문제 없음 */
    }
  };
  // 끌고 있는 동안엔 접혀 있어도 놓을 수 있게 펼쳐 보인다
  const shown = open || (dragging && !readOnly);

  function startDrag(e: React.PointerEvent, item: TrayItem) {
    if (e.button !== 0 || readOnly) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const drag = createImageDrag({ kind: "tray", ids: [item.id] }, { src: item.src, count: 1 });
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
      moved = true;
      drag.move(ev);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (moved && ev.type === "pointerup") drag.drop(ev);
      else drag.cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  const toCurrent = (id: string) => {
    const pageId = useEditor.getState().pageId;
    if (pageId) moveImages({ kind: "tray", ids: [id] }, pageId);
  };

  return (
    <section className={"tray" + (shown ? " open" : "") + (over ? " over" : "")} data-tray-drop aria-label="임시 보관함">
      <header className="tray-head">
        <button className="tray-toggle" onClick={toggle} aria-expanded={shown}>
          <Icon name={shown ? "down" : "up"} size={14} />
          임시 보관함
          <span className="count">{tray.length}</span>
        </button>
        <span className="muted small tray-hint">{over ? "놓으면 보관함에 넣어요" : "페이지에서 지우거나 교체한 이미지가 모여요 · 끌어서 다시 쓰기 · 더블클릭하면 이 페이지에"}</span>
        <span className="spacer" />
        {tray.length > 0 && !readOnly && (
          <button className="link-btn" onClick={() => confirm(`보관함의 이미지 ${tray.length}장을 모두 비울까요? (Ctrl+Z 로 되돌리기)`) && trayClear()}>
            비우기
          </button>
        )}
      </header>
      {shown && (
        <div className="tray-items">
          {tray.length === 0 && <p className="tray-empty">{over ? "여기에 놓으세요" : "비어 있어요. 캔버스의 이미지를 여기로 끌어 잠시 보관할 수 있어요."}</p>}
          {tray.map((t) => (
            <div key={t.id} className="tray-item" title={(t.caption || "") + (t.from ? ` · ${t.from}에서` : "")} onPointerDown={(e) => startDrag(e, t)} onDoubleClick={() => !readOnly && toCurrent(t.id)}>
              <SmartImage src={t.src} fit="cover" />
              {!readOnly && (
                <button
                  className="tray-x"
                  aria-label="보관함에서 지우기"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    trayRemove([t.id]);
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 끌고 있는 이미지 미리보기 — 커서를 따라간다 */
export function DragLayer() {
  const { active, preview, x, y, hover } = useImageDrag();
  if (!active || !preview) return null;
  const label =
    hover?.kind === "thumb"
      ? hover.switching
        ? "잠시 머물면 페이지가 열려요"
        : "이 페이지로 옮기기"
      : hover?.kind === "tray"
        ? "보관함에 넣기"
        : ""; // 캔버스 위에서는 '교체 / 서로 바꾸기' 영역과 '여기에 추가' 표시가 안내한다
  return (
    <div className="drag-layer" style={{ left: x + 14, top: y + 14 }} aria-hidden="true">
      <div className="drag-layer-img">
        <SmartImage src={preview.src} fit="cover" />
        {preview.count > 1 && <span className="drag-count">{preview.count}</span>}
      </div>
      {label && <span className="drag-label">{label}</span>}
    </div>
  );
}
