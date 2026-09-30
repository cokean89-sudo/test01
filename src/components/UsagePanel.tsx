// 내 계정 — 이번 달 사용량 (베타 기간 사용 한도). 80% 부터 부드럽게 알리고, 다 쓰면 다시 채워지는 날과 한도 요청 버튼을 보여 준다.

import { useEffect, useState } from "react";
import type { MyUsage, UsageMeter } from "../../shared/types";
import { monthDayLabel, usageState, withObject } from "../../shared/usage";
import { usageApi } from "../api";
import { formatBytes } from "../lib/uploads";
import { useUI } from "../store/ui";
import { Button, Spinner } from "./ui";

const count = (n: number) => `${n.toLocaleString("ko-KR")}회`;

export function UsagePanel() {
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    usageApi
      .me()
      .then(setUsage)
      .catch((err) => setError((err as Error).message));
  }, []);

  return (
    <section className="panel usage-panel" aria-labelledby="usage-title">
      <div className="usage-head">
        <h4 id="usage-title">이번 달 사용량</h4>
        <span className="badge badge-accent">{usage?.planLabel ?? "베타 기간 사용 한도"}</span>
      </div>
      {error ? (
        <div className="note-box">사용량을 불러오지 못했어요. {error}</div>
      ) : !usage ? (
        <Spinner />
      ) : (
        <>
          <p className="muted small">
            베타 기간에는 한 사람이 쓸 수 있는 양을 정해 두었어요. AI 사용량은 매월 1일에 다시 채워져요 (다음: {monthDayLabel(usage.resetDate)}).
          </p>
          {usage.aiPaused && (
            <div className="notice">이번 달 AI 사용량이 서비스 전체 예산에 도달해서 AI 기능을 잠시 쉬어요. {monthDayLabel(usage.resetDate)}에 다시 켜져요.</div>
          )}
          {usage.exempt && <div className="note-box">관리자 계정이라 개인 한도 없이 쓸 수 있어요. 사용량만 보여 드려요.</div>}
          <div className="usage-meters">
            {usage.meters.map((m) => (
              <MeterRow key={m.key} meter={m} reset={monthDayLabel(usage.resetDate)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function MeterRow({ meter, reset }: { meter: UsageMeter; reset: string }) {
  const setFeedback = useUI((s) => s.setFeedback);
  const isStorage = meter.key === "storage";
  const fmt = isStorage ? formatBytes : count;
  const state = usageState(meter.used, meter.limit);
  const dailyFull = !!meter.daily && usageState(meter.daily.used, meter.daily.limit) === "full";
  const ratio = meter.limit ? Math.min(1, meter.used / meter.limit) : 0;
  const pct = Math.round(ratio * 100);
  const left = meter.limit !== null ? Math.max(0, meter.limit - meter.used) : 0;

  const request = () =>
    setFeedback(true, {
      kind: "idea",
      message: `[한도 요청] ${meter.label} 한도${meter.limit !== null ? `(${isStorage ? "" : "월 "}${fmt(meter.limit)})` : ""}를 늘려 주실 수 있을까요?\n\n필요한 이유: `,
    });

  return (
    <div className={`usage-meter ${state}`} role="group" aria-label={meter.label}>
      <div className="usage-meter-head">
        <span className="usage-meter-label">{meter.label}</span>
        <strong>{meter.limit === null ? `${fmt(meter.used)} 사용` : `${fmt(meter.used)} / ${fmt(meter.limit)}`}</strong>
      </div>
      {meter.limit !== null && (
        <div className="usage-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${meter.label} ${pct}%`}>
          <i style={{ width: `${meter.used ? Math.max(ratio * 100, 1) : 0}%` }} />
        </div>
      )}
      {meter.daily && meter.daily.limit !== null && (
        <span className="usage-meter-sub">
          오늘 {count(meter.daily.used)} / 하루 {count(meter.daily.limit)}
        </span>
      )}
      {state === "full" ? (
        <div className="usage-note">
          <p>
            {isStorage
              ? "내 저장 공간을 모두 사용했어요. 내가 올린 레퍼런스 중 쓰지 않는 것을 지우면 공간이 생겨요."
              : `이번 달 ${withObject(meter.label)} 모두 사용했어요. ${reset}에 다시 채워져요.`}
          </p>
          <Button size="sm" icon="message" onClick={request}>
            의견 보내기로 한도 요청
          </Button>
        </div>
      ) : dailyFull ? (
        <div className="usage-note soft">
          <p>오늘 {withObject(meter.label)} 모두 사용했어요. 내일 다시 쓸 수 있어요.</p>
        </div>
      ) : state === "warn" ? (
        <div className="usage-note soft">
          <p>
            {isStorage ? `내 저장 공간의 ${pct}%를 썼어요. ${fmt(left)} 남았어요.` : `이번 달 ${meter.label} 한도의 ${pct}%를 썼어요. ${fmt(left)} 남았고, ${reset}에 다시 채워져요.`}
          </p>
          <button type="button" className="link-btn blue" onClick={request}>
            한도가 부족하면 알려 주세요
          </button>
        </div>
      ) : null}
    </div>
  );
}
