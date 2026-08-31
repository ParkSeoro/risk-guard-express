/**
 * Field-usable lifting hardware SSOT for work-plan / rigging plans.
 *
 * Sources (do not invent values):
 * - Round sling colours + WLL: EN 1492-2 (CERTEX / Mennens). Orange = 10 t and above;
 *   exact WLL is the sewn label. Steps 10–100 t match EN 1492-2 manufacturer catalogs.
 * - Shackle WLL: Crosby G-2130 / S-2130 carbon bolt-type anchor (metric tons),
 *   KITO Crosby catalog. 2" = 35 t.
 * - 250 t class: Kobelco CKE2500-2 official spec — 250 t × 4.6 m (crane boom).
 * - 300 t class: Liebherr LR 1300 — 300 t × 4.3 m (published max). Full radius
 *   charts depend on boom/counterweight/LMI and are NOT interpolated here.
 */

export type RoundSlingOption = {
  /** Stored on rigging_plans.sling_belt_color */
  id: string;
  color: string;
  label: string;
  ratedLoad: number;
};

/** EN 1492-2. Legacy id `orange` stays 10 t so existing plans do not jump. */
export const ROUND_SLING_BY_COLOR: RoundSlingOption[] = [
  { id: "purple", color: "purple", label: "보라 1t", ratedLoad: 1 },
  { id: "green", color: "green", label: "녹색 2t", ratedLoad: 2 },
  { id: "yellow", color: "yellow", label: "노랑 3t", ratedLoad: 3 },
  { id: "gray", color: "gray", label: "회색 4t", ratedLoad: 4 },
  { id: "red", color: "red", label: "빨강 5t", ratedLoad: 5 },
  { id: "brown", color: "brown", label: "갈색 6t", ratedLoad: 6 },
  { id: "blue", color: "blue", label: "파랑 8t", ratedLoad: 8 },
  { id: "orange", color: "orange", label: "주황 10t", ratedLoad: 10 },
  { id: "orange-12", color: "orange", label: "주황 12t", ratedLoad: 12 },
  { id: "orange-15", color: "orange", label: "주황 15t", ratedLoad: 15 },
  { id: "orange-20", color: "orange", label: "주황 20t", ratedLoad: 20 },
  { id: "orange-25", color: "orange", label: "주황 25t", ratedLoad: 25 },
  { id: "orange-30", color: "orange", label: "주황 30t", ratedLoad: 30 },
  { id: "orange-40", color: "orange", label: "주황 40t", ratedLoad: 40 },
  { id: "orange-50", color: "orange", label: "주황 50t", ratedLoad: 50 },
  { id: "orange-60", color: "orange", label: "주황 60t", ratedLoad: 60 },
  { id: "orange-80", color: "orange", label: "주황 80t", ratedLoad: 80 },
  { id: "orange-100", color: "orange", label: "주황 100t", ratedLoad: 100 },
];

export const ROUND_SLING_OPTIONS: number[] = ROUND_SLING_BY_COLOR.map((s) => s.ratedLoad);

export function getRoundSlingRatedLoadByColor(colorOrId: string): number {
  const key = String(colorOrId || "").trim();
  if (!key) return 0;
  const byId = ROUND_SLING_BY_COLOR.find((s) => s.id === key);
  if (byId) return byId.ratedLoad;
  const byLabel = ROUND_SLING_BY_COLOR.find((s) => s.label === key);
  if (byLabel) return byLabel.ratedLoad;
  // Legacy Korean labels without tonnage
  const legacy: Record<string, number> = {
    보라: 1,
    녹색: 2,
    노랑: 3,
    회색: 4,
    빨강: 5,
    갈색: 6,
    파랑: 8,
    주황: 10,
  };
  if (legacy[key] != null) return legacy[key];
  return 0;
}

export function roundSlingSwatch(color: string): string {
  if (color === "purple") return "#9b59b6";
  if (color === "brown") return "#8B4513";
  if (color === "gray") return "#808080";
  return color;
}

export type ShackleInchOption = {
  inch: string;
  label: string;
  /** Crosby G-2130 WLL, metric tons */
  safeLoad: number;
};

export const SHACKLE_INCH_LOAD: ShackleInchOption[] = [
  { inch: "1/2", label: '1/2"', safeLoad: 2 },
  { inch: "5/8", label: '5/8"', safeLoad: 3.25 },
  { inch: "3/4", label: '3/4"', safeLoad: 4.75 },
  { inch: "7/8", label: '7/8"', safeLoad: 6.5 },
  { inch: "1", label: '1"', safeLoad: 8.5 },
  { inch: "1-1/8", label: '1-1/8"', safeLoad: 9.5 },
  { inch: "1-1/4", label: '1-1/4"', safeLoad: 12 },
  { inch: "1-3/8", label: '1-3/8"', safeLoad: 13.5 },
  { inch: "1-1/2", label: '1-1/2"', safeLoad: 17 },
  { inch: "1-3/4", label: '1-3/4"', safeLoad: 25 },
  { inch: "2", label: '2"', safeLoad: 35 },
  { inch: "2-1/2", label: '2-1/2"', safeLoad: 55 },
  { inch: "3", label: '3"', safeLoad: 85 },
  { inch: "3-1/2", label: '3-1/2"', safeLoad: 120 },
  { inch: "4", label: '4"', safeLoad: 150 },
];

export function getShackleSafeLoadByInch(inch: string): number {
  const found = SHACKLE_INCH_LOAD.find((s) => s.inch === inch);
  return found?.safeLoad ?? 0;
}

export type CraneClassPreset = {
  id: string;
  name: string;
  ratedCapacity: number;
  /** Official max-capacity geometry only. Not a full load chart. */
  defaultBoomLength: number;
  defaultWorkingRadius: number;
  defaultCapacityAtPoint: number;
  source: string;
  /** Full boom×radius table we can interpolate. Invented charts stay false. */
  chartVerified: boolean;
  loadChart: { boomLength: number; radius: number; capacity: number }[];
};

/**
 * Heavy crawlers used on Korean sites. Only manufacturer max points are stored.
 * Do not interpolate other radii — enter LMI / 제원표 인양능력.
 */
export const HEAVY_CRANE_CLASSES: CraneClassPreset[] = [
  {
    id: "crane_cke2500",
    name: "Kobelco CKE2500-2 (250톤)",
    ratedCapacity: 250,
    defaultBoomLength: 15.2,
    defaultWorkingRadius: 4.6,
    defaultCapacityAtPoint: 250,
    source: "Kobelco CKE2500-2 spec: 250 t × 4.6 m (crane boom)",
    chartVerified: false,
    loadChart: [],
  },
  {
    id: "crane_lr1300",
    name: "Liebherr LR 1300 (300톤)",
    ratedCapacity: 300,
    defaultBoomLength: 20,
    defaultWorkingRadius: 4.3,
    defaultCapacityAtPoint: 300,
    source: "Liebherr LR 1300: 300 t × 4.3 m (published max)",
    chartVerified: false,
    loadChart: [],
  },
];
