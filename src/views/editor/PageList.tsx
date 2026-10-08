import { memo, useState } from "react";
import type { DocSettings, Page } from "../../../shared/types";
import { PageView } from "../../components/PageView";
import { Button, Menu, MenuItem } from "../../components/ui";
import { useEditor } from "../../store/editor";
import { addPage, deletePage, duplicatePage, movePage } from "./actions";
import { AssigneeFlag, assignPage, PageViewers, unassignPage, useCanManageAssign } from "./CollabUI";
import { HOVER_SWITCH_MS, useImageDrag } from "./imageDrag";

const Thumb = memo(function Thumb({ page, settings, index, total, title }: { page: Page; settings: DocSettings; index: number; total: number; title: string }) {
  return <PageView page={page} settings={settings} index={index} total={total} mode="thumb" docTitle={title} />;
});

export const KIND_LABEL: Record<Page["kind"], string> = {
  case: "케이스",
  reference: "레퍼런스",
  cover: "표지",
  section: "간지",
  blank: "빈 페이지",
  toc: "목차",
  compare: "비교",
  closing: "마무리",
};

export function PageList() {
  const doc = useEditor((s) => s.doc)!;
  const pageId = useEditor((s) => s.pageId);
  const setPage = useEditor((s) => s.setPage);
  const assignments = useEditor((s) => s.assign.assignments);
  const me = useEditor((s) => s.me);
  const readOnly = useEditor((s) => s.readOnly);
  const onlyMine = useEditor((s) => s.onlyMine);
  const setOnlyMine = useEditor((s) => s.setOnlyMine);
  const canManage = useCanManageAssign();
  const mineCount = doc.pages.filter((p) => assignments[p.id]?.userId === me).length;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  // 캔버스 · 보관함에서 이미지를 끌어 썸네일 위에 올렸을 때
  const imgHover = useImageDrag((s) => (s.hover?.kind === "thumb" ? s.hover : null));

  return (
    <aside className="page-list">
      <div className="page-list-head">
        <strong>페이지 {doc.pages.length}</strong>
        <Menu
          align="left"
          trigger={(open) => <Button icon="plus" size="sm" onClick={open} aria-label="페이지 추가" />}
        >
          {(close) => (
            <>
              <MenuItem icon="grid" hint="짧은 글 + 이미지" onClick={() => (close(), addPage("reference"))}>
                레퍼런스
              </MenuItem>
              <MenuItem icon="sidebar" hint="긴 글 + 로고" onClick={() => (close(), addPage("case"))}>
                케이스 스터디
              </MenuItem>
              <MenuItem icon="file" hint="가운데 제목" onClick={() => (close(), addPage("cover"))}>
                표지
              </MenuItem>
              <MenuItem icon="heading" hint="섹션 구분" onClick={() => (close(), addPage("section"))}>
                간지
              </MenuItem>
              <MenuItem icon="compare" hint="경쟁사·상품 2~4개 나란히" onClick={() => (close(), addPage("compare"))}>
                경쟁사·상품 비교
              </MenuItem>
              <MenuItem icon="listNum" hint="간지로 자동 작성" onClick={() => (close(), addPage("toc"))}>
                목차
              </MenuItem>
              <MenuItem icon="flag" hint="감사 인사 · 연락처" onClick={() => (close(), addPage("closing"))}>
                마무리
              </MenuItem>
              <MenuItem icon="rect" onClick={() => (close(), addPage("blank"))}>
                빈 페이지
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      {(mineCount > 0 || onlyMine) && (
        <label className="page-filter">
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          내가 맡은 페이지만 ({mineCount})
        </label>
      )}
      <div className="page-list-scroll">
        {onlyMine && mineCount === 0 && <p className="muted small page-filter-empty">맡은 페이지가 없어요</p>}
        {doc.pages.map((p, i) => (onlyMine && assignments[p.id]?.userId !== me ? null : (
          <div
            key={p.id}
            className={
              "page-item" +
              (p.id === pageId ? " on" : "") +
              (overIdx === i && dragId && dragId !== p.id ? " drop" : "") +
              (imgHover?.pageId === p.id ? " img-drop" + (imgHover.switching ? " switching" : "") : "")
            }
            data-page-drop={p.id}
            draggable
            onDragStart={(e) => {
              setDragId(p.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverIdx(i);
            }}
            onDragEnd={() => {
              setDragId(null);
              setOverIdx(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== p.id) movePage(dragId, i);
              setDragId(null);
              setOverIdx(null);
            }}
            onClick={() => setPage(p.id)}
          >
            <span className="page-num">{i + 1}</span>
            <div className="page-thumb">
              <Thumb page={p} settings={doc.settings} index={i} total={doc.pages.length} title={doc.title} />
              {/* 썸네일 위에 그려지도록 뒤에 둔다 */}
              <AssigneeFlag pageId={p.id} />
              <PageViewers pageId={p.id} />
              {imgHover?.pageId === p.id && (
                <span className="thumb-drop-hint">
                  놓으면 이 페이지로
                  {imgHover.switching && <i className="switch-progress" style={{ animationDuration: `${HOVER_SWITCH_MS}ms` }} />}
                </span>
              )}
            </div>
            <div className="page-item-meta">
              <span className="ellipsis">{p.group || KIND_LABEL[p.kind]}</span>
              <Menu
                align="left"
                trigger={(open) => (
                  <button
                    className="icon-mini"
                    onClick={(e) => {
                      e.stopPropagation();
                      open();
                    }}
                    aria-label="페이지 메뉴"
                  >
                    ⋯
                  </button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem icon="copy" onClick={() => (close(), duplicatePage(p.id))}>
                      페이지 복제
                    </MenuItem>
                    <MenuItem icon="up" disabled={i === 0} onClick={() => (close(), movePage(p.id, i - 1))}>
                      위로
                    </MenuItem>
                    <MenuItem icon="down" disabled={i === doc.pages.length - 1} onClick={() => (close(), movePage(p.id, i + 1))}>
                      아래로
                    </MenuItem>
                    <MenuItem icon="plus" onClick={() => (close(), addPage("reference", i))}>
                      아래에 페이지 추가
                    </MenuItem>
                    <MenuItem icon="trash" disabled={doc.pages.length <= 1} onClick={() => (close(), deletePage(p.id))}>
                      페이지 삭제
                    </MenuItem>
                    {!readOnly && <div className="menu-sep" />}
                    {!readOnly && !assignments[p.id] && (
                      <MenuItem icon="flag" onClick={() => (close(), void assignPage(p.id))}>
                        이 페이지 맡기
                      </MenuItem>
                    )}
                    {!readOnly && assignments[p.id] && (assignments[p.id].userId === me || canManage) && (
                      <MenuItem icon="flag" onClick={() => (close(), void unassignPage(p.id))}>
                        {assignments[p.id].userId === me ? "맡기 해제" : `맡기 해제 (${assignments[p.id].name}님)`}
                      </MenuItem>
                    )}
                    {!readOnly && assignments[p.id] && assignments[p.id].userId !== me && !canManage && (
                      <MenuItem icon="flag" disabled onClick={() => undefined}>
                        {assignments[p.id].name}님이 맡은 페이지
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            </div>
          </div>
        )))}
      </div>
    </aside>
  );
}
