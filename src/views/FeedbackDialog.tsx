// 의견 보내기 — 유형·내용·스크린샷(선택). 계정 메일·페이지 주소·브라우저/OS·시각은 자동으로 함께 보낸다.

import { useEffect, useMemo, useRef, useState } from "react";
import { describeUserAgent, FEEDBACK_KINDS, FEEDBACK_LIMITS, FEEDBACK_MIME, maskSensitiveUrl, type FeedbackKind } from "../../shared/feedback";
import { feedbackApi } from "../api";
import { APP_VERSION } from "../lib/changelog";
import { uid } from "../lib/id";
import { Icon } from "../components/icons";
import { Button, Modal, Segmented, Spinner } from "../components/ui";
import { useSession } from "../store/session";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";

interface Shot {
  id: string;
  name: string;
  size: number;
  dataUrl: string;
}

const MB = 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function FeedbackDialog() {
  const setFeedback = useUI((s) => s.setFeedback);
  const user = useSession((s) => s.user);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [shots, setShots] = useState<Shot[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const close = () => setFeedback(false);

  // 창을 연 순간의 화면 정보 (토큰이 든 주소는 가린다)
  const info = useMemo(
    () => ({
      pageUrl: maskSensitiveUrl(location.href),
      browser: describeUserAgent(navigator.userAgent),
      viewport: `${window.innerWidth}×${window.innerHeight}`,
    }),
    [],
  );

  async function addFiles(files: File[]) {
    setError(null);
    const room = FEEDBACK_LIMITS.maxFiles - shots.length;
    if (room <= 0) return toast.error(`스크린샷은 ${FEEDBACK_LIMITS.maxFiles}장까지 첨부할 수 있어요.`);
    const next: Shot[] = [];
    for (const f of files) {
      if (!(FEEDBACK_MIME as readonly string[]).includes(f.type)) {
        toast.error(`'${f.name}'은(는) 첨부할 수 없어요. PNG · JPG · WebP · GIF 이미지만 가능해요.`);
        continue;
      }
      if (f.size > FEEDBACK_LIMITS.fileBytes) {
        toast.error(`'${f.name}'이(가) ${(f.size / MB).toFixed(1)}MB 예요. 장당 5MB 이하만 첨부할 수 있어요.`);
        continue;
      }
      if (next.length >= room) {
        toast.error(`스크린샷은 ${FEEDBACK_LIMITS.maxFiles}장까지 첨부할 수 있어요.`);
        break;
      }
      next.push({ id: uid("s"), name: f.name || "screenshot.png", size: f.size, dataUrl: await readAsDataUrl(f) });
    }
    if (next.length) setShots((prev) => [...prev, ...next].slice(0, FEEDBACK_LIMITS.maxFiles));
  }

  // 캡처한 화면을 Ctrl+V 로 바로 붙여넣기
  useEffect(() => {
    if (done) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function submit() {
    if (!message.trim()) {
      setError("내용을 적어 주세요.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await feedbackApi.send({
        kind,
        message: message.trim(),
        pageUrl: info.pageUrl,
        viewport: info.viewport,
        appVersion: APP_VERSION,
        screenshots: shots.map((s) => ({ name: s.name, dataUrl: s.dataUrl })),
      });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <Modal title="의견 보내기" onClose={close} width={440}>
        <div className="feedback-done">
          <span className="feedback-done-icon">
            <Icon name="check" size={28} />
          </span>
          <h3>소중한 의견 감사합니다</h3>
          <p className="muted">보내주신 내용은 꼼꼼히 읽고 더 나은 RefBoard 를 만드는 데 쓸게요.</p>
          <Button variant="primary" size="lg" onClick={close}>
            확인
          </Button>
        </div>
      </Modal>
    );
  }

  const placeholder = FEEDBACK_KINDS.find((k) => k.key === kind)?.placeholder;
  return (
    <Modal
      title="의견 보내기"
      onClose={close}
      width={560}
      footer={
        <>
          <span className="muted small">Ctrl+Enter 로 보내기</span>
          <span className="spacer" />
          <Button onClick={close}>취소</Button>
          <Button variant="primary" onClick={submit} disabled={sending || !message.trim()}>
            {sending ? <Spinner size={14} /> : null}
            보내기
          </Button>
        </>
      }
    >
      <div className="feedback-form">
        <div className="field">
          <span className="field-label">유형</span>
          <Segmented<FeedbackKind> value={kind} onChange={setKind} options={FEEDBACK_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
        </div>

        <label className="field">
          <span className="field-label">내용</span>
          <textarea
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={FEEDBACK_LIMITS.messageMax}
            placeholder={placeholder}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !sending) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <span className="field-hint right">
            {message.length.toLocaleString()} / {FEEDBACK_LIMITS.messageMax.toLocaleString()}
          </span>
        </label>

        <div className="field">
          <span className="field-label">
            스크린샷 <span className="muted">(선택 · 최대 {FEEDBACK_LIMITS.maxFiles}장 · 장당 5MB)</span>
          </span>
          <div
            className={"shot-drop" + (dragging ? " over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles([...e.dataTransfer.files]);
            }}
          >
            {shots.map((s) => (
              <div key={s.id} className="shot">
                <img src={s.dataUrl} alt={s.name} />
                <button className="shot-x" onClick={() => setShots((prev) => prev.filter((x) => x.id !== s.id))} aria-label={`${s.name} 빼기`}>
                  <Icon name="x" size={12} />
                </button>
                <span className="shot-size">{(s.size / MB).toFixed(1)}MB</span>
              </div>
            ))}
            {shots.length < FEEDBACK_LIMITS.maxFiles && (
              <button className="shot-add" onClick={() => fileInput.current?.click()}>
                <Icon name="image" size={20} />
                <span>이미지 선택</span>
                <small>끌어놓기 · Ctrl+V</small>
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={FEEDBACK_MIME.join(",")}
            multiple
            hidden
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>

        <details className="feedback-info">
          <summary>함께 보내는 정보</summary>
          <dl>
            <dt>보낸 사람</dt>
            <dd>{user?.email ?? `${user?.name} (소셜 로그인)`}</dd>
            <dt>현재 페이지</dt>
            <dd className="ellipsis" title={info.pageUrl}>
              {info.pageUrl}
            </dd>
            <dt>브라우저 · OS</dt>
            <dd>
              {info.browser} · 화면 {info.viewport}
            </dd>
            <dt>앱 버전</dt>
            <dd>v{APP_VERSION}</dd>
            <dt>보낸 시각</dt>
            <dd>보내기를 누른 시각이 기록돼요</dd>
          </dl>
        </details>

        {error && <div className="error-box">{error}</div>}
      </div>
    </Modal>
  );
}
