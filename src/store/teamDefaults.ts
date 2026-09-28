import { useEffect, useState } from "react";
import type { DocSettings } from "../../shared/types";
import { teamApi } from "../api";
import { defaultSettings } from "../lib/defaults";
import { useSession } from "./session";

const cache = new Map<string, DocSettings>();

/** 팀 문서 기본 설정 (새 문서 만들 때 사용) */
export async function loadTeamDefaults(teamId: string): Promise<DocSettings> {
  const hit = cache.get(teamId);
  if (hit) return structuredClone(hit);
  const t = await teamApi.detail(teamId);
  cache.set(teamId, t.defaults);
  return structuredClone(t.defaults);
}

export function useTeamDefaults(): DocSettings | null {
  const teamId = useSession((s) => s.teamId);
  const tick = useSession((s) => s.ticks.team);
  const [defaults, setDefaults] = useState<DocSettings | null>(cache.get(teamId) ?? null);
  useEffect(() => {
    if (!teamId) return;
    cache.delete(teamId);
    loadTeamDefaults(teamId).then(setDefaults, () => setDefaults(defaultSettings()));
  }, [teamId, tick]);
  return defaults;
}
