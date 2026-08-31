/**
 * 별표 4 (제38조①) — 중량물 취급 작업계획서 필수 5대 대책.
 * 자유 행이 아니라 고정 칸. AI는 이 칸만 채운다.
 */

export const HEAVY_LIFT_LEGAL_HAZARDS = [
  { key: "fall", hazard: "추락", label: "추락위험을 예방할 수 있는 안전대책" },
  { key: "drop", hazard: "낙하", label: "낙하위험을 예방할 수 있는 안전대책" },
  { key: "tip", hazard: "전도", label: "전도위험을 예방할 수 있는 안전대책" },
  { key: "pinch", hazard: "협착", label: "협착위험을 예방할 수 있는 안전대책" },
  { key: "collapse", hazard: "붕괴", label: "붕괴위험을 예방할 수 있는 안전대책" },
] as const;

export type HeavyLiftHazardKey = (typeof HEAVY_LIFT_LEGAL_HAZARDS)[number]["key"];

export type LegalRiskRow = {
  key: HeavyLiftHazardKey | string;
  hazard: string;
  situation: string;
  measure: string;
  severity: string;
  locked?: boolean;
};

const HAZARD_ALIASES: Record<HeavyLiftHazardKey, RegExp> = {
  fall: /추락|떨어/,
  drop: /낙하|맞음|낙하물/,
  tip: /전도|뒤집|넘어/,
  pinch: /협착|끼임/,
  collapse: /붕괴|무너/,
};

export function usesFixedLegalRisk(workType: string | undefined | null): boolean {
  return workType === "heavy_lifting";
}

export function emptyLegalRiskRows(): LegalRiskRow[] {
  return HEAVY_LIFT_LEGAL_HAZARDS.map((h) => ({
    key: h.key,
    hazard: h.hazard,
    situation: "",
    measure: "",
    severity: "중",
    locked: true,
  }));
}

/** Map free-form / AI arrays onto the five statutory slots. Extra rows are dropped. */
export function normalizeRiskToLegalSlots(raw: unknown): LegalRiskRow[] {
  const slots = emptyLegalRiskRows();
  const incoming = Array.isArray(raw) ? raw : [];
  const used = new Set<number>();

  for (const slot of slots) {
    const re = HAZARD_ALIASES[slot.key as HeavyLiftHazardKey];
    const idx = incoming.findIndex((row, i) => {
      if (used.has(i) || !row) return false;
      const text = `${row.key || ""} ${row.hazard || ""} ${row.label || ""}`;
      return re.test(text);
    });
    if (idx >= 0) {
      used.add(idx);
      const row = incoming[idx] as Record<string, unknown>;
      slot.situation = String(row.situation || row.hazard_situation || "").trim();
      slot.measure = String(row.measure || row.improvement_measure || "").trim();
      slot.severity = String(row.severity || row.likelihood_grade || "중") || "중";
    }
  }

  // Fill leftover empty slots from unused AI rows (situation/measure only).
  for (const slot of slots) {
    if (slot.measure) continue;
    const idx = incoming.findIndex((_, i) => !used.has(i));
    if (idx < 0) break;
    used.add(idx);
    const row = incoming[idx] as Record<string, unknown>;
    slot.situation = String(row.situation || row.hazard || "").trim();
    slot.measure = String(row.measure || row.improvement_measure || "").trim();
    slot.severity = String(row.severity || "중") || "중";
  }

  return slots;
}

export function parseRiskContent(value: string | undefined | null): unknown {
  if (!value?.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function validateHeavyLiftLegalRisk(value: string): string[] {
  const parsed = parseRiskContent(value);
  const rows = normalizeRiskToLegalSlots(parsed);
  const missing = rows.filter((r) => !r.measure.trim());
  if (missing.length === 0) return [];
  return [
    `별표 4 필수 대책 미기재: ${missing.map((r) => r.hazard).join(", ")}`,
  ];
}
