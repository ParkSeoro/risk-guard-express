import { splitApprovalTimeline, type ApprovalTimelineStep } from "@/lib/permitPostApproval";

export type RejectionNote = {
  id: string;
  comment: string;
  approverName: string;
  step: string;
  version: number;
  stepOrder: number;
};

function toNote(step: ApprovalTimelineStep): RejectionNote | null {
  if (step.status !== "반려") return null;
  const comment = String(step.comment || "").trim();
  if (!comment) return null;
  const version = step.approval_version || 1;
  const stepOrder = step.step_order ?? 99;
  return {
    id: String(step.id || `${version}-${stepOrder}-${step.step || ""}`),
    comment,
    approverName: String(step.approver_name || "").trim(),
    step: String(step.step || "").trim(),
    version,
    stepOrder,
  };
}

function newestFirst(notes: RejectionNote[]): RejectionNote[] {
  return [...notes].sort((a, b) => b.version - a.version || a.stepOrder - b.stepOrder);
}

/** Rejection comments on the latest issuance round. */
export function currentRejectionNotes(steps: ApprovalTimelineStep[]): RejectionNote[] {
  const { issuanceSteps } = splitApprovalTimeline(steps);
  return newestFirst(issuanceSteps.map(toNote).filter((n): n is RejectionNote => !!n));
}

/** Rejection comments from earlier rounds. Resubmit leaves those rows in place. */
export function priorRejectionNotes(steps: ApprovalTimelineStep[]): RejectionNote[] {
  const { priorIssuanceSteps } = splitApprovalTimeline(steps);
  return newestFirst(priorIssuanceSteps.map(toNote).filter((n): n is RejectionNote => !!n));
}

const RESUBMIT_LINE = /\[재상신\]\s*([^\n]+)/g;

/** The reason typed on resubmit. It is stored on the round that was closed, not on [상신 완료]. */
export function latestResubmitNotes(steps: ApprovalTimelineStep[]): RejectionNote[] {
  const found: RejectionNote[] = [];
  for (const step of steps || []) {
    const comment = String(step.comment || "");
    const version = step.approval_version || 1;
    for (const match of comment.matchAll(RESUBMIT_LINE)) {
      const text = match[1].trim();
      if (!text) continue;
      found.push({
        id: `${step.id || version}-resubmit-${found.length}`,
        comment: text,
        approverName: "",
        step: "",
        version,
        stepOrder: step.step_order ?? 99,
      });
    }
  }
  if (!found.length) return [];
  const max = Math.max(...found.map((note) => note.version));
  const seen = new Set<string>();
  const latest: RejectionNote[] = [];
  for (const note of found) {
    if (note.version !== max || seen.has(note.comment)) continue;
    seen.add(note.comment);
    latest.push(note);
  }
  return latest;
}

export function hasInFlightApproval(steps: ApprovalTimelineStep[]): boolean {
  const { issuanceSteps } = splitApprovalTimeline(steps);
  return issuanceSteps.some((s) => s.status === "대기" || s.status === "진행중");
}

/**
 * What the document screen should show.
 * Current rejection while the round is still 반려.
 * Earlier rejection once a new round is in flight, so the approver still sees it.
 */
export function visibleDocumentRejection(
  steps: ApprovalTimelineStep[],
  fallbackReason?: string | null,
): { title: string; notes: RejectionNote[] } | null {
  const current = currentRejectionNotes(steps);
  if (current.length) return { title: "반려 사유", notes: current };
  const prior = priorRejectionNotes(steps);
  if (prior.length && hasInFlightApproval(steps)) return { title: "이전 반려 사유", notes: prior };
  const fallback = String(fallbackReason || "").trim();
  if (!fallback) return null;
  return {
    title: "반려 사유",
    notes: [{ id: "fallback", comment: fallback, approverName: "", step: "", version: 1, stepOrder: 0 }],
  };
}
