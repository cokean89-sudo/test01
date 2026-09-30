import { useEffect, useMemo, useState } from "react";
import type { Reference, TagSuggestResult } from "../../shared/types";
import { api } from "../api";
import { SmartImage } from "../components/SmartImage";
import { TagSuggestions } from "../components/TagSuggestions";
import { Button, Field, Segmented, Spinner, TagInput } from "../components/ui";
import { normalizeTags } from "../lib/search";
import { tagVocabulary, useLibrary } from "../store/library";
import { toast } from "../store/toast";
import { confirmRefDelete } from "./confirmRefDelete";

export function RefDetail({ ref_: ref, onClose, readOnly }: { ref_: Reference; onClose: () => void; readOnly?: boolean }) {
  const { refs, cases, updateRef, bulk, copyRef } = useLibrary();
  const [copying, setCopying] = useState(false);
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);
  const [title, setTitle] = useState(ref.title ?? "");
  const [note, setNote] = useState(ref.note ?? "");
  const [logoLabel, setLogoLabel] = useState(ref.logoLabel ?? "");
  const [imageUrl, setImageUrl] = useState(ref.imageUrl);
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<TagSuggestResult | null>(null);
  const aiOn = !!useLibrary((st) => st.status?.ai);
  const aiPaused = useLibrary((st) => (st.status?.aiPaused ? st.status.aiReason : undefined));

  useEffect(() => {
    setTitle(ref.title ?? "");
    setNote(ref.note ?? "");
    setLogoLabel(ref.logoLabel ?? "");
    setImageUrl(ref.imageUrl);
    setSuggest(null);
  }, [ref.id, ref.imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** AI 태그 제안 — 바로 저장하지 않고 축별 칩으로 보여준다 */
  async function aiSuggest() {
    setBusy(true);
    setSuggest(null);
    try {
      setSuggest(await api.suggestTags({ imageUrl: ref.imageUrl, title: ref.title, note: ref.note, existingTags: ref.tags, vocabulary: vocab, language: "ko" }));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="drawer">
      <div className="drawer-head">
        <h3>레퍼런스 상세</h3>
        <Button icon="x" variant="ghost" onClick={onClose} aria-label="닫기" />
      </div>
      <div className="drawer-body">
        <div className="drawer-preview" style={{ background: ref.kind === "logo" ? "var(--color-white)" : undefined }}>
          <SmartImage src={ref.imageUrl} fit="contain" loading="eager" />
        </div>
        <div className="row small muted">
          {ref.width && ref.height ? (
            <span>
              {ref.width}×{ref.height}
            </span>
          ) : null}
          {ref.sourceUrl && (
            <a href={ref.sourceUrl} target="_blank" rel="noreferrer" className="ellipsis">
              원본 페이지 ↗
            </a>
          )}
          <a href={ref.imageUrl} target="_blank" rel="noreferrer">
            이미지 ↗
          </a>
          {ref.originalUrl && (
            <a href={ref.originalUrl} target="_blank" rel="noreferrer">
              원래 링크 ↗
            </a>
          )}
        </div>
        {ref.fileId ? (
          <div className="stored-note">
            <strong>{ref.originalUrl ? "사본 저장됨" : "서버에 올린 이미지"}</strong>
            <span>{ref.originalUrl ? "원본 사이트에서 이미지가 지워져도 이 사본으로 보여요." : "레퍼런스를 지우면 파일도 함께 지워져요."}</span>
          </div>
        ) : (
          !readOnly &&
          /^https?:\/\//i.test(ref.imageUrl) && (
            <div className="stored-note link">
              <span>링크로만 연결된 이미지예요. 원본이 사라지면 깨질 수 있어요.</span>
              <Button
                size="sm"
                icon="copy"
                disabled={copying}
                onClick={async () => {
                  setCopying(true);
                  try {
                    await copyRef(ref.id);
                    toast.success("사본을 저장했어요 — 원본이 사라져도 보여요");
                  } catch (err) {
                    toast.error((err as Error).message);
                  } finally {
                    setCopying(false);
                  }
                }}
              >
                {copying ? <Spinner size={12} /> : null} 사본 저장
              </Button>
            </div>
          )
        )}
        <div className="attribution">
          <span>
            추가 <strong>{ref.createdByName ?? "—"}</strong> · {new Date(ref.createdAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
          </span>
          {ref.updatedAt && ref.updatedAt - ref.createdAt > 1000 && (
            <span>
              최근 수정 <strong>{ref.updatedByName ?? "—"}</strong> · {new Date(ref.updatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}
            </span>
          )}
        </div>
        <fieldset className="plain-fieldset" disabled={readOnly}>
        <Field label="제목">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== (ref.title ?? "") && updateRef(ref.id, { title })} />
        </Field>
        <Field label="키워드 태그">
          <TagInput value={ref.tags} onChange={(tags) => updateRef(ref.id, { tags })} suggestions={vocab} />
        </Field>
        {aiOn ? (
          <Button icon="sparkle" variant="accent" size="sm" onClick={aiSuggest} disabled={busy}>
            AI 태그 제안 받기
          </Button>
        ) : (
          <div className="note-box">{aiPaused ?? "AI 태그 제안은 AI 연결 후 사용할 수 있어요."}</div>
        )}
        {(busy || suggest) && (
          <TagSuggestions
            result={suggest}
            loading={busy}
            current={ref.tags}
            onAdopt={(tags) => void updateRef(ref.id, { tags: normalizeTags([...ref.tags, ...tags]) })}
            onTitle={(t) => {
              setTitle(t);
              void updateRef(ref.id, { title: t });
            }}
          />
        )}
        <Field label="케이스">
          <select value={ref.caseId ?? ""} onChange={(e) => updateRef(ref.id, { caseId: e.target.value || null })}>
            <option value="">(없음)</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="유형">
          <Segmented
            value={ref.kind}
            onChange={(kind) => updateRef(ref.id, { kind })}
            options={[
              { value: "image", label: "이미지" },
              { value: "logo", label: "로고" },
            ]}
          />
        </Field>
        {ref.kind === "logo" && (
          <Field label="로고 라벨" hint="케이스 페이지 로고 패널에 표시돼요">
            <input value={logoLabel} onChange={(e) => setLogoLabel(e.target.value)} onBlur={() => updateRef(ref.id, { logoLabel })} />
          </Field>
        )}
        <Field label="메모">
          <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (ref.note ?? "") && updateRef(ref.id, { note })} />
        </Field>
        <Field label="이미지 URL" hint={ref.fileId ? "다른 링크로 바꾸면 서버에 저장한 이미지는 지워져요" : "링크가 깨졌을 때 새 주소로 교체"}>
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} onBlur={() => imageUrl !== ref.imageUrl && imageUrl.trim() && updateRef(ref.id, { imageUrl: imageUrl.trim() })} />
        </Field>
        </fieldset>
        {!readOnly && <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            if (!(await confirmRefDelete([ref.id], "이 레퍼런스"))) return;
            await bulk({ ids: [ref.id], delete: true });
            onClose();
          }}
        >
          삭제
        </Button>}
      </div>
    </aside>
  );
}
