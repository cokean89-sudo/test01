// 팀 저장 공간 — '사용 중 1.2GB / 5GB' 막대. 90% 넘으면 경고, 가득 차면 안내

import type { StorageUsage } from "../../shared/types";
import { formatBytes } from "../lib/uploads";

export function storageState(u: StorageUsage | null): "ok" | "warn" | "full" {
  if (!u) return "ok";
  const r = u.used / u.limit;
  return r >= 1 ? "full" : r >= 0.9 ? "warn" : "ok";
}

export function StorageMeter({ usage, compact }: { usage: StorageUsage | null; compact?: boolean }) {
  if (!usage) return null;
  const ratio = Math.min(1, usage.used / usage.limit);
  const state = storageState(usage);
  return (
    <div className={`storage-meter ${state}`} role="group" aria-label="팀 저장 공간">
      <div className="storage-meter-head">
        <span>팀 저장 공간</span>
        <strong>
          사용 중 {formatBytes(usage.used)} / {formatBytes(usage.limit)}
        </strong>
      </div>
      <div className="storage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <i style={{ width: `${usage.used ? Math.max(ratio * 100, 1) : 0}%` }} />
      </div>
      {state === "full" ? (
        <p className="storage-note">저장 공간이 가득 찼어요. 이미지 파일을 올리거나 사본을 저장할 수 없어요 — 쓰지 않는 레퍼런스를 지우면 공간이 생기고, 더 필요하면 관리자에게 늘려 달라고 요청하세요.</p>
      ) : state === "warn" ? (
        <p className="storage-note">저장 공간이 거의 찼어요 ({Math.round(ratio * 100)}%). 쓰지 않는 레퍼런스를 정리해 주세요.</p>
      ) : compact ? null : (
        <p className="muted small">올린 이미지 · 링크 사본 {usage.files}개. 레퍼런스를 지우면 파일도 함께 지워져요.</p>
      )}
    </div>
  );
}
