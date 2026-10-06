// 라이브러리 첫 화면 위쪽의 업로드 영역 — 이미지를 끌어다 놓거나 파일을 고르면 바로 추가 창이 열린다.
// 레퍼런스가 없을 때는 가입 직후 안내(크게), 있으면 같은 디자인의 한 줄짜리로 줄어든다.

import { useRef, useState, type DragEvent } from "react";
import { navigate } from "../lib/router";
import { ACCEPT_ATTR, hasFiles, imageFilesFrom } from "../lib/uploads";
import { useUI } from "../store/ui";
import { extractUrls } from "../views/CollectDialog";
import { Icon } from "./icons";
import { Button } from "./ui";

export function UploadHero({ compact, canEdit }: { compact: boolean; canEdit: boolean }) {
  const openCollect = useUI((s) => s.openCollect);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const drop = canEdit
    ? {
        onDragEnter: (e: DragEvent) => hasFiles(e.dataTransfer) && setOver(true),
        onDragOver: (e: DragEvent) => {
          e.preventDefault();
          if (hasFiles(e.dataTransfer)) setOver(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          const files = imageFilesFrom(e.dataTransfer);
          if (files.length) return openCollect(undefined, files);
          const text = [e.dataTransfer.getData("text/uri-list"), e.dataTransfer.getData("text/plain")].join("\n");
          if (extractUrls(text).length) openCollect(text);
        },
      }
    : {};

  const picker = (
    <input
      ref={fileInput}
      type="file"
      accept={ACCEPT_ATTR}
      multiple
      hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (files.length) openCollect(undefined, files);
      }}
    />
  );

  if (compact) {
    return (
      <div className={"upload-hero compact" + (over ? " over" : "")} {...drop}>
        {picker}
        <span className="upload-hero-icon" aria-hidden="true">
          <Icon name="upload" size={18} />
        </span>
        <button type="button" className="upload-hero-text" onClick={() => openCollect()}>
          <strong>{over ? "여기에 놓으면 올려요" : "레퍼런스 모으기"}</strong>
          <span>링크를 붙여넣거나(⌘V) 이미지를 끌어다 놓으세요</span>
        </button>
        <Button size="sm" icon="upload" className="upload-hero-file" onClick={() => fileInput.current?.click()}>
          파일 선택
        </Button>
        <Button size="sm" variant="primary" icon="link" className="upload-hero-link" onClick={() => openCollect()}>
          링크로 추가
        </Button>
      </div>
    );
  }

  return (
    <div className={"onboard upload-hero" + (over ? " over" : "")} {...drop}>
      {picker}
      <div className="onboard-head">
        <h2>
          첫 레퍼런스를 모아볼까요?
          <br />
          링크만 붙여넣으면 돼요
        </h2>
        <p>핀터레스트·웹페이지·이미지 링크나 내 이미지 파일을 키워드와 함께 저장해 두면, 키워드 하나로 보고서 문서까지 바로 만들 수 있어요.</p>
      </div>
      {canEdit && (
        <div className="upload-drop" aria-hidden={!over}>
          <Icon name="upload" size={24} />
          <strong>{over ? "여기에 놓으면 올려요" : "이미지를 여기에 끌어다 놓아도 돼요"}</strong>
          <span>JPG · PNG · WebP · GIF, 파일당 20MB까지 · 여러 장 한 번에</span>
        </div>
      )}
      <div className="onboard-steps">
        <div className="onboard-step">
          <span className="step-no">1</span>
          <strong>링크 붙여넣기</strong>
          <span>핀터레스트 핀의 공유 → 링크 복사, 또는 이미지 우클릭 → 이미지 주소 복사</span>
        </div>
        <div className="onboard-step">
          <span className="step-no">2</span>
          <strong>키워드 달기</strong>
          <span>#팝업스토어 #패키지 #경쟁사 처럼 나중에 찾을 말을 달아 두세요</span>
        </div>
        <div className="onboard-step">
          <span className="step-no">3</span>
          <strong>문서로 만들기</strong>
          <span>키워드를 넣으면 태그별로 묶어 A4 보고서 페이지를 만들어요</span>
        </div>
      </div>
      <div className="onboard-actions">
        {canEdit && (
          <>
            <Button size="lg" variant="primary" icon="plus" onClick={() => openCollect()}>
              레퍼런스 추가하기
            </Button>
            <Button size="lg" icon="upload" onClick={() => fileInput.current?.click()}>
              파일 선택
            </Button>
          </>
        )}
        <Button size="lg" icon="bulb" onClick={() => navigate("guide")}>
          사용 가이드 보기
        </Button>
      </div>
    </div>
  );
}
