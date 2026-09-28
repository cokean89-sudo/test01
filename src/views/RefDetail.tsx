import { useEffect, useMemo, useState } from "react";
import type { Reference } from "../../shared/types";
import { api } from "../api";
import { SmartImage } from "../components/SmartImage";
import { Button, Field, Segmented, Spinner, TagInput } from "../components/ui";
import { normalizeTags } from "../lib/search";
import { tagVocabulary, useLibrary } from "../store/library";
import { toast } from "../store/toast";

export function RefDetail({ ref_: ref, onClose, readOnly }: { ref_: Reference; onClose: () => void; readOnly?: boolean }) {
  const { refs, cases, updateRef, bulk } = useLibrary();
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);
  const [title, setTitle] = useState(ref.title ?? "");
  const [note, setNote] = useState(ref.note ?? "");
  const [logoLabel, setLogoLabel] = useState(ref.logoLabel ?? "");
  const [imageUrl, setImageUrl] = useState(ref.imageUrl);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(ref.title ?? "");
    setNote(ref.note ?? "");
    setLogoLabel(ref.logoLabel ?? "");
    setImageUrl(ref.imageUrl);
  }, [ref.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function aiSuggest() {
    setBusy(true);
    try {
      const out = await api.suggestTags({ imageUrl: ref.imageUrl, title: ref.title, note: ref.note, existingTags: ref.tags, vocabulary: vocab, language: "ko" });
      await updateRef(ref.id, { tags: normalizeTags([...ref.tags, ...out.tags]), ...(ref.title ? {} : { title: out.title }) });
      if (!ref.title && out.title) setTitle(out.title);
      toast.success(out.engine === "ai" ? "AI 태그를 추가했습니다" : out.notice ?? "규칙 기반 태그를 추가했습니다");
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
        <div className="drawer-preview" style={{ background: ref.kind === "logo" ? "#fff" : undefined }}>
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
        </div>
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
        <Button icon="sparkle" variant="accent" size="sm" onClick={aiSuggest} disabled={busy}>
          {busy ? <Spinner size={12} /> : null} AI 태그·제목 추천
        </Button>
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
          <Field label="로고 라벨" hint="케이스 페이지 로고 패널에 표시됩니다">
            <input value={logoLabel} onChange={(e) => setLogoLabel(e.target.value)} onBlur={() => updateRef(ref.id, { logoLabel })} />
          </Field>
        )}
        <Field label="메모">
          <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (ref.note ?? "") && updateRef(ref.id, { note })} />
        </Field>
        <Field label="이미지 URL" hint="링크가 깨졌을 때 새 주소로 교체">
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} onBlur={() => imageUrl !== ref.imageUrl && imageUrl.trim() && updateRef(ref.id, { imageUrl: imageUrl.trim() })} />
        </Field>
        </fieldset>
        {!readOnly && <Button
          variant="danger"
          icon="trash"
          onClick={async () => {
            if (!confirm("이 레퍼런스를 삭제할까요?")) return;
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
