import { create } from "zustand";
import type { AuthProviders, SessionInfo, TeamSummary, UserInfo } from "../../shared/types";
import { ApiError, authApi, setApiTeam, setUnauthorizedHandler, teamApi, teamEvents } from "../api";

const TEAM_KEY = "rb.team";

interface SessionState {
  status: "loading" | "anonymous" | "ready";
  user: UserInfo | null;
  teams: TeamSummary[];
  teamId: string;
  providers: AuthProviders | null;
  /** 실시간 이벤트로 올라가는 카운터 — 화면이 다시 불러올 때 사용 */
  ticks: { team: number; docs: number };
  bump: (key: "team" | "docs") => void;
  init: () => Promise<void>;
  apply: (info: SessionInfo, preferTeam?: string) => void;
  refreshTeams: (preferTeam?: string) => Promise<void>;
  switchTeam: (id: string) => void;
  logout: () => Promise<void>;
}

function readStoredTeam() {
  try {
    return localStorage.getItem(TEAM_KEY) ?? "";
  } catch {
    return "";
  }
}

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  user: null,
  teams: [],
  teamId: "",
  providers: null,
  ticks: { team: 0, docs: 0 },

  bump(key) {
    set({ ticks: { ...get().ticks, [key]: get().ticks[key] + 1 } });
  },

  async init() {
    authApi.providers().then((providers) => set({ providers }), () => undefined);
    try {
      get().apply(await authApi.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) set({ status: "anonymous", user: null, teams: [] });
      else throw err;
    }
  },

  apply(info, preferTeam) {
    const wanted = preferTeam || get().teamId || readStoredTeam();
    const team = info.teams.find((t) => t.id === wanted) ?? info.teams[0];
    const teamId = team?.id ?? "";
    setApiTeam(teamId);
    set({ status: "ready", user: info.user, teams: info.teams, teamId });
    try {
      localStorage.setItem(TEAM_KEY, teamId);
    } catch {
      /* ignore */
    }
  },

  async refreshTeams(preferTeam) {
    const teams = await teamApi.list();
    const user = get().user;
    if (user) get().apply({ user, teams }, preferTeam);
  },

  switchTeam(id) {
    if (id === get().teamId || !get().teams.some((t) => t.id === id)) return;
    setApiTeam(id);
    set({ teamId: id });
    try {
      localStorage.setItem(TEAM_KEY, id);
    } catch {
      /* ignore */
    }
  },

  async logout() {
    await authApi.logout().catch(() => undefined);
    set({ status: "anonymous", user: null, teams: [], teamId: "" });
    location.hash = "#/login";
  },
}));

setUnauthorizedHandler(() => {
  if (useSession.getState().status === "ready") useSession.setState({ status: "anonymous", user: null, teams: [] });
});

export function currentTeam(): TeamSummary | undefined {
  const { teams, teamId } = useSession.getState();
  return teams.find((t) => t.id === teamId);
}

export function useCurrentTeam(): TeamSummary | undefined {
  return useSession((s) => s.teams.find((t) => t.id === s.teamId));
}

/** 팀 단위 실시간 이벤트 (라이브러리·문서 목록 변경, 팀 변경) — App 에서 한 번 구독 */
export function connectTeamEvents(teamId: string, handlers: Record<string, (data: unknown) => void>): () => void {
  const es = teamEvents(teamId);
  for (const [event, fn] of Object.entries(handlers)) es.addEventListener(event, (e) => fn(JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}
