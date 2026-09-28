import { useEffect, useMemo, useState } from "react";
import type { CaseStudy } from "../../shared/types";
import { api } from "../api";
import { SmartImage } from "../components/SmartImage";
import { Button, Empty, Field, Spinner, TagInput } from "../components/ui";
import { tagVocabulary, useLibrary } from "../store/library";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";

export function CasesView() {
  const { cases, refs, createCase } = useLibrary();
  const openBuild = useUI((s) => s.openBuild);
  const [activeId, setActiveId] = useState<string | null>(null);
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
          <Button
            icon="plus"
            onClick={async () => {
              const name = prompt("새 케이스 이름 (예: Allianz Arena)");
              if (!name?.trim()) return;
              const c = await createCase({ name: name.trim(), tags: [] });
              setActiveId(c.id);
            }}
          >
            새 케이스
          </Button>
        </section>
      </aside>
      <section className="case-main">
        {active ? (
          <CaseEditor key={active.id} c={active} onBuild={(refIds) => openBuild({ refIds, groupBy: "case", query: "", title: active.name })} />
        ) : (
          <Empty title="케이스가 없습니다">
            <p className="muted">
              케이스는 하나의 사례(경기장, 매장, 브랜드 등)에 대한 이미지·로고·설명을 묶는 단위입니다.
              <br />
              레퍼런스를 추가할 때 케이스를 지정하거나 여기서 새로 만드세요.
            </p>
          </Empty>
        )}
      </section>
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
      toast.success(out.engine === "ai" ? "AI 가 케이스 정보를 채웠습니다" : out.notice ?? "규칙 기반으로 채웠습니다");
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
          <Button icon="sparkle" variant="accent" onClick={aiFill} disabled={busy} title={status?.ai ? "" : "API 키가 없으면 규칙 기반으로 채웁니다"}>
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
          <Field label="서브타이틀" hint="예: Bundesliga-FC Bayern München">
            <input value={form.subtitle ?? ""} onChange={(e) => setForm({ ...form, subtitle: e.target.value })} onBlur={() => save({ subtitle: form.subtitle })} />
          </Field>
        </div>
        <Field label="강조 라인" hint="예: 스폰서 : Allianz AG (보험/금융) / 소유: Allianz AG">
          <input value={form.highlight ?? ""} onChange={(e) => setForm({ ...form, highlight: e.target.value })} onBlur={() => save({ highlight: form.highlight })} />
        </Field>
        <Field label="설명">
          <textarea rows={5} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} onBlur={() => save({ description: form.description })} />
        </Field>
        <Field label="케이스 태그" hint="케이스 태그는 소속 레퍼런스 검색에도 적용됩니다">
          <TagInput value={form.tags} suggestions={vocab} onChange={(tags) => { setForm({ ...form, tags }); void save({ tags }); }} />
        </Field>
        <div className="row">
          <span className="spacer" />
          <Button
            variant="danger"
            icon="trash"
            size="sm"
            onClick={async () => {
              if (confirm(`'${c.name}' 케이스를 삭제할까요? (레퍼런스는 유지되고 케이스 연결만 해제됩니다)`)) await deleteCase(c.id);
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
              <SmartImage src={r.imageUrl} fit="contain" />
              <span>{r.logoLabel || r.title}</span>
            </div>
          ))}
          {!logos.length && <p className="muted small">레퍼런스 상세에서 유형을 &lsquo;로고&rsquo;로 지정하면 케이스 페이지 로고 패널에 배치됩니다.</p>}
        </div>
        <h4>
          이미지 <span className="count">{images.length}</span>
        </h4>
        <div className="thumb-row">
          {images.map((r) => (
            <div key={r.id} className="thumb" title={r.title}>
              <SmartImage src={r.imageUrl} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
