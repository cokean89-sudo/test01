import { memo, useState } from "react";
import type { DocSettings, Page } from "../../../shared/types";
import { PageView } from "../../components/PageView";
import { Button, Menu, MenuItem } from "../../components/ui";
import { useEditor } from "../../store/editor";
import { addPage, deletePage, duplicatePage, movePage } from "./actions";

const Thumb = memo(function Thumb({ page, settings, index, total, title }: { page: Page; settings: DocSettings; index: number; total: number; title: string }) {
  return <PageView page={page} settings={settings} index={index} total={total} mode="thumb" docTitle={title} />;
});

const KIND_LABEL: Record<Page["kind"], string> = { case: "케이스", reference: "레퍼런스", cover: "표지", section: "간지", blank: "빈 페이지" };

export function PageList() {
  const doc = useEditor((s) => s.doc)!;
  const pageId = useEditor((s) => s.pageId);
  const setPage = useEditor((s) => s.setPage);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

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
              <MenuItem onClick={() => (close(), addPage("reference"))}>레퍼런스 템플릿</MenuItem>
              <MenuItem onClick={() => (close(), addPage("case"))}>케이스 스터디 템플릿</MenuItem>
              <MenuItem onClick={() => (close(), addPage("section"))}>간지(섹션)</MenuItem>
              <MenuItem onClick={() => (close(), addPage("blank"))}>빈 페이지</MenuItem>
            </>
          )}
        </Menu>
      </div>
      <div className="page-list-scroll">
        {doc.pages.map((p, i) => (
          <div
            key={p.id}
            className={"page-item" + (p.id === pageId ? " on" : "") + (overIdx === i && dragId && dragId !== p.id ? " drop" : "")}
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
                  </>
                )}
              </Menu>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
