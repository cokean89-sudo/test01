// 공통 원형 크롭 도구 — 팀 · 개인 프로필 사진.
// 원형 미리보기에서 끌어서(마우스 · 손가락) 위치를 옮기고, 슬라이더 · 휠 · 두 손가락으로 확대 · 축소 → 512px 로 잘라 보낸다.
// 서버가 받은 이미지를 다시 검사해 512×512 WebP 로 저장한다 (위치 정보 등 메타데이터는 남지 않음).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AVATAR_EDGE } from "../../shared/profile";
import { UPLOAD_ACCEPT, UPLOAD_MAX_MB } from "../../shared/files";
import { clampCrop, cropRect, initialCrop, MAX_ZOOM, MIN_ZOOM, moveCrop, scaleOf, zoomCrop, type CropGeom, type CropState } from "../lib/crop";
import { toast } from "../store/toast";
import { Button, Modal, Spinner } from "./ui";

/** 고른 파일이 크롭 도구로 열 수 있는 이미지인지 — 아니면 안내 문구 */
export function cropFileProblem(file: File): string | null {
  if (!UPLOAD_ACCEPT.includes(file.type)) return "JPG · PNG · WebP · GIF 이미지만 쓸 수 있어요.";
  if (file.size > UPLOAD_MAX_MB * 1024 * 1024) return `${UPLOAD_MAX_MB}MB보다 작은 이미지를 골라 주세요.`;
  return null;
}

/** 잘라 낸 영역을 정사각형 이미지로 — WebP 를 못 만드는 브라우저는 PNG (서버가 WebP 로 바꾼다) */
async function renderCrop(img: HTMLImageElement, g: CropGeom, s: CropState, edge = AVATAR_EDGE): Promise<Blob> {
  const { sx, sy, size } = cropRect(g, s);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 만들 수 없어요.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, size, size, 0, 0, edge, edge);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.92));
  if (blob) return blob;
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!png) throw new Error("이미지를 만들 수 없어요.");
  return png;
}

export function ImageCropDialog({ file, title, onCancel, onSave }: { file: File; title: string; onCancel: () => void; onSave: (image: Blob) => Promise<void> }) {
  const stage = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [view, setView] = useState(0);
  const [crop, setCrop] = useState<CropState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  // 파일 → 이미지 (브라우저가 사진 방향을 바로잡아 그린다)
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    let alive = true;
    el.src = url;
    el.decode().then(
      () => alive && setImg(el),
      () => alive && setError("이미지를 열 수 없어요. 다른 파일로 시도해 주세요."),
    );
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // 미리보기 크기 (휴대폰에서는 화면 폭에 맞춰 줄어든다)
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setView(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom: CropGeom | null = img && view ? { view, w: img.naturalWidth, h: img.naturalHeight } : null;

  // 처음 열 때 · 미리보기 크기가 바뀔 때: 가운데로 (크기가 바뀌면 비율을 유지)
  const lastView = useRef(0);
  useEffect(() => {
    if (!geom) return;
    setCrop((c) => {
      if (!c || !lastView.current) return initialCrop(geom);
      const k = geom.view / lastView.current;
      return clampCrop(geom, { zoom: c.zoom, x: c.x * k, y: c.y * k });
    });
    lastView.current = geom.view;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, view]);

  const update = useCallback(
    (fn: (g: CropGeom, s: CropState) => CropState) => {
      if (!geom) return;
      setCrop((c) => (c ? fn(geom, c) : c));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [img, view],
  );

  // 휠 확대 · 축소 — 페이지가 스크롤되지 않게 passive 가 아닌 리스너로
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      update((g, s) => zoomCrop(g, s, s.zoom * Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 이미 끝난 포인터 — 끌기만 안 될 뿐 */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && crop) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: crop.zoom };
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size >= 2 && pinch.current) {
      // 두 손가락: 벌린 만큼 확대, 두 손가락 가운데를 기준으로
      const [a, b] = [...pointers.current.values()];
      const r = e.currentTarget.getBoundingClientRect();
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / (pinch.current.dist || 1);
      const zoom = pinch.current.zoom * ratio;
      update((g, s) => zoomCrop(g, s, zoom, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top));
      return;
    }
    update((g, s) => moveCrop(g, s, next.x - prev.x, next.y - prev.y));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 8;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      update((g, s) => moveCrop(g, s, moves[e.key][0], moves[e.key][1]));
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      update((g, s) => zoomCrop(g, s, s.zoom + 0.1));
    } else if (e.key === "-") {
      e.preventDefault();
      update((g, s) => zoomCrop(g, s, s.zoom - 0.1));
    }
  };

  async function save() {
    if (!img || !geom || !crop) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await renderCrop(img, geom, crop));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  const scale = geom && crop ? scaleOf(geom, crop) : 0;
  return (
    <Modal
      title={title}
      onClose={() => !saving && onCancel()}
      width={420}
      footer={
        <>
          <Button onClick={onCancel} disabled={saving}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!crop || saving}>
            {saving ? <Spinner size={14} /> : null}
            {saving ? "저장하는 중…" : "저장"}
          </Button>
        </>
      }
    >
      <div className="crop">
        <div
          ref={stage}
          className={"crop-stage" + (crop ? "" : " loading")}
          tabIndex={0}
          role="application"
          aria-label="사진 위치 — 끌거나 화살표 키로 옮기고, + · - 키로 확대 · 축소해요"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {img && geom && crop ? (
            <img
              className="crop-image"
              src={img.src}
              alt=""
              draggable={false}
              style={{ width: geom.w * scale, height: geom.h * scale, transform: `translate(${crop.x}px, ${crop.y}px)` }}
            />
          ) : (
            !error && <Spinner size={22} />
          )}
          <span className="crop-ring" aria-hidden="true" />
        </div>
        <div className="crop-zoom">
          <Button icon="minus" variant="ghost" size="sm" aria-label="축소" disabled={!crop || crop.zoom <= MIN_ZOOM} onClick={() => update((g, s) => zoomCrop(g, s, s.zoom - 0.25))} />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop?.zoom ?? MIN_ZOOM}
            aria-label="확대 · 축소"
            disabled={!crop}
            onChange={(e) => {
              const z = Number(e.target.value);
              update((g, s) => zoomCrop(g, s, z));
            }}
          />
          <Button icon="plus" variant="ghost" size="sm" aria-label="확대" disabled={!crop || crop.zoom >= MAX_ZOOM} onClick={() => update((g, s) => zoomCrop(g, s, s.zoom + 0.25))} />
        </div>
        <p className="muted small crop-hint">사진을 끌어서 위치를 맞추고, 슬라이더로 크기를 조절해요. 원 안에 보이는 부분이 저장돼요.</p>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

/** 사진 고르기 → 크롭 → 저장. 팀 설정 · 내 계정에서 함께 쓴다 */
export function AvatarUploadButton({ label, title, onSave, disabled }: { label: string; title: string; onSave: (image: Blob) => Promise<void>; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <Button icon="upload" disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={UPLOAD_ACCEPT.join(",")}
        hidden
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const problem = cropFileProblem(f);
          if (problem) return void toast.error(problem);
          setFile(f);
        }}
      />
      {file && (
        <ImageCropDialog
          file={file}
          title={title}
          onCancel={() => setFile(null)}
          onSave={async (image) => {
            await onSave(image);
            setFile(null);
          }}
        />
      )}
    </>
  );
}
