import { useEffect, useRef, useState } from "react";
import { PAGE_SIZES, type DocumentData } from "../../shared/types";
import { api } from "../api";
import { PageView } from "../components/PageView";
import { Button, Spinner } from "../components/ui";

/** 인쇄 전용 화면 — 실제 용지 크기로 페이지를 배치하고 이미지·폰트 로딩 후 인쇄 창을 연다 (PDF 로 저장 가능) */
export function PrintView({ id }: { id: string }) {
  const [doc, setDoc] = useState<DocumentData | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const printed = useRef(false);

  useEffect(() => {
    api
      .document(id)
      .then((d) => {
        setDoc(d);
        document.title = d.title;
      })
      .catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    if (!doc || !root.current) return;
    const imgs = [...root.current.querySelectorAll("img")];
    const loads = imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.addEventListener("load", () => res(), { once: true });
            img.addEventListener("error", () => res(), { once: true });
          }),
    );
    const timeout = new Promise((res) => setTimeout(res, 15000));
    void Promise.race([Promise.all([...loads, document.fonts.ready]), timeout]).then(() => {
      setReady(true);
      if (!printed.current) {
        printed.current = true;
        setTimeout(() => window.print(), 300);
      }
    });
  }, [doc]);

  if (error) return <div className="center-msg error-box">{error}</div>;
  if (!doc) {
    return (
      <div className="center-msg">
        <Spinner size={22} />
      </div>
    );
  }
  const size = PAGE_SIZES[doc.settings.pageSize];
  const [pw, ph] = size.css.split(" ");
  return (
    <div className="print-root" ref={root}>
      <style>{`@page { size: ${size.css}; margin: 0 } .print-page { width: ${pw}; height: ${ph}; }`}</style>
      <div className="print-bar no-print">
        <strong>{doc.title}</strong>
        <span className="muted">
          {doc.pages.length}페이지 · {size.label} · 인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 선택하세요 (배경 그래픽 켜기)
        </span>
        <span className="spacer" />
        {!ready && <Spinner />}
        <Button variant="primary" icon="printer" onClick={() => window.print()}>
          인쇄 / PDF 저장
        </Button>
      </div>
      {doc.pages.map((p, i) => (
        <div key={p.id} className="print-page">
          <PageView page={p} settings={doc.settings} index={i} total={doc.pages.length} mode="print" docTitle={doc.title} />
        </div>
      ))}
    </div>
  );
}
