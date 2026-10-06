import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isUnclassified, UNCLASSIFIED } from "../../shared/tags";
import { ROLE_RANK, type Reference } from "../../shared/types";
import { api } from "../api";
import { Icon } from "../components/icons";
import { MatchAllCheck } from "../components/MatchAllCheck";
import { SmartImage } from "../components/SmartImage";
import { UpdatesCard } from "../components/Updates";
import { UploadHero } from "../components/UploadHero";
import { Button, Empty, Menu, MenuItem, Modal, Segmented, Select, TagInput } from "../components/ui";
import { groupHits } from "../layout/autobuild";
import { imageFilesFrom } from "../lib/uploads";
import { matchSummary, noMatchHint, noMatchMessage, norm, parseQuery, searchRefs, tagCounts, type MatchMode, type SortKey, type Term } from "../lib/search";
import { tagVocabulary, useLibrary } from "../store/library";
import { useCurrentTeam } from "../store/session";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";
import { extractUrls } from "./CollectDialog";
import { confirmRefDelete } from "./confirmRefDelete";
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
  const libraryReset = useUI((s) => s.library.reset);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Shift+클릭 범위 선택의 기준점 */
  const anchor = useRef<string | null>(null);

  useEffect(() => sessionStorage.setItem("rb.query", query), [query]);

  // 로고를 누르면 첫 화면으로 — 검색어 · 태그 · 정렬 · 선택 초기화. 방금 저장한 이미지가 있으면 그것들을 선택해서 보여 준다
  const mountedReset = useRef(libraryReset);
  useEffect(() => {
    const showIds = useUI.getState().library.showIds;
    // 다른 화면에서 돌아올 때는 저장해 둔 검색어를 살린다 (로고 · '라이브러리에서 보기'로 온 경우만 초기화)
    if (libraryReset === mountedReset.current && !showIds) return;
    setQuery("");
    setMode("or");
    setView("grid");
    setSort(showIds ? "newest" : "relevance");
    setSelected(new Set(showIds ?? []));
    anchor.current = null;
    scrollRef.current?.scrollTo({ top: 0 });
    if (showIds) useUI.setState((s) => ({ library: { ...s.library, showIds: null } }));
  }, [libraryReset]);

  const hits = useMemo(() => searchRefs(refs, cases, query, mode, sort), [refs, cases, query, mode, sort]);
  const tags = useMemo(() => tagCounts(refs), [refs]);
  const vocab = useMemo(() => tagVocabulary(refs), [refs]);
  const groups = useMemo(() => (view === "groups" ? groupHits(hits, cases, query, "tag", 1) : []), [view, hits, cases, query]);
  const caseName = useMemo(() => new Map(cases.map((c) => [c.id, c.name])), [cases]);
  const activeTerms = useMemo(() => new Set(parseQuery(query).map((t) => t.text)), [query]);

  // 페이지 아무 곳에서나 링크 · 스크린샷 붙여넣기 → 추가 창
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      // 입력 칸이나 다른 창(의견 보내기 등)이 열려 있으면 그쪽 붙여넣기에 맡긴다
      if (t?.closest?.("input, textarea, [contenteditable]") || document.querySelector(".modal-backdrop")) return;
      if (!canEdit) return;
      const files = imageFilesFrom(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        openCollect(undefined, files);
        return;
      }
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (extractUrls(text).length) {
        e.preventDefault();
        openCollect(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [openCollect, canEdit]);

  const toggleTerm = (tag: string) => {
    const terms = parseQuery(query);
    const exists = terms.some((t) => t.text === norm(tag));
    const token = /\s/.test(tag) ? `"${tag}"` : tag;
    setQuery(exists ? terms.filter((t) => t.text !== norm(tag)).map((t) => (t.exclude ? "-" : "") + (t.exact ? "#" : "") + t.text).join(" ") : (query.trim() + " " + token).trim());
  };

  /** 고른 태그 · 케이스 이름 (검색어 중 태그 · 케이스와 같은 것) */
  const tagNames = useMemo(() => new Set([norm(UNCLASSIFIED), ...tags.map((t) => norm(t.tag)), ...cases.map((c) => norm(c.name))]), [tags, cases]);
  const activeTags = useMemo(
    () => [UNCLASSIFIED, ...tags.map((t) => t.tag), ...cases.map((c) => c.name)].filter((name, i, all) => activeTerms.has(norm(name)) && all.findIndex((x) => norm(x) === norm(name)) === i),
    [tags, cases, activeTerms],
  );
  /** 태그 · 케이스 선택만 모두 풀고, 직접 입력한 검색어는 남긴다 */
  const clearTags = () => setQuery(parseQuery(query).filter((t) => t.exclude || !tagNames.has(t.text)).map(termToken).join(" "));

  /** 화면에 보이는 순서 (Shift 범위 선택 기준) */
  const visibleIds = useMemo(
    () => (view === "grid" ? hits.map((h) => h.ref.id) : groups.flatMap((g) => [...g.logos, ...g.refs].map((r) => r.id))),
    [view, hits, groups],
  );

  /** ⌘/Ctrl+클릭 = 하나씩 추가 · 빼기, Shift+클릭 = 기준점부터 범위 */
  const toggleSelect = (id: string, range?: boolean) => {
    const next = new Set(selected);
    const a = range && anchor.current ? visibleIds.indexOf(anchor.current) : -1;
    const b = visibleIds.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [from, to] = a < b ? [a, b] : [b, a];
      visibleIds.slice(from, to + 1).forEach((x) => next.add(x));
    } else {
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchor.current = id;
    }
    setSelected(next);
  };
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);

  // Esc = 선택 해제 (열린 창 · 상세 · 메뉴가 있으면 그쪽 Esc 에 맡긴다)
  useEffect(() => {
    if (!selected.size) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".modal-backdrop, .drawer, .menu")) return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]")) return;
      clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.size, clearSelection]);

  const marquee = useMarquee(scrollRef, canEdit, selected, setSelected);

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
      selectable={canEdit}
      activeTerms={activeTerms}
      onToggle={(range) => !marquee.justDragged() && toggleSelect(ref.id, range)}
      onOpen={() => !marquee.justDragged() && setOpenId(ref.id)}
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
            <span className="sidebar-title-actions">
              {activeTags.length > 0 && (
                <button className="link-btn" onClick={clearTags}>
                  모두 해제
                </button>
              )}
              <a className="link-btn blue" href="#/tags">
                관리
              </a>
            </span>
          </h4>
          {tags.length === 0 && <p className="muted small">아직 태그가 없어요.</p>}
          <ul className="tag-list">
            {tags.map(({ tag, count }) => (
              <li key={tag} className={(activeTerms.has(norm(tag)) ? "on" : "") + (isUnclassified(tag) ? " unclassified" : "")}>
                <button className="tag-list-name" onClick={() => toggleTerm(tag)} title={isUnclassified(tag) ? "태그 없이 저장한 이미지 — 태그를 붙이면 자동으로 빠져요" : undefined}>
                  <Icon name={isUnclassified(tag) ? "flag" : "tag"} size={13} /> {tag}
                </button>
                <span className="count">{count}</span>
                {canEdit && !isUnclassified(tag) && <Menu
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
                  if (r.skipped) toast.error(`다른 팀에 올린 이미지 ${r.skipped}개는 파일이 없어 가져오지 않았어요`);
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

        <div
          className={"library-scroll" + (marquee.box ? " marquee-active" : "")}
          ref={scrollRef}
          onPointerDown={marquee.onPointerDown}
          onPointerMove={marquee.onPointerMove}
          onPointerUp={marquee.onPointerUp}
          onPointerCancel={marquee.onPointerUp}
        >
          {marquee.box && <div className="marquee" style={{ left: marquee.box.x, top: marquee.box.y, width: marquee.box.w, height: marquee.box.h }} />}
          {tags.length > 0 && (
            <div className="tag-strip" aria-label="태그">
              {tags.slice(0, 40).map(({ tag, count }) => (
                <button key={tag} className={"tag" + (activeTerms.has(norm(tag)) ? " tag-hit" : "") + (isUnclassified(tag) ? " tag-unclassified" : "")} onClick={() => toggleTerm(tag)}>
                  {tag} <small>{count}</small>
                </button>
              ))}
            </div>
          )}
          {loaded && refs.length > 0 && !query.trim() && canEdit && <UploadHero compact canEdit={canEdit} />}
          {activeTags.length > 0 && (
            <div className="active-filters">
              <span className="muted small">선택한 태그</span>
              {activeTags.map((t) => (
                <button key={t} className="tag tag-hit" onClick={() => toggleTerm(t)} aria-label={`${t} 해제`}>
                  {t} <Icon name="x" size={11} />
                </button>
              ))}
              <button className="link-btn blue" onClick={clearTags}>
                모두 해제
              </button>
            </div>
          )}
          {loaded && refs.length === 0 ? (
            <UploadHero compact={false} canEdit={canEdit} />
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
        {selected.size > 0 && canEdit && (
          <SelectionBar
            count={selected.size}
            cases={cases}
            onAddTags={() => setBulkTag("add")}
            onRemoveTags={() => setBulkTag("remove")}
            onCase={async (v) => {
              await bulk({ ids: selIds, caseId: v === "__none" ? null : v });
              toast.success(v === "__none" ? "케이스를 해제했어요" : "케이스를 지정했어요");
            }}
            onKind={(kind) => bulk({ ids: selIds, kind })}
            onBuild={() => openBuild({ refIds: selIds, query: "" })}
            onDelete={async () => {
              if (!(await confirmRefDelete(selIds, `레퍼런스 ${selected.size}개`))) return;
              await bulk({ ids: selIds, delete: true });
              clearSelection();
            }}
            onSelectAll={() => setSelected(new Set(visibleIds))}
            onClear={clearSelection}
          />
        )}
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
  selectable,
  activeTerms,
  onToggle,
  onOpen,
  onNatural,
}: {
  ref_: Reference;
  caseName?: string;
  selected: boolean;
  selectable: boolean;
  activeTerms: Set<string>;
  onToggle: (range: boolean) => void;
  onOpen: () => void;
  onNatural: (w: number, h: number) => void;
}) {
  const ratio = ref.width && ref.height ? ref.height / ref.width : undefined;
  return (
    <figure className={"ref-card" + (selected ? " selected" : "")} data-id={ref.id}>
      <div
        className="ref-thumb"
        style={{ aspectRatio: ratio ? `${1} / ${ratio}` : undefined, background: ref.kind === "logo" ? "var(--color-white)" : undefined }}
        onClick={(e) => (selectable && (e.metaKey || e.ctrlKey || e.shiftKey) ? onToggle(e.shiftKey) : onOpen())}
      >
        <SmartImage src={ref.thumbUrl ?? ref.imageUrl} fit={ref.kind === "logo" ? "contain" : "cover"} onNatural={ref.thumbUrl ? undefined : onNatural} />
        {ref.fileId && (
          <span className="stored-badge" title={ref.originalUrl ? "링크 이미지의 사본을 서버에 저장했어요" : "서버에 올린 이미지"}>
            <Icon name={ref.originalUrl ? "copy" : "upload"} size={11} />
          </span>
        )}
        {selectable && (
          <button
            className="ref-check"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(e.shiftKey);
            }}
            role="checkbox"
            aria-checked={selected}
            aria-label="선택"
          >
            {selected ? "✓" : ""}
          </button>
        )}
        {ref.kind === "logo" && <span className="badge badge-float">LOGO</span>}
      </div>
      <figcaption>
        {ref.title && <div className="ref-title ellipsis">{ref.title}</div>}
        <div className="ref-tags">
          {caseName && <span className="tag tag-case">{caseName}</span>}
          {ref.tags.slice(0, 5).map((t) => (
            <span key={t} className={"tag tag-sm" + (activeTerms.has(norm(t)) ? " tag-hit" : "") + (isUnclassified(t) ? " tag-unclassified" : "")}>
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

/** 선택했을 때 화면 아래에 뜨는 액션 바 */
function SelectionBar({
  count,
  cases,
  onAddTags,
  onRemoveTags,
  onCase,
  onKind,
  onBuild,
  onDelete,
  onSelectAll,
  onClear,
}: {
  count: number;
  cases: { id: string; name: string }[];
  onAddTags: () => void;
  onRemoveTags: () => void;
  onCase: (caseId: string) => void;
  onKind: (kind: "image" | "logo") => void;
  onBuild: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="selection-bar" role="toolbar" aria-label="선택한 레퍼런스">
      <strong className="selection-count">{count}개 선택</strong>
      <Button size="sm" icon="tag" onClick={onAddTags} aria-label="태그 추가">
        <span className="sel-label">태그 추가</span>
      </Button>
      <select
        className="sm"
        value=""
        aria-label="케이스 지정"
        onChange={(e) => {
          if (e.target.value) onCase(e.target.value);
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
      <Button size="sm" icon="sparkle" variant="accent" onClick={onBuild} aria-label="문서 만들기">
        <span className="sel-label">문서 만들기</span>
      </Button>
      <Button size="sm" icon="trash" variant="danger" onClick={onDelete} aria-label="삭제">
        <span className="sel-label">삭제</span>
      </Button>
      <Menu align="right" trigger={(open) => <Button size="sm" icon="dots" onClick={open} aria-label="더보기" />}>
        {(close) => (
          <>
            <MenuItem onClick={() => (close(), onRemoveTags())}>태그 제거</MenuItem>
            <MenuItem onClick={() => (close(), onKind("logo"))}>로고로 바꾸기</MenuItem>
            <MenuItem onClick={() => (close(), onKind("image"))}>이미지로 바꾸기</MenuItem>
            <MenuItem onClick={() => (close(), onSelectAll())}>보이는 결과 전체 선택</MenuItem>
          </>
        )}
      </Menu>
      <button className="selection-clear" onClick={onClear} title="선택 해제 (Esc)" aria-label="선택 해제">
        <Icon name="x" size={14} /> <span className="sel-label">선택 해제</span>
      </button>
    </div>
  );
}

/**
 * 마우스로 끌어 영역 선택(마키). 빈 곳에서 시작해야 하고, Shift · ⌘/Ctrl 을 누른 채 시작하면 기존 선택에 더한다.
 * 화면 끝 가까이 끌면 저절로 스크롤된다. 빈 곳을 그냥 누르면 선택이 풀린다.
 */
function useMarquee(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  selected: Set<string>,
  setSelected: (s: Set<string>) => void,
) {
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drag = useRef<{ x0: number; y0: number; cx: number; cy: number; base: Set<string>; active: boolean; additive: boolean } | null>(null);
  const dragged = useRef(0);
  const raf = useRef(0);

  const update = () => {
    const d = drag.current;
    const el = scrollRef.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const x = d.cx - r.left + el.scrollLeft;
    const y = d.cy - r.top + el.scrollTop;
    if (!d.active && Math.hypot(x - d.x0, y - d.y0) < 6) return;
    if (!d.active) {
      d.active = true;
      const tick = () => {
        const dd = drag.current;
        const sc = scrollRef.current;
        if (!dd?.active || !sc) return;
        const rr = sc.getBoundingClientRect();
        const dy = dd.cy > rr.bottom - 40 ? 14 : dd.cy < rr.top + 40 ? -14 : 0;
        if (dy) {
          sc.scrollTop += dy;
          update();
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }
    const b = { x: Math.min(x, d.x0), y: Math.min(y, d.y0), w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) };
    setBox(b);
    const left = b.x - el.scrollLeft + r.left;
    const top = b.y - el.scrollTop + r.top;
    const hit = new Set(d.base);
    el.querySelectorAll<HTMLElement>(".ref-card[data-id]").forEach((card) => {
      const c = card.getBoundingClientRect();
      if (c.right > left && c.left < left + b.w && c.bottom > top && c.top < top + b.h) hit.add(card.dataset.id!);
    });
    setSelected(hit);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0 || e.pointerType !== "mouse") return;
    const t = e.target as HTMLElement;
    if (t.closest(".ref-card, button, a, input, select, textarea, label, .upload-hero, .tag-strip, .active-filters, .group-section header")) return;
    const el = scrollRef.current;
    if (!el) return;
    // 스크롤 막대를 잡은 경우는 제외
    if (e.clientX > el.getBoundingClientRect().left + el.clientWidth) return;
    const r = el.getBoundingClientRect();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    drag.current = { x0: e.clientX - r.left + el.scrollLeft, y0: e.clientY - r.top + el.scrollTop, cx: e.clientX, cy: e.clientY, base: additive ? new Set(selected) : new Set(), active: false, additive };
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.cx = e.clientX;
    d.cy = e.clientY;
    update();
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    cancelAnimationFrame(raf.current);
    setBox(null);
    if (!d) return;
    if (d.active) dragged.current = Date.now();
    else if (!d.additive && selected.size) setSelected(new Set());
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return {
    box,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    /** 방금 끌기를 끝낸 경우 — 손을 뗀 자리의 클릭(상세 열기)을 무시한다 */
    justDragged: () => Date.now() - dragged.current < 250,
  };
}

/** 검색어 하나를 다시 문자열로 (띄어쓰기가 있으면 따옴표) */
function termToken(t: Term): string {
  const text = /\s/.test(t.text) ? `"${t.text}"` : t.text;
  return (t.exclude ? "-" : "") + (t.exact ? "#" : "") + text;
}
