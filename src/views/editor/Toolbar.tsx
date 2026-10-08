import type { ReactNode } from "react";
import { usageApi } from "../../api";
import { UserAvatar } from "../../components/Avatar";
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
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const zoom = useEditor((s) => s.zoom);
  const fitScale = useEditor((s) => s.fitScale);
  const setZoom = useEditor((s) => s.setZoom);
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
        {readOnly ? <span className="badge">보기 전용</span> : <SyncBadge />}
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
        <TB icon="refresh" title="문서 히스토리 — 누가 무엇을 바꿨는지 · 버전 복원" onClick={() => setModal({ type: "history" })} />
      </div>

      <div className="tb-group edit-only">
        <Menu
          align="right"
          trigger={(o) => (
            <Button icon="sparkle" variant="accent" size="sm" onClick={o} disabled={!!aiBusy} title="AI 가 이미지를 보고 타이틀·설명·캡션을 써 줘요">
              {aiBusy ? (
                <>
                  <Spinner size={12} /> {aiBusy === "page" ? "분석 중" : aiBusy}
                </>
              ) : (
                "AI 작성"
              )}
            </Button>
          )}
        >
          {(close) => (
            <>
              <MenuItem icon="sparkle" hint="결과 확인 후 적용" onClick={() => (close(), onAiPage())}>
                이 페이지 분석하기
              </MenuItem>
              <MenuItem icon="layers" hint="빈 칸만" onClick={() => (close(), onAiAll())}>
                모든 페이지 채우기
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      <div className="tb-group">
        <TB icon="eye" title="웹 뷰어로 보기" onClick={() => open("view/" + doc.id)} />
        <TB icon="play" title="발표 모드 (전체 화면)" onClick={() => open("view/" + doc.id + "?present")} />
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
              <MenuItem icon="printer" hint="인쇄 → PDF로 저장" onClick={() => (close(), usageApi.recordExport("pdf", doc.id), open("print/" + doc.id))}>
                PDF (인쇄)
              </MenuItem>
              <MenuItem
                icon="file"
                hint=".pptx"
                onClick={async () => {
                  close();
                  toast.info("PPTX 생성 중… 이미지를 받아오느라 시간이 걸릴 수 있어요");
                  try {
                    const { exportPptx } = await import("../../export/pptx");
                    await exportPptx(doc);
                    usageApi.recordExport("pptx", doc.id);
                    toast.success("PPTX 를 내려받았어요");
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
                  await exportHtml(doc);
                  usageApi.recordExport("html", doc.id);
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
                  usageApi.recordExport("json", doc.id);
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

/** 저장 · 연결 상태 — 저장됨 / 저장 중 / 오프라인 — 변경 N개 대기 중 / 다시 연결 중 */
export function SyncBadge({ className = "save-state" }: { className?: string }) {
  const sync = useEditor((s) => s.sync);
  const saveState = useEditor((s) => s.saveState);
  const label =
    saveState === "saved"
      ? "저장됨"
      : saveState === "saving"
        ? "저장 중…"
        : saveState === "connecting"
          ? sync.pending
            ? `연결 중 — 변경 ${sync.pending}개 대기 중`
            : "연결 중…"
          : sync.pending
            ? `오프라인 — 변경 ${sync.pending}개 대기 중`
            : "오프라인 — 다시 연결하는 중";
  return (
    <span className={`${className} ${saveState}`} role="status" aria-live="polite" title={sync.transport === "http" ? "실시간 연결이 막혀 있어 1.5초마다 주고받는 중이에요" : undefined}>
      {label}
    </span>
  );
}

/** 같은 문서를 보고 있는 팀원 */
export function Presence() {
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
          <button
            key={p.userId}
            className="presence-user"
            title={`${p.name}${idx >= 0 ? ` · ${idx + 1}페이지` : ""}`}
            aria-label={`${p.name}${idx >= 0 ? ` — ${idx + 1}페이지 보는 중` : ""}`}
            onClick={() => p.pageId && setPage(p.pageId)}
          >
            {/* 테두리 = 사용자 고유 색 (공동 작업의 선택 테두리 · 깃발과 같은 색) */}
            <UserAvatar profile={p.profile} name={p.name} size="sm" ring />
            {idx >= 0 && <span className="avatar-page">{idx + 1}</span>}
          </button>
        );
      })}
      {others.length > 5 && <span className="muted small">+{others.length - 5}</span>}
    </div>
  );
}
