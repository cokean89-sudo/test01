import type { ReactNode } from "react";
import { Icon, type IconName } from "../../components/icons";
import { Button, Menu, MenuItem, Spinner } from "../../components/ui";
import { navigate } from "../../lib/router";
import { flushSave, useEditor, type Tool } from "../../store/editor";
import { useSession } from "../../store/session";
import { toast } from "../../store/toast";
import { align, deleteSelection, distribute, duplicateSelection, reorder } from "./actions";

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: "select", icon: "cursor", label: "선택", key: "V" },
  { tool: "text", icon: "text", label: "텍스트", key: "T" },
  { tool: "rect", icon: "rect", label: "사각형", key: "R" },
  { tool: "ellipse", icon: "ellipse", label: "원", key: "O" },
  { tool: "line", icon: "line", label: "선", key: "L" },
];

function TB({ icon, title, onClick, disabled, on, children }: { icon: IconName; title: string; onClick: () => void; disabled?: boolean; on?: boolean; children?: ReactNode }) {
  return (
    <button type="button" className={"tb" + (on ? " on" : "")} title={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={17} />
      {children}
    </button>
  );
}

export function Toolbar({ onAiPage, onAiAll, aiBusy }: { onAiPage: () => void; onAiAll: () => void; aiBusy: string | null }) {
  const doc = useEditor((s) => s.doc)!;
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const selection = useEditor((s) => s.selection);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const zoom = useEditor((s) => s.zoom);
  const fitScale = useEditor((s) => s.fitScale);
  const setZoom = useEditor((s) => s.setZoom);
  const saveState = useEditor((s) => s.saveState);
  const setModal = useEditor((s) => s.setModal);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const update = useEditor((s) => s.update);
  const readOnly = useEditor((s) => s.readOnly);

  const scale = zoom === "fit" ? fitScale : zoom;
  const pct = Math.round((scale / (96 / 72)) * 100);
  const setPct = (p: number) => setZoom(Math.max(0.1, Math.min(8, (p / 100) * (96 / 72))));
  const has = selection.length > 0;

  const open = async (path: string) => {
    await flushSave();
    window.open("#/" + path, "_blank");
  };

  return (
    <div className="editor-toolbar">
      <div className="tb-group">
        <button className="tb" title="문서 목록" onClick={() => navigate("docs")}>
          <Icon name="chevronLeft" size={17} />
        </button>
        <input
          className="doc-title"
          value={doc.title}
          onChange={(e) => update((d) => void (d.title = e.target.value), { key: "doc-title" })}
          readOnly={readOnly}
          aria-label="문서 제목"
        />
        {readOnly ? (
          <span className="badge">보기 전용</span>
        ) : (
          <span className={"save-state " + saveState}>
            {saveState === "saving" ? "저장 중…" : saveState === "dirty" ? "변경됨" : saveState === "error" ? "저장 실패" : "저장됨"}
          </span>
        )}
      </div>

      <div className="tb-group edit-only">
        {TOOLS.map((t) => (
          <TB key={t.tool} icon={t.icon} title={`${t.label} (${t.key})`} on={tool === t.tool} onClick={() => setTool(t.tool)} />
        ))}
        <TB icon="image" title="이미지 추가 (라이브러리)" onClick={() => setModal({ type: "picker", mode: "add" })} />
      </div>

      <div className="tb-group edit-only">
        <TB icon="undo" title="실행 취소 (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <TB icon="redo" title="다시 실행 (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
        <Menu trigger={(o) => <TB icon="alignLeft" title="정렬" onClick={o} disabled={!has} />}>
          {(close) => (
            <>
              <MenuItem icon="alignLeft" onClick={() => (close(), align("left"))}>왼쪽 맞춤</MenuItem>
              <MenuItem icon="alignCenter" onClick={() => (close(), align("hcenter"))}>가로 가운데</MenuItem>
              <MenuItem icon="alignRight" onClick={() => (close(), align("right"))}>오른쪽 맞춤</MenuItem>
              <MenuItem icon="alignTop" onClick={() => (close(), align("top"))}>위쪽 맞춤</MenuItem>
              <MenuItem icon="alignMiddle" onClick={() => (close(), align("vcenter"))}>세로 가운데</MenuItem>
              <MenuItem icon="alignBottom" onClick={() => (close(), align("bottom"))}>아래쪽 맞춤</MenuItem>
              <MenuItem icon="distH" disabled={selection.length < 3} onClick={() => (close(), distribute("h"))}>가로 간격 균등</MenuItem>
              <MenuItem icon="distV" disabled={selection.length < 3} onClick={() => (close(), distribute("v"))}>세로 간격 균등</MenuItem>
            </>
          )}
        </Menu>
        <Menu trigger={(o) => <TB icon="layers" title="순서" onClick={o} disabled={!has} />}>
          {(close) => (
            <>
              <MenuItem icon="front" hint="Ctrl+Shift+]" onClick={() => (close(), reorder("front"))}>맨 앞으로</MenuItem>
              <MenuItem icon="up" hint="Ctrl+]" onClick={() => (close(), reorder("forward"))}>앞으로</MenuItem>
              <MenuItem icon="down" hint="Ctrl+[" onClick={() => (close(), reorder("backward"))}>뒤로</MenuItem>
              <MenuItem icon="back" hint="Ctrl+Shift+[" onClick={() => (close(), reorder("back"))}>맨 뒤로</MenuItem>
            </>
          )}
        </Menu>
        <TB icon="copy" title="복제 (Ctrl+D)" onClick={duplicateSelection} disabled={!has} />
        <TB icon="trash" title="삭제 (Delete)" onClick={deleteSelection} disabled={!has} />
      </div>

      <div className="tb-group zoom">
        <TB icon="minus" title="축소" onClick={() => setPct(pct - 10)} />
        <button className="tb zoom-pct" title="화면에 맞춤" onClick={() => setZoom("fit")}>
          {pct}%
        </button>
        <TB icon="plus" title="확대" onClick={() => setPct(pct + 10)} />
      </div>

      <span className="spacer" />

      <Presence />
      <div className="tb-group">
        <TB icon="refresh" title="버전 기록 (누가 언제 저장했는지 · 복원)" onClick={() => setModal({ type: "history" })} />
      </div>

      <div className="tb-group edit-only">
        <Button icon="sparkle" variant="accent" size="sm" onClick={onAiPage} disabled={!!aiBusy} title="현재 페이지 이미지를 분석해 타이틀·설명·캡션 제안">
          {aiBusy === "page" ? <Spinner size={12} /> : null} AI 분석
        </Button>
        <Button size="sm" onClick={onAiAll} disabled={!!aiBusy} title="모든 페이지에 AI 타이틀·설명 자동 작성">
          {aiBusy && aiBusy !== "page" ? (
            <>
              <Spinner size={12} /> {aiBusy}
            </>
          ) : (
            "전체 AI 작성"
          )}
        </Button>
      </div>

      <div className="tb-group">
        <Button icon="eye" size="sm" onClick={() => open("view/" + doc.id)}>
          웹 뷰어
        </Button>
        <Button icon="play" size="sm" onClick={() => open("view/" + doc.id + "?present")}>
          발표
        </Button>
        <Menu
          align="right"
          trigger={(o) => (
            <Button icon="download" size="sm" variant="primary" onClick={o}>
              내보내기
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon="printer" hint="인쇄 → PDF로 저장" onClick={() => (close(), open("print/" + doc.id))}>
                PDF (인쇄)
              </MenuItem>
              <MenuItem
                icon="file"
                hint=".pptx"
                onClick={async () => {
                  close();
                  toast.info("PPTX 생성 중… 이미지를 받아오느라 시간이 걸릴 수 있습니다");
                  try {
                    const { exportPptx } = await import("../../export/pptx");
                    await exportPptx(doc);
                    toast.success("PPTX 를 내려받았습니다");
                  } catch (err) {
                    toast.error("PPTX 내보내기 실패: " + (err as Error).message);
                  }
                }}
              >
                PowerPoint
              </MenuItem>
              <MenuItem
                icon="link"
                hint="단일 .html"
                onClick={async () => {
                  close();
                  const { exportHtml } = await import("../../export/html");
                  exportHtml(doc);
                }}
              >
                HTML 웹 문서
              </MenuItem>
              <MenuItem
                icon="download"
                hint=".json"
                onClick={() => {
                  close();
                  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${doc.title || "document"}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                문서 데이터 (JSON)
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}

/** 같은 문서를 보고 있는 팀원 */
function Presence() {
  const presence = useEditor((s) => s.presence);
  const pages = useEditor((s) => s.doc?.pages);
  const me = useSession((s) => s.user?.id);
  const setPage = useEditor((s) => s.setPage);
  const others = presence.filter((p) => p.userId !== me);
  if (!others.length) return null;
  return (
    <div className="presence" title="이 문서를 함께 보고 있는 팀원">
      {others.slice(0, 5).map((p) => {
        const idx = pages?.findIndex((x) => x.id === p.pageId) ?? -1;
        return (
          <button key={p.userId} className="avatar sm" title={`${p.name}${idx >= 0 ? ` · ${idx + 1}페이지` : ""}`} onClick={() => p.pageId && setPage(p.pageId)}>
            {p.name.slice(0, 1)}
            {idx >= 0 && <span className="avatar-page">{idx + 1}</span>}
          </button>
        );
      })}
      {others.length > 5 && <span className="muted small">+{others.length - 5}</span>}
    </div>
  );
}
