import { useState } from "react";
import { TAG_AXES, tagKey } from "../../shared/tags";
import type { TagSuggestResult } from "../../shared/types";
import { Icon } from "./icons";
import { Spinner } from "./ui";

/**
 * AI 태그 제안 — 축별 칩. 바로 저장하지 않고, 눌러서 채택하거나 ×로 뺀다.
 * current: 이미 붙은 태그 (채택된 칩은 체크로 보인다)
 */
export function TagSuggestions({
  result,
  loading,
  current,
  onAdopt,
  onTitle,
}: {
  result: TagSuggestResult | null;
  loading?: boolean;
  current: string[];
  onAdopt: (tags: string[]) => void;
  onTitle?: (title: string) => void;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  if (loading) {
    return (
      <div className="tag-suggest-box">
        <span className="muted small">
          <Spinner size={12} /> 이미지를 보고 태그를 고르는 중…
        </span>
      </div>
    );
  }
  if (!result) return null;
  if (result.engine === "off") {
    return <div className="note-box">{result.notice ?? "AI 연결 후 사용할 수 있어요."}</div>;
  }
  const has = new Set(current.map(tagKey));
  const pending = TAG_AXES.flatMap((a) => result.axes[a.key]).filter((t) => !has.has(tagKey(t)) && !dismissed.has(t));
  const rows = TAG_AXES.map((a) => ({ ...a, tags: result.axes[a.key].filter((t) => !dismissed.has(t)) })).filter((r) => r.tags.length);
  return (
    <div className="tag-suggest-box">
      <div className="tag-suggest-head">
        <strong>
          <Icon name="sparkle" size={13} /> AI 제안
        </strong>
        <span className="muted small">눌러서 채택 · ×로 빼기</span>
        <span className="spacer" />
        {pending.length > 1 && (
          <button className="link-btn blue" onClick={() => onAdopt(pending)}>
            모두 채택
          </button>
        )}
      </div>
      {result.title && onTitle && (
        <div className="tag-axis">
          <span className="tag-axis-label">제목</span>
          <button className="suggest-chip" onClick={() => onTitle(result.title!)} title="제목으로 쓰기">
            + {result.title}
          </button>
        </div>
      )}
      {rows.length === 0 && <p className="muted small">새로 제안할 태그가 없어요.</p>}
      {rows.map((row) => (
        <div key={row.key} className="tag-axis">
          <span className="tag-axis-label" title={row.hint}>
            {row.label}
          </span>
          <div className="tag-axis-chips">
            {row.tags.map((t) => {
              const adopted = has.has(tagKey(t));
              return (
                <span key={t} className={"suggest-chip" + (adopted ? " adopted" : "")}>
                  <button onClick={() => !adopted && onAdopt([t])} disabled={adopted} title={adopted ? "채택됨" : "채택"}>
                    {adopted ? "✓" : "+"} {t}
                  </button>
                  {!adopted && (
                    <button className="x" onClick={() => setDismissed((d) => new Set(d).add(t))} aria-label={`${t} 빼기`}>
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
