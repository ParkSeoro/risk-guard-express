/**
 * Pure helper for the WorkPlanDetail sticky "Next Action" jump bar.
 * Surfaces every remaining prerequisite before approval submission with a 1-click tab target.
 */
import {
  evaluateWorkPlanApprovalGates,
  type LegalCalcSnapshot,
  type LegalCalcSnapshotEntry,
} from "@/lib/workPlanLegalCalcGate";
import { hasWorkPlanLegalAuthor } from "@/lib/workPlanAuthor";

export type WorkPlanNextAction = {
  id: string;
  label: string;
  tab: "basic" | "sections" | "rigging" | "calculator" | "attachments" | "author";
};

export function computeWorkPlanNextActions(opts: {
  workType: string;
  startDate?: string | null;
  endDate?: string | null;
  authorUserId?: string | null;
  rigging?: Record<string, unknown> | null;
  legalCalcSnapshot?: LegalCalcSnapshot | null;
  legalCalcEntries?: LegalCalcSnapshotEntry[];
  mandatoryMissing?: number;
}): WorkPlanNextAction[] {
  const actions: WorkPlanNextAction[] = [];

  if (!opts.startDate || !opts.endDate || opts.endDate < opts.startDate) {
    actions.push({ id: "dates", label: "작업기간 입력", tab: "basic" });
  }

  if (!hasWorkPlanLegalAuthor(opts.authorUserId)) {
    actions.push({ id: "author", label: "관리감독자 지정", tab: "author" });
  }

  const snapshot: LegalCalcSnapshot | null =
    opts.legalCalcSnapshot ??
    (opts.legalCalcEntries && opts.legalCalcEntries.length > 0
      ? { updatedAt: "", entries: opts.legalCalcEntries }
      : null);

  const gates = evaluateWorkPlanApprovalGates({
    workType: opts.workType,
    rigging: opts.rigging ?? null,
    snapshot,
  });
  const seenTabs = new Set<string>();
  for (const g of gates) {
    if (seenTabs.has(g.tab)) continue;
    seenTabs.add(g.tab);
    actions.push({
      id: `gate-${g.tab}`,
      label: g.title || (g.tab === "rigging" ? "리깅플랜 검토" : g.tab === "calculator" ? "법정계산 확인" : "법정 항목 확인"),
      tab: g.tab,
    });
  }

  const missing = opts.mandatoryMissing ?? 0;
  if (missing > 0) {
    actions.push({
      id: "attachments",
      label: `필수 첨부 ${missing}건`,
      tab: "attachments",
    });
  }

  return actions;
}
