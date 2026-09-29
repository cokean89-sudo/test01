import { useEffect, useMemo, useState } from "react";
import { ROLE_RANK, type Reference } from "../../shared/types";
import { api } from "../api";
import { Icon } from "../components/icons";
import { MatchAllCheck } from "../components/MatchAllCheck";
import { SmartImage } from "../components/SmartImage";
import { UpdatesCard } from "../components/Updates";
import { Button, Empty, Menu, MenuItem, Modal, Segmented, Select, TagInput } from "../components/ui";
import { groupHits } from "../layout/autobuild";
import { navigate } from "../lib/router";
import { matchSummary, noMatchHint, noMatchMessage, norm, parseQuery, searchRefs, tagCounts, type MatchMode, type SortKey } from "../lib/search";
import { tagVocabulary, useLibrary } from "../store/library";
import { useCurrentTeam } from "../store/session";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";
import { extractUrls } from "./CollectDialog";
import { RefDetail } from "./RefDetail";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "관련도순" },
  { value: "newest", label: "최신순" },
  { value: "oldest", label: "오래된순" },
  { value: "title", label: "제목순" },
  { value: "ratio", label: "가로형 → 세로형" },
];

export function LibraryView() {
  const { refs, cases, loaded, bulk, renameTag, updateRef } = useLibrary();
  const { openCollect, openBuild, focusRef, setFocusRef } = useUI();
  const team = useCurrentTeam();
  const canEdit = !!team && ROLE_RANK[team.role] >= ROLE_RANK.editor;
  const isAdmin = !!team && ROLE_RANK[team.role] >= ROLE_RANK.admin;
  const [query, setQuery] = useState(() => sessionStorage.getItem("rb.query") ?? "");
  const [mode, setMode] = useState<MatchMode>("or");
  const [sort, setSort] = useState<SortKey>("relevance");
  const [view, setView] = useState<"grid" | "groups">("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulkTag, setBulkTag] = useState<"add" | "remove" | null>(null);

  useEffect(() => sessionStorage.setItem("rb.query", query), [query]);

  const hits = useMemo(() => searchRefs(refs, cases, query, mode, sort), [refs, cases, query, mode, sort]);
  const tags = useMemo(() => tagCounts(refs), [refs]);
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);
  const groups = useMemo(() => (view === "groups" ? groupHits(hits, cases, query, "tag", 1) : []), [view, hits, cases, query]);
  const caseName = useMemo(() => new Map(cases.map((c) => [c.id, c.name])), [cases]);
  const activeTerms = useMemo(() => new Set(parseQuery(query).map((t) => t.text)), [query]);

  // 페이지 아무 곳에서나 링크 붙여넣기 → 추가 창
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      // 입력 칸이나 다른 창(의견 보내기 등)이 열려 있으면 그쪽 붙여넣기에 맡긴다
      if (t.closest("input, textarea, [contenteditable]") || document.querySelector(".modal-backdrop")) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (extractUrls(text).length) {
        e.preventDefault();
        openCollect(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openCollect]);

  const toggleTerm = (tag: string) => {
    const terms = parseQuery(query);
    const exists = terms.some((t) => t.text === norm(tag));
    const token = /\s/.test(tag) ? `"${tag}"` : tag;
    setQuery(exists ? terms.filter((t) => t.text !== norm(tag)).map((t) => (t.exclude ? "-" : "") + (t.exact ? "#" : "") + t.text).join(" ") : (query.trim() + " " + token).trim());
  };

  const toggleSelect = (id: string, range?: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && prev.size) {
        const ids = hits.map((h) => h.ref.id);
        const last = [...prev].pop()!;
        const [a, b] = [ids.indexOf(last), ids.indexOf(id)].sort((x, y) => x - y);
        ids.slice(a, b + 1).forEach((x) => next.add(x));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selIds = [...selected];
  const openRef = refs.find((r) => r.id === openId) ?? null;

  // 중복 알림에서 '편집'을 누르면 해당 레퍼런스 상세를 연다
  useEffect(() => {
    if (focusRef && refs.some((r) => r.id === focusRef)) {
      setOpenId(focusRef);
      setFocusRef(null);
    }
  }, [focusRef, refs, setFocusRef]);

  const card = (ref: Reference) => (
    <RefCard
      key={ref.id}
      ref_={ref}
      caseName={ref.caseId ? caseName.get(ref.caseId) : undefined}
      selected={selected.has(ref.id)}
      activeTerms={activeTerms}
      onToggle={(range) => toggleSelect(ref.id, range)}
      onOpen={() => setOpenId(ref.id)}
      onNatural={(w, h) => {
        if (!ref.width || !ref.height) void updateRef(ref.id, { width: w, height: h });
      }}
    />
  );

  return (
    <div className="library">
      <aside className="sidebar">
        <section>
          <h4 className="sidebar-title">
            태그
            <a className="link-btn blue" href="#/tags">
              관리
            </a>
          </h4>
          {tags.length === 0 && <p className="muted small">아직 태그가 없어요.</p>}
          <ul className="tag-list">
            {tags.map(({ tag, count }) => (
              <li key={tag} className={activeTerms.has(norm(tag)) ? "on" : ""}>
                <button className="tag-list-name" onClick={() => toggleTerm(tag)}>
                  <Icon name="tag" size={13} /> {tag}
                </button>
                <span className="count">{count}</span>
                {canEdit && <Menu
                  align="right"
                  trigger={(open) => (
                    <button className="icon-mini" onClick={open} aria-label="태그 메뉴">
                      <Icon name="dots" size={14} />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        onClick={async () => {
                          close();
                          const to = prompt(`'${tag}' 태그의 새 이름 (기존 태그 이름을 입력하면 병합돼요)`, tag);
                          if (to && to !== tag) await renameTag(tag, to);
                        }}
                      >
                        이름 변경 / 병합
                      </MenuItem>
                      <MenuItem
                        icon="trash"
                        onClick={async () => {
                          close();
                          if (confirm(`'${tag}' 태그를 모든 레퍼런스에서 삭제할까요?`)) await renameTag(tag, "");
                        }}
                      >
                        태그 삭제
                      </MenuItem>
                    </>
                  )}
                </Menu>}
              </li>
            ))}
          </ul>
        </section>
        {cases.length > 0 && (
          <section>
            <h4>케이스</h4>
            <ul className="tag-list">
              {cases.map((c) => (
                <li key={c.id} className={activeTerms.has(norm(c.name)) ? "on" : ""}>
                  <button className="tag-list-name" onClick={() => toggleTerm(c.name)}>
                    <Icon name="folder" size={13} /> {c.name}
                  </button>
                  <span className="count">{refs.filter((r) => r.caseId === c.id).length}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <UpdatesCard />
        {isAdmin && <section className="sidebar-foot">
          <a className="link-btn" href={api.backupUrl()}>
            <Icon name="download" size={13} /> 팀 백업 내려받기
          </a>
          <label className="link-btn">
            <Icon name="upload" size={13} /> 백업 가져오기
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const data = JSON.parse(await file.text());
                  const r = await api.importBackup(data);
                  await useLibrary.getState().load();
                  toast.success(`가져오기 완료 — 레퍼런스 ${r.references} · 케이스 ${r.cases} · 문서 ${r.documents}`);
                } catch (err) {
                  toast.error("가져오기 실패: " + (err as Error).message);
                }
                e.target.value = "";
              }}
            />
          </label>
        </section>}
      </aside>

      <section className="library-main">
        <div className="library-toolbar">
          <div className="search">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='키워드 검색 — 예) 팝업스토어 패키지   #경쟁사   "매장 사인"   -로고'
            />
            {query && (
              <button className="icon-mini" onClick={() => setQuery("")} aria-label="검색어 지우기">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>
          <MatchAllCheck query={query} mode={mode} onChange={setMode} />
          <Select value={sort} onChange={setSort} options={SORTS} />
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "전체" },
              { value: "groups", label: "태그별 그룹" },
            ]}
          />
          <Button icon="sparkle" variant="accent" onClick={() => openBuild({ query, matchMode: mode })} disabled={!hits.length}>
            이 결과로 문서 만들기
          </Button>
        </div>

        {selected.size > 0 && canEdit && (
          <div className="bulk-bar">
            <strong>{selected.size}개 선택</strong>
            <Button size="sm" icon="tag" onClick={() => setBulkTag("add")}>
              태그 추가
            </Button>
            <Button size="sm" onClick={() => setBulkTag("remove")}>
              태그 제거
            </Button>
            <select
              className="sm"
              value=""
              onChange={async (e) => {
                const v = e.target.value;
                if (!v) return;
                await bulk({ ids: selIds, caseId: v === "__none" ? null : v });
                toast.success("케이스 지정 완료");
              }}
            >
              <option value="">케이스 지정…</option>
              <option value="__none">(케이스 해제)</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={() => bulk({ ids: selIds, kind: "logo" })}>
              로고로
            </Button>
            <Button size="sm" onClick={() => bulk({ ids: selIds, kind: "image" })}>
              이미지로
            </Button>
            <Button size="sm" icon="sparkle" variant="accent" onClick={() => openBuild({ refIds: selIds, query: "" })}>
              선택으로 문서 만들기
            </Button>
            <Button
              size="sm"
              icon="trash"
              variant="danger"
              onClick={async () => {
                if (!confirm(`${selected.size}개 레퍼런스를 삭제할까요? (문서에 이미 배치된 이미지는 유지돼요)`)) return;
                await bulk({ ids: selIds, delete: true });
                setSelected(new Set());
              }}
            >
              삭제
            </Button>
            <span className="spacer" />
            <button className="link-btn" onClick={() => setSelected(new Set(hits.map((h) => h.ref.id)))}>
              결과 전체 선택
            </button>
            <button className="link-btn" onClick={() => setSelected(new Set())}>
              선택 해제
            </button>
          </div>
        )}

        <div className="library-scroll">
          {loaded && refs.length === 0 ? (
            <div className="onboard">
              <div className="onboard-head">
                <h2>
                  첫 레퍼런스를 모아볼까요?
                  <br />
                  링크만 붙여넣으면 돼요
                </h2>
                <p>핀터레스트·웹페이지·이미지 링크를 키워드와 함께 저장해 두면, 키워드 하나로 보고서 문서까지 바로 만들 수 있어요.</p>
              </div>
              <div className="onboard-steps">
                <div className="onboard-step">
                  <span className="step-no">1</span>
                  <strong>링크 붙여넣기</strong>
                  <span>핀터레스트 핀의 공유 → 링크 복사, 또는 이미지 우클릭 → 이미지 주소 복사</span>
                </div>
                <div className="onboard-step">
                  <span className="step-no">2</span>
                  <strong>키워드 달기</strong>
                  <span>#팝업스토어 #패키지 #경쟁사 처럼 나중에 찾을 말을 달아 두세요</span>
                </div>
                <div className="onboard-step">
                  <span className="step-no">3</span>
                  <strong>문서로 만들기</strong>
                  <span>키워드를 넣으면 태그별로 묶어 A4 보고서 페이지를 만들어요</span>
                </div>
              </div>
              <div className="onboard-actions">
                {canEdit && (
                  <Button size="lg" variant="primary" icon="plus" onClick={() => openCollect()}>
                    레퍼런스 추가하기
                  </Button>
                )}
                <Button size="lg" icon="bulb" onClick={() => navigate("guide")}>
                  사용 가이드 보기
                </Button>
              </div>
            </div>
          ) : hits.length === 0 ? (
            <Empty emoji="🔍" title={noMatchMessage(query, mode)}>
              <p className="muted">{noMatchHint(query, mode)}</p>
            </Empty>
          ) : view === "grid" ? (
            <>
              <p className="result-meta">{matchSummary(query, mode, hits.length)}</p>
              <div className="masonry">{hits.map((h) => card(h.ref))}</div>
            </>
          ) : (
            <>
            <p className="result-meta">{matchSummary(query, mode, hits.length)}</p>
            {groups.map((g) => (
              <section key={g.key} className="group-section">
                <header>
                  <h3>{g.label}</h3>
                  <span className="count">{g.refs.length + g.logos.length}</span>
                  <button
                    className="link-btn"
                    onClick={() => setSelected(new Set([...selected, ...g.refs.map((r) => r.id), ...g.logos.map((r) => r.id)]))}
                  >
                    그룹 선택
                  </button>
                </header>
                <div className="masonry">{[...g.logos, ...g.refs].map(card)}</div>
              </section>
            ))}
            </>
          )}
        </div>
      </section>

      {openRef && <RefDetail ref_={openRef} readOnly={!canEdit} onClose={() => setOpenId(null)} />}

      {bulkTag && (
        <BulkTagDialog
          mode={bulkTag}
          vocab={vocab}
          onClose={() => setBulkTag(null)}
          onApply={async (list) => {
            await bulk(bulkTag === "add" ? { ids: selIds, addTags: list } : { ids: selIds, removeTags: list });
            setBulkTag(null);
            toast.success(bulkTag === "add" ? "태그를 추가했어요" : "태그를 제거했어요");
          }}
        />
      )}
    </div>
  );
}

function RefCard({
  ref_: ref,
  caseName,
  selected,
  activeTerms,
  onToggle,
  onOpen,
  onNatural,
}: {
  ref_: Reference;
  caseName?: string;
  selected: boolean;
  activeTerms: Set<string>;
  onToggle: (range: boolean) => void;
  onOpen: () => void;
  onNatural: (w: number, h: number) => void;
}) {
  const ratio = ref.width && ref.height ? ref.height / ref.width : undefined;
  return (
    <figure className={"ref-card" + (selected ? " selected" : "")}>
      <div
        className="ref-thumb"
        style={{ aspectRatio: ratio ? `${1} / ${ratio}` : undefined, background: ref.kind === "logo" ? "#fff" : undefined }}
        onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? onToggle(e.shiftKey) : onOpen())}
      >
        <SmartImage src={ref.imageUrl} fit={ref.kind === "logo" ? "contain" : "cover"} onNatural={onNatural} />
        <button
          className="ref-check"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(e.shiftKey);
          }}
          aria-label="선택"
        >
          {selected ? "✓" : ""}
        </button>
        {ref.kind === "logo" && <span className="badge badge-float">LOGO</span>}
      </div>
      <figcaption>
        {ref.title && <div className="ref-title ellipsis">{ref.title}</div>}
        <div className="ref-tags">
          {caseName && <span className="tag tag-case">{caseName}</span>}
          {ref.tags.slice(0, 5).map((t) => (
            <span key={t} className={"tag tag-sm" + (activeTerms.has(norm(t)) ? " tag-hit" : "")}>
              {t}
            </span>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}

function BulkTagDialog({ mode, vocab, onClose, onApply }: { mode: "add" | "remove"; vocab: string[]; onClose: () => void; onApply: (tags: string[]) => void }) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <Modal
      title={mode === "add" ? "선택 항목에 태그 추가" : "선택 항목에서 태그 제거"}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={!tags.length} onClick={() => onApply(tags)}>
            적용
          </Button>
        </>
      }
    >
      <TagInput value={tags} onChange={setTags} suggestions={vocab} autoFocus />
      <div className="tag-suggest" style={{ marginTop: 10 }}>
        {vocab
          .filter((t) => !tags.includes(t))
          .slice(0, 20)
          .map((t) => (
            <button key={t} className="tag tag-ghost" onClick={() => setTags([...tags, t])}>
              + {t}
            </button>
          ))}
      </div>
    </Modal>
  );
}
