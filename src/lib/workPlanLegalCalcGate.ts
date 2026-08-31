/**
 * 작업계획서 결재 상신 게이트 — 리깅 부적합 / 법정계산 부적합·미실시.
 * 중량물·철골은 리깅 결과만 본다 (법정계산 탭의 85% 재입력을 게이트로 쓰지 않음).
 */
import { calculateFullRigging } from "@/lib/riggingCalculator";
import { buildRiggingInputFromRow } from "@/lib/riggingDerived";
import { isRiggingPlanReady, type RiggingPlanRow } from "@/lib/riggingPlanPersist";
import type { CalcVerdict } from "@/lib/workPlanCalculators";

export const LEGAL_CALC_SECTION_KEY = "_legal_calc";

export type LegalCalcSnapshotEntry = {
  id: string;
  label: string;
  verdict: CalcVerdict;
  conclusion: string;
  legalBasis?: string;
};

export type LegalCalcSnapshot = {
  updatedAt: string;
  entries: LegalCalcSnapshotEntry[];
};

export type WorkPlanApprovalBlocker = {
  tab: "rigging" | "calculator" | "sections";
  title: string;
  detail: string;
};

/** 리깅이 없는 공종에서 상신 전 결과가 있어야 하는 법정계산 id */
export const REQUIRED_LEGAL_CALC_IDS: Record<string, string[]> = {
  excavation: ["excavation_slope"],
  high_work: ["fall_protection"],
  scaffold: ["scaffold_load"],
  confined_space: ["confined_atmosphere"],
  tunnel: ["ventilation"],
  demolition: ["demolition_zone"],
  electrical: ["electrical_approach"],
};

export function workTypeUsesRiggingGate(workType: string | undefined | null): boolean {
  return workType === "heavy_lifting" || workType === "steel" || workType === "bridge";
}

export function parseLegalCalcSnapshot(raw: unknown): LegalCalcSnapshot | null {
  if (!raw) return null;
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const entries = (obj as LegalCalcSnapshot)?.entries;
  if (!Array.isArray(entries)) return null;
  return {
    updatedAt: String((obj as LegalCalcSnapshot).updatedAt || ""),
    entries: entries.filter((e) => e && e.id && e.verdict),
  };
}

export function extractLegalCalcSnapshot(sections: Array<{ key?: string; content?: string }>): LegalCalcSnapshot | null {
  const row = (sections || []).find((s) => s.key === LEGAL_CALC_SECTION_KEY);
  return parseLegalCalcSnapshot(row?.content);
}

export function upsertLegalCalcSection<T extends { key: string; title?: string; type?: string; content?: string }>(
  sections: T[],
  snapshot: LegalCalcSnapshot,
): T[] {
  const content = JSON.stringify(snapshot);
  const next = sections.filter((s) => s.key !== LEGAL_CALC_SECTION_KEY);
  next.push({
    key: LEGAL_CALC_SECTION_KEY,
    title: "법정계산",
    type: "calc",
    content,
  } as T);
  return next;
}

export function isOkFlag(v: unknown): boolean {
  if (v === true) return true;
  const s = String(v || "").trim().toUpperCase();
  return s === "O.K" || s === "OK" || s === "O.K.";
}

/** 숫자만 있으면 ready, 장비·줄걸이·샤클이 모두 적합해야 safe. */
export function isRiggingPlanSafe(rigging: RiggingPlanRow | null | undefined): boolean {
  if (!isRiggingPlanReady(rigging)) return false;
  const refreshed = calculateFullRigging(buildRiggingInputFromRow(rigging as RiggingPlanRow));
  return refreshed.overallOk === true;
}

export function buildRiggingLegalCalcEntry(rigging: RiggingPlanRow): LegalCalcSnapshotEntry {
  const r = calculateFullRigging(buildRiggingInputFromRow(rigging));
  return {
    id: "rigging_overall",
    label: "리깅플랜 종합 안전성",
    verdict: r.overallOk ? "pass" : "fail",
    conclusion: r.overallOk
      ? `적합 — 장비 안전율 ${r.equipmentSafetyFactor.toFixed(2)}`
      : (r.messages.find((m) => m.includes("부적합")) || "리깅플랜 부적합").replace(/^⚠️\s*/, ""),
    legalBasis: "산업안전보건기준에 관한 규칙 제38조 별표 4(중량물), 제132조~제146조",
  };
}

export function evaluateWorkPlanApprovalGates(opts: {
  workType: string;
  rigging?: RiggingPlanRow | null;
  snapshot?: LegalCalcSnapshot | null;
}): WorkPlanApprovalBlocker[] {
  const blockers: WorkPlanApprovalBlocker[] = [];

  if (workTypeUsesRiggingGate(opts.workType)) {
    if (!isRiggingPlanReady(opts.rigging)) {
      blockers.push({
        tab: "rigging",
        title: "리깅플랜이 필요합니다",
        detail: "인양 중량·작업 반경·크레인·정격하중을 입력하고 안전율이 계산된 뒤 상신하세요.",
      });
      return blockers;
    }
    if (!isRiggingPlanSafe(opts.rigging)) {
      const r = calculateFullRigging(buildRiggingInputFromRow(opts.rigging as RiggingPlanRow));
      const ng = [
        !r.equipmentOk && "장비",
        !r.slingOk && "줄걸이",
        !r.shackleOk && "샤클",
      ].filter(Boolean).join("·");
      blockers.push({
        tab: "rigging",
        title: "리깅플랜 부적합 — 상신할 수 없습니다",
        detail: `${ng || "항목"} N.G. 정격·줄걸이·샤클을 조정한 뒤 다시 상신하세요.`,
      });
    }
    return blockers;
  }

  const required = REQUIRED_LEGAL_CALC_IDS[opts.workType] || [];
  if (required.length === 0) return blockers;

  const entries = opts.snapshot?.entries || [];
  for (const id of required) {
    const hit = entries.find((e) => e.id === id);
    if (!hit) {
      blockers.push({
        tab: "calculator",
        title: "법정계산 미실시",
        detail: "해당 공종 법정계산을 입력·판정한 뒤 상신하세요.",
      });
      continue;
    }
    if (hit.verdict === "fail") {
      blockers.push({
        tab: "calculator",
        title: "법정계산 부적합 — 상신할 수 없습니다",
        detail: hit.conclusion || `${hit.label} 부적합`,
      });
    }
  }
  return blockers;
}
