// 업데이트 소식 — 메인(레퍼런스) 화면 카드 · 전체 기록 창

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { APP_VERSION, CHANGELOG, formatUpdateDate } from "../lib/changelog";
import { useUpdates } from "../store/updates";
import { Icon } from "./icons";
import { Button, Modal } from "./ui";

/** **굵게** · `코드` 정도만 살려 보여 준다 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("`") && part.endsWith("`") ? <code key={i}>{part.slice(1, -1)}</code> : part,
  );
}

/** 사이드바 카드 — 최근 3개 + 전체 보기 */
export function UpdatesCard() {
  const unseen = useUpdates((s) => s.unseen);
  const { openAll, markSeen } = useUpdates.getState();
  const latest = CHANGELOG.slice(0, 3);
  if (!latest.length) return null;
  return (
    <section className="updates-card" aria-label="업데이트 소식">
      <h4 className="sidebar-title">
        <span className="updates-head">
          업데이트 소식
          {unseen.size > 0 && <span className="updates-new">새 소식 {unseen.size}</span>}
        </span>
        <button className="link-btn blue" onClick={() => openAll()}>
          전체 보기
        </button>
      </h4>
      <ul className="updates-list">
        {latest.map((e) => (
          <li key={e.version}>
            <button
              className={"updates-item" + (unseen.has(e.version) ? " unseen" : "")}
              onClick={() => {
                markSeen([e.version]);
                openAll(e.version);
              }}
            >
              {unseen.has(e.version) && <i className="unseen-dot" aria-label="아직 안 본 소식" />}
              <span className="updates-title">{e.title}</span>
              <span className="updates-meta">
                v{e.version} · {formatUpdateDate(e.date)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="app-version">현재 버전 v{APP_VERSION}</p>
    </section>
  );
}

/** 전체 기록 — 닫으면 모두 읽음 */
export function UpdatesDialog() {
  const focus = useUpdates((s) => s.focus);
  const close = useUpdates((s) => s.close);
  // 연 순간 안 본 것을 기억해 두고 점을 유지한다 (항목을 눌러 열었어도 그 항목의 점은 이 창에서 보인다)
  const unseenAtOpen = useMemo(() => {
    const s = new Set(useUpdates.getState().unseen);
    if (focus) s.add(focus);
    return s;
  }, [focus]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    listRef.current?.querySelector<HTMLElement>(`[data-version="${focus}"]`)?.scrollIntoView({ block: "start" });
  }, [focus]);
  return (
    <Modal
      title="업데이트 기록"
      onClose={close}
      width={640}
      footer={
        <>
          <span className="muted small updates-foot-note">현재 버전 v{APP_VERSION}</span>
          <Button variant="primary" onClick={close}>
            확인
          </Button>
        </>
      }
    >
      <div className="updates-all" ref={listRef}>
        {CHANGELOG.map((e) => (
          <article key={e.version} data-version={e.version} className={"updates-entry" + (e.version === focus ? " focus" : "")}>
            <header>
              <span className="updates-ver">v{e.version}</span>
              <time dateTime={e.date}>{formatUpdateDate(e.date)}</time>
              {e.version === APP_VERSION && <span className="updates-current">지금 버전</span>}
              {unseenAtOpen.has(e.version) && (
                <span className="updates-unseen">
                  <i className="unseen-dot" /> 새 소식
                </span>
              )}
            </header>
            <h3>{e.title}</h3>
            <ul>
              {e.items.map((it, i) => (
                <li key={i}>{inline(it)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Modal>
  );
}

/** 프로필 메뉴 등에 넣는 버전 표시 + 기록 열기 */
export function VersionLink({ onOpen }: { onOpen?: () => void }) {
  const unseen = useUpdates((s) => s.unseen.size);
  return (
    <button
      className="version-link"
      onClick={() => {
        onOpen?.();
        useUpdates.getState().openAll();
      }}
    >
      <Icon name="bell" size={14} />
      <span className="version-link-label">업데이트 기록</span>
      {unseen > 0 && <i className="unseen-dot" aria-label={`새 소식 ${unseen}개`} />}
      <span className="muted">v{APP_VERSION}</span>
    </button>
  );
}
