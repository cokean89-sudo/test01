import { useEffect, useMemo, useState } from "react";
import { AI_PERSPECTIVES, AI_TONES, type AiPerspective, type AiTone, type AnalyzeResult, type CaptionPos } from "../../../shared/types";
import { api } from "../../api";
import { Icon } from "../../components/icons";
import { PageView } from "../../components/PageView";
import { SmartImage } from "../../components/SmartImage";
import { Button, Modal, Segmented, Select, Spinner } from "../../components/ui";
import { useEditor } from "../../store/editor";
import { toast } from "../../store/toast";
import { AI_FIELDS, analyzeRequestFor, applyAnalysis, contentImages, getPage, updatePage, type AiField } from "./actions";

/**
 * AI 글쓰기 — 관점·문체를 고르고, 항목별로 다시 쓰고, 적용 전에 페이지 미리보기로 확인한 뒤 선택한 항목만 적용.
 * 관점·문체는 문서 설정에 저장되어 다음에 열 때도 그대로 쓰인다.
 */
export function AiDialog({ pageId }: { pageId: string }) {
  const doc = useEditor((s) => s.doc)!;
  const setModal = useEditor((s) => s.setModal);
  const update = useEditor((s) => s.update);
  const page = getPage(doc, pageId);
  const perspective: AiPerspective = doc.settings.aiPerspective ?? "design";
  const tone: AiTone = doc.settings.aiTone ?? "report";
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyField, setBusyField] = useState<AiField | null>(null);
  const [instruction, setInstruction] = useState("");
  const [fields, setFields] = useState<Set<AiField>>(new Set(["title", "subtitle", "highlight", "description", "sectionLabel", "captions"]));
  const [capPos, setCapPos] = useState<CaptionPos | "">("");

  const close = () => setModal(null);
  const images = page ? contentImages(page) : [];
  const hasRole = (role?: string) => !role || !!page?.elements.some((e) => e.type === "text" && e.role === role && !e.labelFor);

  /** 지금 창에 보이는 글을 '현재 텍스트'로 넘겨, 다시 쓸 때 다른 표현이 나오게 한다 */
  function request(only?: AiField[]) {
    const req = analyzeRequestFor(page!, useEditor.getState().doc!, instruction || undefined, only);
    if (result) req.current = { title: result.title, subtitle: result.subtitle, highlight: result.highlight, description: result.description };
    return req;
  }

  async function run() {
    if (!page) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await api.analyze(request()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function rewrite(field: AiField) {
    if (!page || !result) return;
    setBusyField(field);
    setError(null);
    try {
      const r = await api.analyze(request([field]));
      setResult((prev) => (prev ? (field === "captions" ? { ...prev, captions: r.captions } : { ...prev, [field]: r[field] }) : r));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyField(null);
    }
  }

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 관점·문체를 바꾸면 문서에 저장하고 새로 쓴다
  const choose = (patch: { aiPerspective?: AiPerspective; aiTone?: AiTone }) => {
    update((d) => void Object.assign(d.settings, patch));
    setTimeout(() => void run(), 0);
  };

  const preview = useMemo(() => (page && result ? applyAnalysis(page, result, fields, capPos || undefined) : page), [page, result, fields, capPos]);
  if (!page) return null;
  const pageIndex = doc.pages.findIndex((p) => p.id === page.id);

  const apply = () => {
    if (!result) return;
    updatePage(page.id, (p) => applyAnalysis(p, result, fields, capPos || undefined));
    toast.success("AI 글을 적용했어요 (Ctrl+Z 로 되돌리기)");
    close();
  };

  const toggle = (f: AiField) =>
    setFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const RewriteBtn = ({ field }: { field: AiField }) => (
    <button className="ai-rewrite" onClick={() => rewrite(field)} disabled={!!busyField || loading} title="이 항목만 다시 쓰기">
      {busyField === field ? <Spinner size={12} /> : <Icon name="refresh" size={14} />}
      <span>다시 쓰기</span>
    </button>
  );

  return (
    <Modal
      title="AI 글쓰기"
      onClose={close}
      wide
      footer={
        <>
          <input
            className="ai-instruction"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="추가 요청 (예: 더 짧게 / 영문 타이틀 / 조명 연출 위주로)"
            onKeyDown={(e) => e.key === "Enter" && !loading && run()}
          />
          <Button icon="refresh" onClick={run} disabled={loading || !!busyField}>
            전체 다시 쓰기
          </Button>
          <Button variant="primary" onClick={apply} disabled={!result || loading}>
            선택 항목 적용
          </Button>
        </>
      }
    >
      <div className="ai-settings">
        <div className="ai-setting">
          <span className="field-label">관점</span>
          <Segmented<AiPerspective>
            value={perspective}
            onChange={(v) => choose({ aiPerspective: v })}
            options={AI_PERSPECTIVES.map((p) => ({ value: p.key, label: p.label, title: p.hint }))}
          />
          <span className="help-text">{AI_PERSPECTIVES.find((p) => p.key === perspective)?.hint}</span>
        </div>
        <div className="ai-setting">
          <span className="field-label">문체</span>
          <Segmented<AiTone> value={tone} onChange={(v) => choose({ aiTone: v })} options={AI_TONES.map((t) => ({ value: t.key, label: t.label, title: t.hint }))} />
          <span className="help-text">{AI_TONES.find((t) => t.key === tone)?.hint}</span>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      <div className="ai-layout">
        <div className="ai-result">
          {loading && (
            <div className="ai-loading">
              <Spinner size={20} /> 이미지 {images.length}장을 보고 쓰는 중…
            </div>
          )}
          {result && !loading && (
            <>
              {result.engine === "heuristic" && <div className="notice">{result.notice ?? "AI 가 연결되지 않아 규칙 기반으로 채웠어요."}</div>}
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
                  {hasRole(f.role) ? <RewriteBtn field={f.key} /> : <small className="muted">이 페이지에 해당 칸이 없어요</small>}
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
                <RewriteBtn field="captions" />
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
              {result.model && <p className="muted small">작성 모델 · {result.model}</p>}
            </>
          )}
        </div>

        <aside className="ai-preview">
          <h4>적용 전 미리보기</h4>
          {preview && (
            <div className="page-preview">
              <PageView page={preview} settings={doc.settings} index={pageIndex} total={doc.pages.length} docTitle={doc.title} />
            </div>
          )}
          <p className="help-text">체크한 항목만 페이지에 들어가요. 글을 직접 고쳐도 바로 반영돼요.</p>
        </aside>
      </div>
    </Modal>
  );
}
