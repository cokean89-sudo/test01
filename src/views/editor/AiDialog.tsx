import { useEffect, useState } from "react";
import type { AnalyzeResult, CaptionPos } from "../../../shared/types";
import { api } from "../../api";
import { SmartImage } from "../../components/SmartImage";
import { Button, Modal, Select, Spinner } from "../../components/ui";
import { useEditor } from "../../store/editor";
import { toast } from "../../store/toast";
import { AI_FIELDS, analyzeRequestFor, applyAnalysis, contentImages, getPage, updatePage, type AiField } from "./actions";

/** 현재 페이지 AI 분석 → 결과 확인·수정 후 선택한 항목만 적용 */
export function AiDialog({ pageId }: { pageId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const setModal = useEditor((s) => s.setModal);
  const page = getPage(doc, pageId);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [fields, setFields] = useState<Set<AiField>>(new Set(["title", "subtitle", "highlight", "description", "sectionLabel", "captions"]));
  const [capPos, setCapPos] = useState<CaptionPos | "">("");

  const close = () => setModal(null);
  const images = page ? contentImages(page) : [];
  const hasRole = (role?: string) => !role || !!page?.elements.some((e) => e.type === "text" && e.role === role && !e.labelFor);

  async function run() {
    if (!page) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.analyze(analyzeRequestFor(page, doc, instruction || undefined)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!page) return null;

  const apply = () => {
    if (!result) return;
    updatePage(page.id, (p) => applyAnalysis(p, result, fields, capPos || undefined));
    toast.success("AI 결과를 적용했어요 (Ctrl+Z 로 되돌리기)");
    close();
  };

  const toggle = (f: AiField) => setFields((prev) => {
    const next = new Set(prev);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    return next;
  });

  return (
    <Modal
      title="AI 페이지 분석"
      onClose={close}
      width={860}
      footer={
        <>
          <input
            className="ai-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="추가 요청 (예: 더 짧게 / 영문 타이틀 / 공간 연출 관점으로)"
            onKeyDown={(e) => e.key === "Enter" && !loading && run()}
          />
          <Button icon="refresh" onClick={run} disabled={loading}>
            다시 생성
          </Button>
          <Button variant="primary" onClick={apply} disabled={!result || loading}>
            선택 항목 적용
          </Button>
        </>
      }
    >
      {loading && (
        <div className="ai-loading">
          <Spinner size={20} /> 이미지 {images.length}장을 분석하는 중…
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      {result && !loading && (
        <div className="ai-result">
          {result.engine === "heuristic" && <div className="notice">{result.notice ?? "AI 가 연결되지 않아 규칙 기반으로 제안했어요."}</div>}
          {AI_FIELDS.filter((f) => f.key !== "captions").map((f) => (
            <div key={f.key} className={"ai-field" + (hasRole(f.role) ? "" : " disabled")}>
              <label className="toggle">
                <input type="checkbox" checked={fields.has(f.key) && hasRole(f.role)} disabled={!hasRole(f.role)} onChange={() => toggle(f.key)} />
                <span>{f.label}</span>
              </label>
              {f.key === "description" ? (
                <textarea rows={4} value={result.description} onChange={(e) => setResult({ ...result, description: e.target.value })} />
              ) : (
                <input value={result[f.key as "title"]} onChange={(e) => setResult({ ...result, [f.key]: e.target.value })} />
              )}
              {!hasRole(f.role) && <small className="muted">이 페이지에 해당 텍스트 칸이 없어요</small>}
            </div>
          ))}
          <div className="ai-field">
            <label className="toggle">
              <input type="checkbox" checked={fields.has("captions")} onChange={() => toggle("captions")} />
              <span>이미지 캡션</span>
            </label>
            <Select<CaptionPos | "">
              value={capPos}
              onChange={setCapPos}
              options={[
                { value: "", label: "표시 위치 유지" },
                { value: "overlay-bottom", label: "이미지 위 · 하단에 표시" },
                { value: "overlay-top", label: "이미지 위 · 상단에 표시" },
                { value: "below", label: "이미지 아래에 표시" },
                { value: "none", label: "텍스트만 저장(숨김)" },
              ]}
            />
          </div>
          <div className="ai-captions">
            {images.map((img, i) => (
              <div key={img.id} className="ai-caption">
                <span className="mini-thumb">
                  <SmartImage src={img.src} />
                </span>
                <input
                  value={result.captions[i] ?? ""}
                  onChange={(e) => {
                    const captions = [...result.captions];
                    captions[i] = e.target.value;
                    setResult({ ...result, captions });
                  }}
                />
              </div>
            ))}
          </div>
          {result.tags.length > 0 && (
            <p className="muted small">
              제안 태그: {result.tags.map((t) => "#" + t).join(" ")}
              {result.model && ` · ${result.model}`}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
