/** 현장 기준: 정격 대비 75%까지 정상, 최대 85%. 초과는 경고만 (상신 차단 아님). */

export const RIGGING_UTIL_STANDARD_PCT = 75;
export const RIGGING_UTIL_MAX_PCT = 85;

export const LIFTING_METHOD_OPTIONS = [
  { value: "직인양", label: "직인양" },
  { value: "선회인양", label: "선회인양" },
  { value: "수평이동", label: "수평이동" },
  { value: "턴오버", label: "턴오버" },
] as const;

export type RiggingLoadBand = "ok" | "warn" | "over_capacity";

export function riggingUtilizationPct(totalWeight: number, workingLoad: number): number {
  if (!(totalWeight > 0) || !(workingLoad > 0)) return 0;
  return (totalWeight / workingLoad) * 100;
}

export function classifyRiggingLoad(opts: {
  utilizationPct: number;
  safetyFactor: number;
}): RiggingLoadBand {
  const sf = Number(opts.safetyFactor) || 0;
  const util = Number(opts.utilizationPct) || 0;
  if (sf > 0 && sf < 1) return "over_capacity";
  if (util > RIGGING_UTIL_STANDARD_PCT) return "warn";
  return "ok";
}

export function riggingLoadBanner(band: RiggingLoadBand): { label: string; emoji: string; color: string } {
  if (band === "over_capacity") {
    return { label: "작업금지", emoji: "🚫", color: "#dc2626" };
  }
  if (band === "warn") {
    return { label: "경고", emoji: "⚠️", color: "#d97706" };
  }
  return { label: "안전", emoji: "✅", color: "#16a34a" };
}

export function riggingLoadHint(utilizationPct: number): string {
  const util = Number(utilizationPct) || 0;
  if (util > RIGGING_UTIL_MAX_PCT) {
    return `기준 ${RIGGING_UTIL_STANDARD_PCT}% · 최대 ${RIGGING_UTIL_MAX_PCT}% 초과`;
  }
  if (util > RIGGING_UTIL_STANDARD_PCT) {
    return `기준 ${RIGGING_UTIL_STANDARD_PCT}% 초과 (최대 ${RIGGING_UTIL_MAX_PCT}%)`;
  }
  return `기준 ${RIGGING_UTIL_STANDARD_PCT}% · 최대 ${RIGGING_UTIL_MAX_PCT}%`;
}
