// 태그 관리 — 사용 횟수를 보고 이름 변경 · 삭제 · 동의어 병합. 비슷한 태그와 쓸모없는 태그는 정리 추천으로 모아 준다.

import { useMemo, useState } from "react";
import { isBannedTag, isUnclassified, similarGroups, tagKey } from "../../shared/tags";
import { ROLE_RANK } from "../../shared/types";
import { Icon } from "../components/icons";
import { Button, Empty, Field, Modal } from "../components/ui";
import { navigate } from "../lib/router";
import { useLibrary } from "../store/library";
import { useCurrentTeam } from "../store/session";
import { toast } from "../store/toast";

interface TagRow {
  tag: string;
  refs: number;
  cases: number;
}

export function TagsView() {
  const { refs, cases, loaded, renameTag, mergeTags, deleteTags } = useLibrary();
  const team = useCurrentTeam();
  const canEdit = !!team && ROLE_RANK[team.role] >= ROLE_RANK.editor;
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ tag: string; value: string } | null>(null);
  const [merging, setMerging] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo<TagRow[]>(() => {
    const map = new Map<string, TagRow>();
    const bump = (t: string, key: "refs" | "cases") => {
      const row = map.get(t) ?? { tag: t, refs: 0, cases: 0 };
      row[key]++;
      map.set(t, row);
    };
    for (const r of refs) for (const t of r.tags) bump(t, "refs");
    for (const c of cases) for (const t of c.tags) bump(t, "cases");
    // '미분류'는 맨 위에 고정 (정리할 이미지)
    return [...map.values()].sort((a, b) => Number(isUnclassified(b.tag)) - Number(isUnclassified(a.tag)) || b.refs + b.cases - (a.refs + a.cases) || a.tag.localeCompare(b.tag, "ko"));
  }, [refs, cases]);

  const usage = (t: string) => {
    const r = rows.find((x) => x.tag === t);
    return r ? r.refs + r.cases : 0;
  };
  const similar = useMemo(() => similarGroups(rows.map((r) => r.tag)), [rows]);
  const junk = useMemo(() => rows.filter((r) => isBannedTag(r.tag)).map((r) => r.tag), [rows]);
  const shown = rows.filter((r) => !q.trim() || tagKey(r.tag).includes(tagKey(q)));

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      setSelected(new Set());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (t: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  if (loaded && rows.length === 0) {
    return (
      <div className="tags-page">
        <Empty emoji="🏷️" title="아직 태그가 없어요">
          <p>레퍼런스를 저장할 때 키워드를 달면 여기서 한눈에 정리할 수 있어요.</p>
        </Empty>
      </div>
    );
  }

  return (
    <div className="tags-page">
      <div className="docs-head">
        <button className="icon-mini" onClick={() => navigate("library")} aria-label="레퍼런스로 돌아가기">
          <Icon name="chevronLeft" size={20} />
        </button>
        <h2>태그 관리</h2>
        <span className="muted small">
          {rows.length}개 · {team?.name}
        </span>
      </div>

      {canEdit && (similar.length > 0 || junk.length > 0) && (
        <section className="panel tidy">
          <h4>정리 추천</h4>
          {similar.map((group) => {
            const target = [...group].sort((a, b) => usage(b) - usage(a))[0];
            return (
              <div key={group.join("|")} className="tidy-row">
                <span className="tidy-kind">비슷한 태그</span>
                <span className="ref-tags">
                  {group.map((t) => (
                    <span key={t} className={"tag" + (t === target ? " tag-hit" : "")}>
                      {t} <small>{usage(t)}</small>
                    </span>
                  ))}
                </span>
                <span className="spacer" />
                <Button size="sm" disabled={busy} onClick={() => run(`'${target}'(으)로 합쳤어요`, () => mergeTags(group, target))}>
                  &lsquo;{target}&rsquo;(으)로 합치기
                </Button>
              </div>
            );
          })}
          {junk.length > 0 && (
            <div className="tidy-row">
              <span className="tidy-kind">검색에 쓸모없는 태그</span>
              <span className="ref-tags">
                {junk.map((t) => (
                  <span key={t} className="tag">
                    {t} <small>{usage(t)}</small>
                  </span>
                ))}
              </span>
              <span className="spacer" />
              <Button size="sm" variant="danger" disabled={busy} onClick={() => confirm(`태그 ${junk.length}개를 모두 지울까요?`) && run("쓸모없는 태그를 지웠어요", () => deleteTags(junk))}>
                모두 지우기
              </Button>
            </div>
          )}
        </section>
      )}

      <section className="panel">
        <div className="row">
          <div className="search" style={{ flex: 1 }}>
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="태그 찾기" />
          </div>
          {canEdit && selected.size > 0 && (
            <>
              <span className="muted small">{selected.size}개 선택</span>
              <Button disabled={selected.size < 2 || busy} onClick={() => setMerging([...selected])}>
                동의어로 합치기
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => confirm(`선택한 태그 ${selected.size}개를 모든 레퍼런스에서 지울까요?`) && run("태그를 지웠어요", () => deleteTags([...selected]))}>
                삭제
              </Button>
            </>
          )}
        </div>
        <table className="table tags-table">
          <thead>
            <tr>
              {canEdit && <th style={{ width: 32 }} />}
              <th>태그</th>
              <th className="right">레퍼런스</th>
              <th className="right">케이스</th>
              {canEdit && <th className="right" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.tag} className={selected.has(r.tag) ? "on" : ""}>
                {canEdit && (
                  <td>
                    {!isUnclassified(r.tag) && <input type="checkbox" checked={selected.has(r.tag)} onChange={() => toggle(r.tag)} aria-label={`${r.tag} 선택`} />}
                  </td>
                )}
                <td>
                  {editing?.tag === r.tag ? (
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const to = editing.value.trim();
                        if (!to || to === r.tag) return setEditing(null);
                        const exists = rows.some((x) => x.tag !== r.tag && tagKey(x.tag) === tagKey(to));
                        void run(exists ? `'${to}' 태그와 합쳤어요` : "이름을 바꿨어요", () => renameTag(r.tag, to)).then(() => setEditing(null));
                      }}
                    >
                      <input value={editing.value} onChange={(e) => setEditing({ tag: r.tag, value: e.target.value })} autoFocus maxLength={60} />
                      <Button size="sm" type="submit" variant="primary" disabled={busy}>
                        저장
                      </Button>
                      <Button size="sm" onClick={() => setEditing(null)}>
                        취소
                      </Button>
                    </form>
                  ) : isUnclassified(r.tag) ? (
                    <span className="row">
                      <span className="tag tag-unclassified">{r.tag}</span>
                      <span className="muted small">태그 없이 저장한 이미지예요. 태그를 붙이면 자동으로 빠져요.</span>
                    </span>
                  ) : (
                    <span className="tag">{r.tag}</span>
                  )}
                </td>
                <td className="right">{r.refs}</td>
                <td className="right">{r.cases || "—"}</td>
                {canEdit && (
                  <td className="right">
                    {isUnclassified(r.tag) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          sessionStorage.setItem("rb.query", `#${r.tag}`);
                          navigate("library");
                        }}
                      >
                        정리하러 가기
                      </Button>
                    ) : editing?.tag !== r.tag && (
                      <span className="row" style={{ justifyContent: "flex-end" }}>
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ tag: r.tag, value: r.tag })}>
                          이름 변경
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => confirm(`'${r.tag}' 태그를 모든 레퍼런스에서 지울까요?`) && run("태그를 지웠어요", () => deleteTags([r.tag]))}>
                          삭제
                        </Button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="help-text">이름을 이미 있는 태그로 바꾸면 두 태그가 합쳐져요. 대소문자·띄어쓰기만 다른 태그는 &lsquo;정리 추천&rsquo;에 모아 보여줘요.</p>
      </section>

      {merging && (
        <MergeDialog
          tags={merging}
          usage={usage}
          onClose={() => setMerging(null)}
          onMerge={(to) => run(`'${to}'(으)로 합쳤어요`, () => mergeTags(merging, to)).then(() => setMerging(null))}
        />
      )}
    </div>
  );
}

function MergeDialog({ tags, usage, onClose, onMerge }: { tags: string[]; usage: (t: string) => number; onClose: () => void; onMerge: (to: string) => void }) {
  const sorted = [...tags].sort((a, b) => usage(b) - usage(a));
  const [to, setTo] = useState(sorted[0]);
  return (
    <Modal
      title="어떤 이름으로 합칠까요?"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={!to.trim()} onClick={() => onMerge(to.trim())}>
            합치기
          </Button>
        </>
      }
    >
      <div className="merge-list">
        {sorted.map((t) => (
          <label key={t} className={"merge-option" + (to === t ? " on" : "")}>
            <input type="radio" name="merge-to" checked={to === t} onChange={() => setTo(t)} />
            <span className="tag">{t}</span>
            <span className="muted small">{usage(t)}회 사용</span>
          </label>
        ))}
      </div>
      <Field label="또는 새 이름" hint="선택한 태그가 모두 이 이름 하나로 바뀌어요">
        <input value={sorted.includes(to) ? "" : to} onChange={(e) => setTo(e.target.value || sorted[0])} placeholder="예) 팝업스토어" maxLength={60} />
      </Field>
    </Modal>
  );
}
