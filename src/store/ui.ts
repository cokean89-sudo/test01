import { create } from "zustand";
import type { BuildOptions } from "../layout/autobuild";

interface UIState {
  collect: { open: boolean; urls?: string };
  build: { open: boolean; preset?: Partial<BuildOptions> };
  openCollect: (urls?: string) => void;
  closeCollect: () => void;
  openBuild: (preset?: Partial<BuildOptions>) => void;
  closeBuild: () => void;
}

export const useUI = create<UIState>((set) => ({
  collect: { open: false },
  build: { open: false },
  openCollect: (urls) => set({ collect: { open: true, urls } }),
  closeCollect: () => set({ collect: { open: false } }),
  openBuild: (preset) => set({ build: { open: true, preset } }),
  closeBuild: () => set({ build: { open: false } }),
}));
