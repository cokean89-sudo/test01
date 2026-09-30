import { create } from "zustand";
import type { BuildOptions } from "../layout/autobuild";

interface UIState {
  /** 레퍼런스 추가 창 — 링크(urls)나 붙여넣은 이미지 파일(files)을 바로 넘길 수 있다 */
  collect: { open: boolean; urls?: string; files?: File[] };
  build: { open: boolean; preset?: Partial<BuildOptions> };
  /** 라이브러리에서 상세를 열 레퍼런스 (중복 알림 → 편집) */
  focusRef: string | null;
  setFocusRef: (id: string | null) => void;
  openCollect: (urls?: string, files?: File[]) => void;
  closeCollect: () => void;
  openBuild: (preset?: Partial<BuildOptions>) => void;
  closeBuild: () => void;
  /** 의견 보내기 창 */
  feedback: boolean;
  setFeedback: (open: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  collect: { open: false },
  build: { open: false },
  focusRef: null,
  setFocusRef: (id) => set({ focusRef: id }),
  openCollect: (urls, files) => set({ collect: { open: true, urls, files } }),
  closeCollect: () => set({ collect: { open: false } }),
  openBuild: (preset) => set({ build: { open: true, preset } }),
  closeBuild: () => set({ build: { open: false } }),
  feedback: false,
  setFeedback: (open) => set({ feedback: open }),
}));
