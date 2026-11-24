/**
 * Work-Plan All-Type AI Draft Helpers.
 *
 * Design principles:
 *  - Every editable body section across all 20 work-plan types can be AI-drafted.
 *  - Batch "AI로 빈 본문 한 번에 초안 작성" ONLY fills empty sections and NEVER
 *    overwrites content already written by the user.
 *  - Users can freely edit every AI-drafted field to match real site conditions.
 *  - Passes actual equipment/rigging specs as context so drafts are site-specific.
 */
import { LEGAL_CALC_SECTION_KEY } from './workPlanLegalCalcGate';

export interface DraftSectionLike {
  key?: string;
  type?: string;
  title?: string;
  content?: string;
}

/** Whether a section supports per-section [AI 작성] button. */
export function isAiDraftableSection(section: DraftSectionLike): boolean {
  const key = String(section.key || '').trim();
  if (!key || key.startsWith('_') || key === LEGAL_CALC_SECTION_KEY) return false;
  if (section.type === 'rigging' || section.type === 'calc' || section.type === 'checklist') return false;
  return true;
}

/** Whether a section is eligible for batch "빈 본문 한 번에 초안 작성" (excludes overview/equipment). */
export function isBatchAiDraftSection(section: DraftSectionLike): boolean {
  if (!isAiDraftableSection(section)) return false;
  if (section.key === 'overview' || section.key === 'equipment') return false;
  return true;
}

/**
 * Pure detector: returns true ONLY when a section has no meaningful user input yet,
 * so batch AI drafting never overwrites user-edited sections.
 */
export function isSectionEmptyForAiDraft(section: DraftSectionLike): boolean {
  const raw = String(section.content || '').trim();
  if (!raw) return true;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return true;
      return parsed.every((item) => {
        if (!item || typeof item !== 'object') return !String(item ?? '').trim();
        // For method/risk/equipment arrays, ignore static labels/flags like order/key/hazard/severity/locked/label
        const meaningfulValues = Object.entries(item)
          .filter(([k]) => !['order', 'key', 'hazard', 'severity', 'locked', 'label'].includes(k))
          .map(([, v]) => String(v ?? '').trim());
        return meaningfulValues.every((v) => v === '');
      });
    }
    if (parsed && typeof parsed === 'object') {
      return Object.values(parsed).every((v) => String(v ?? '').trim() === '');
    }
  } catch {
    // Plain text with non-empty content -> user wrote something
    return false;
  }

  return false;
}

/**
 * Builds a concise equipment context string from the `equipment` section and `rigging`
 * so `generate-risk-ai` produces equipment-specific procedures and controls.
 */
export function buildEquipmentContextSummary(
  sections: DraftSectionLike[],
  rigging?: Record<string, unknown> | null,
): string {
  const parts: string[] = [];

  const eqSec = sections.find((s) => s.key === 'equipment');
  if (eqSec?.content) {
    try {
      const parsed = JSON.parse(eqSec.content);
      if (Array.isArray(parsed)) {
        for (const row of parsed) {
          const name = String(row?.name || '').trim();
          if (!name) continue;
          const cap = row?.capacity ? ` (${row.capacity}t)` : '';
          const model = row?.model ? ` [${row.model}]` : '';
          parts.push(`${name}${model}${cap}`);
        }
      }
    } catch {
      const txt = eqSec.content.trim();
      if (txt) parts.push(txt.slice(0, 120));
    }
  }

  const rigModel = String(rigging?.crane_model || rigging?.equipment_name || '').trim();
  const rigCap = Number(rigging?.crane_capacity || rigging?.rated_capacity || 0);
  if (rigModel && !parts.some((p) => p.includes(rigModel))) {
    parts.push(`${rigModel}${rigCap > 0 ? ` (${rigCap}t)` : ''}`);
  }

  return parts.join(', ');
}
