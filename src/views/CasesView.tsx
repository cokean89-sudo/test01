import { useEffect, useMemo, useState } from "react";
import { ROLE_RANK, type CaseStudy } from "../../shared/types";
import { api } from "../api";
import { SmartImage } from "../components/SmartImage";
import { Button, Empty, Field, Modal, Spinner, TagInput } from "../components/ui";
import { tagVocabulary, useLibrary } from "../store/library";
import { useCurrentTeam } from "../store/session";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";

export function CasesView() {
  const { cases, refs, createCase } = useLibrary();
  const openBuild = useUI((s) => s.openBuild);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const team = useCurrentTeam();
  const canEdit = !!team && ROLE_RANK[team.role] >= ROLE_RANK.editor;
  const active = cases.find((c) => c.id === activeId) ?? cases[0];

  return (
    <div className="cases">
      <aside className="sidebar">
        <section>
          <h4>케이스 스터디</h4>
          <ul className="case-list">
            {cases.map((c) => {
              const count = refs.filter((r) => r.caseId === c.id).length;
              return (
                <li key={c.id}>
                  <button className={active?.id === c.id ? "on" : ""} onClick={() => setActiveId(c.id)}>
                    <strong>{c.name}</strong>
                    <span className="muted small">
                      {c.subtitle || "—"} · {count}장
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {canEdit && (
            <Button icon="plus" onClick={() => setNaming(true)}>
              새 케이스
            </Button>
          )}
        </section>
      </aside>
      <section className="case-main">
        {active ? (
          <CaseEditor key={active.id} c={active} onBuild={(refIds) => openBuild({ refIds, groupBy: "case", query: "", title: active.name })} />
        ) : (
          <Empty emoji="🗂️" title="케이스로 사례를 묶어 보세요">
            <p>
              케이스는 하나의 사례(브랜드, 경쟁사, 상품 등)의 이미지·로고·설명을 묶는 단위예요.
              <br />
              케이스로 문서를 만들면 케이스 스터디 페이지가 한 번에 만들어져요.
            </p>
            {canEdit && (
              <Button size="lg" variant="primary" icon="plus" onClick={() => setNaming(true)}>
                첫 케이스 만들기
              </Button>
            )}
          </Empty>
        )}
      </section>
      {naming && (
        <NewCaseDialog
          onClose={() => setNaming(false)}
          onCreate={async (name) => {
            const c = await createCase({ name, tags: [] });
            setActiveId(c.id);
            setNaming(false);
          }}
        />
      )}
    </div>
  );
}

function CaseEditor({ c, onBuild }: { c: CaseStudy; onBuild: (refIds: string[]) => void }) {
  const { refs, updateCase, deleteCase, status } = useLibrary();
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);
  const [form, setForm] = useState(c);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(c), [c]);
  const members = refs.filter((r) => r.caseId === c.id);
  const logos = members.filter((r) => r.kind === "logo");
  const images = members.filter((r) => r.kind !== "logo");

  const save = (patch: Partial<CaseStudy>) => updateCase(c.id, patch).catch((err) => toast.error(err.message));

  async function aiFill() {
    setBusy(true);
    try {
      const out = await api.analyze({
        kind: "case",
        language: "ko",
        group: c.name,
        caseInfo: { name: form.name, subtitle: form.subtitle, highlight: form.highlight, description: form.description },
        images: images.slice(0, 8).map((r) => ({ url: r.imageUrl, title: r.title, note: r.note, tags: r.tags })),
      });
      const patch = {
        subtitle: form.subtitle || out.subtitle,
        highlight: form.highlight || out.highlight,
        description: out.description || form.description,
        tags: [...new Set([...form.tags, ...out.tags])].slice(0, 12),
      };
      setForm({ ...form, ...patch });
      await save(patch);
      toast.success(out.engine === "ai" ? "AI 가 케이스 정보를 채웠어요" : out.notice ?? "규칙 기반으로 채웠어요");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="case-editor">
      <div className="case-form">
        <div className="row">
          <h2 style={{ flex: 1 }}>{form.name}</h2>
          <Button icon="sparkle" variant="accent" onClick={aiFill} disabled={busy} title={status?.ai ? "" : "API 키가 없으면 규칙 기반으로 채워요"}>
            {busy ? <Spinner size={12} /> : null} AI 로 설명 채우기
          </Button>
          <Button icon="file" variant="primary" disabled={!members.length} onClick={() => onBuild(members.map((r) => r.id))}>
            케이스 페이지 만들기
          </Button>
        </div>
        <div className="grid-2">
          <Field label="케이스명 (타이틀)">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onBlur={() => form.name.trim() && save({ name: form.name })} />
          </Field>
          <Field label="서브타이틀" hint="예: MORNING ROUTINE · Seongsu Pop-up">
            <input value={form.subtitle ?? ""} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} onBlur={() => save({ subtitle: form.subtitle })} />
          </Field>
        </div>
        <Field label="강조 라인" hint="예: 유형 : 브랜드 팝업 / 채널: 오프라인 · SNS">
          <input value={form.highlight ?? ""} onChange={(e) => setForm({ ...form, highlight: e.target.value })} onBlur={() => save({ highlight: form.highlight })} />
        </Field>
        <Field label="설명">
          <textarea rows={5} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => save({ description: form.description })} />
        </Field>
        <Field label="케이스 태그" hint="케이스 태그는 소속 레퍼런스 검색에도 적용돼요">
          <TagInput value={form.tags} suggestions={vocab} onChange={(tags) => { setForm({ ...form, tags }); void save({ tags }); }} />
        </Field>
        <div className="row">
          <span className="spacer" />
          <Button
            variant="danger"
            icon="trash"
            size="sm"
            onClick={async () => {
              if (confirm(`'${c.name}' 케이스를 삭제할까요? (레퍼런스는 유지되고 케이스 연결만 해제돼요)`)) await deleteCase(c.id);
            }}
          >
            케이스 삭제
          </Button>
        </div>
      </div>
      <div className="case-members">
        <h4>
          로고 <span className="count">{logos.length}</span>
        </h4>
        <div className="thumb-row">
          {logos.map((r) => (
            <div key={r.id} className="thumb thumb-logo" title={r.logoLabel}>
              <SmartImage src={r.thumbUrl ?? r.imageUrl} fit="contain" />
              <span>{r.logoLabel || r.title}</span>
            </div>
          ))}
          {!logos.length && <p className="muted small">레퍼런스 상세에서 유형을 &lsquo;로고&rsquo;로 지정하면 케이스 페이지 로고 패널에 배치돼요.</p>}
        </div>
        <h4>
          이미지 <span className="count">{images.length}</span>
        </h4>
        <div className="thumb-row">
          {images.map((r) => (
            <div key={r.id} className="thumb" title={r.title}>
              <SmartImage src={r.thumbUrl ?? r.imageUrl} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NewCaseDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="어떤 사례를 정리할까요?"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>
            만들기
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="케이스 이름" hint="브랜드·경쟁사·상품처럼 하나의 사례 이름이에요. 문서의 페이지 제목이 돼요.">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예) 모닝루틴 성수 팝업" autoFocus maxLength={80} />
        </Field>
      </form>
    </Modal>
  );
}
