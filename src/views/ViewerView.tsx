import { useEffect, useState } from "react";
import type { DocumentData } from "../../shared/types";
import { api } from "../api";
import { Icon } from "../components/icons";
import { PageView, pageSize } from "../components/PageView";
import { Button, Spinner } from "../components/ui";

/** 웹 뷰어 — 페이지를 세로로 넘겨 보거나 발표 모드로 본다 */
export function ViewerView({ id }: { id: string }) {
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [present, setPresent] = useState<number | null>(location.hash.includes("?present") ? 0 : null);

  useEffect(() => {
    api
      .document(id)
      .then((d) => {
        setDoc(d);
        document.title = d.title + " — RefBoard";
      })
      .catch((err) => setError(err.message));
  }, [id]);

  if (error) return <div className="center-msg error-box">{error}</div>;
  if (!doc) {
    return (
      <div className="center-msg">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <div className="viewer">
      <header className="viewer-bar">
        <strong className="ellipsis">{doc.title}</strong>
        <span className="muted small">{doc.pages.length}페이지</span>
        <span className="spacer" />
        <Button icon="play" onClick={() => setPresent(0)}>
          발표 모드
        </Button>
        <Button icon="printer" onClick={() => window.open("#/print/" + doc.id, "_blank")}>
          PDF 인쇄
        </Button>
        <Button icon="file" variant="primary" onClick={() => (location.hash = "#/edit/" + doc.id)}>
          편집
        </Button>
      </header>
      <div className="viewer-pages">
        {doc.pages.map((p, i) => (
          <div key={p.id} className="viewer-page" id={"p" + (i + 1)} onDoubleClick={() => setPresent(i)}>
            <PageView page={p} settings={doc.settings} index={i} total={doc.pages.length} docTitle={doc.title} />
            <span className="viewer-num">{i + 1}</span>
          </div>
        ))}
      </div>
      {present !== null && <Presenter doc={doc} start={present} onExit={() => setPresent(null)} />}
    </div>
  );
}

export function Presenter({ doc, start, onExit }: { doc: DocumentData; start: number; onExit: () => void }) {
  const [idx, setIdx] = useState(start);
  const [showNotes, setShowNotes] = useState(false);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const { W, H } = pageSize(doc.settings);
  const n = doc.pages.length;

  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) setIdx((i) => Math.min(n - 1, i + 1));
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) setIdx((i) => Math.max(0, i - 1));
      else if (e.key === "Home") setIdx(0);
      else if (e.key === "End") setIdx(n - 1);
      else if (e.key.toLowerCase() === "n") setShowNotes((s) => !s);
      else if (e.key === "Escape") exit();
    };
    const onFs = () => {
      if (!document.fullscreenElement) onExit();
    };
    const exit = () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else onExit();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [n, onExit]);

  const width = Math.min(vp.w, (vp.h * W) / H);
  const page = doc.pages[idx];
  return (
    <div
      className="presenter"
      onClick={(e) => {
        const x = e.clientX / window.innerWidth;
        setIdx((i) => (x < 0.25 ? Math.max(0, i - 1) : Math.min(n - 1, i + 1)));
      }}
    >
      <div style={{ width }}>
        <PageView page={page} settings={doc.settings} index={idx} total={n} docTitle={doc.title} />
      </div>
      <div className="presenter-hud" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} aria-label="이전">
          <Icon name="chevronLeft" />
        </button>
        <span>
          {idx + 1} / {n}
        </span>
        <button onClick={() => setIdx((i) => Math.min(n - 1, i + 1))} aria-label="다음">
          <Icon name="chevronRight" />
        </button>
        <button onClick={() => setShowNotes((s) => !s)} title="발표자 노트 (N)">
          노트
        </button>
        <button
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            onExit();
          }}
          aria-label="닫기"
        >
          <Icon name="x" />
        </button>
      </div>
      {showNotes && page.notes && (
        <div className="presenter-notes" onClick={(e) => e.stopPropagation()}>
          {page.notes}
        </div>
      )}
    </div>
  );
}
