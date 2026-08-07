/**
 * 산안비 비목별 증빙 안내 (UI 요약)
 * 상세 게이트/철 순서는 safetyCostEvidencePack.ts 가 SSOT
 */
import { CATEGORY_EVIDENCE_PACK, getCategoryPack } from "@/lib/safetyCostEvidencePack";

export type EvidenceGuideItem = {
  code: string;
  name: string;
  requiredEvidence: string[];
  tips: string[];
};

export const SAFETY_COST_EVIDENCE_GUIDE: EvidenceGuideItem[] = CATEGORY_EVIDENCE_PACK.map((p) => ({
  code: p.code,
  name: p.name,
  requiredEvidence: p.requirements.filter((r) => r.hard).map((r) => r.label),
  tips: p.tips,
}));

export function getEvidenceGuide(categoryCode?: string | null): EvidenceGuideItem | null {
  const p = getCategoryPack(categoryCode);
  if (!p) return null;
  return {
    code: p.code,
    name: p.name,
    requiredEvidence: p.requirements.filter((r) => r.hard).map((r) => r.label),
    tips: p.tips,
  };
}

export function evidenceGuideSummary(categoryCode?: string | null): string {
  const g = getEvidenceGuide(categoryCode);
  if (!g) return "분류를 선택하면 필요 증빙이 안내됩니다.";
  return `필요 증빙: ${g.requiredEvidence.join(" · ")}`;
}
