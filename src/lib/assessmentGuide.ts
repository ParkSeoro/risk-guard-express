import type { AssessmentPreflightJump } from "@/lib/assessmentSubmitPreflight";
import { OCCASIONAL_REASON_EMPTY, WORKER_PARTICIPATION_EMPTY } from "@/lib/assessmentSubmitPreflight";

export type GuideJump = AssessmentPreflightJump | null;

export function nextAssessmentGuide(opts: {
  approved: boolean;
  runType?: string | null;
  occasionalReason?: string | null;
  itemCount: number;
  participantCount: number;
  opinionCount: number;
  photoCount: number;
  repRequested: boolean;
  repGap: string | null;
  hasRepresentative: boolean;
  trivialExclusionCount: number;
  emptyExclusionCount: number;
}): { text: string; jump: GuideJump } {
  if (opts.approved) {
    return { text: "이 회차는 승인되어 고칠 수 없습니다", jump: null };
  }
  if (String(opts.runType || "") === "수시" && !String(opts.occasionalReason || "").trim()) {
    return { text: `다음은 수시 사유입니다. ${OCCASIONAL_REASON_EMPTY}`, jump: "run" };
  }
  if (opts.trivialExclusionCount > 0) {
    return { text: "제외 사유를 다시 적으세요", jump: "items" };
  }
  if (opts.emptyExclusionCount > 0) {
    return { text: "제외 사유가 비어 있습니다", jump: "items" };
  }
  if (opts.itemCount <= 0) {
    return { text: "항목이 없습니다. 이 공종 채우기 또는 직접 추가", jump: "items" };
  }
  if (opts.opinionCount <= 0 && opts.photoCount <= 0 && opts.participantCount <= 0) {
    return { text: WORKER_PARTICIPATION_EMPTY, jump: "participation" };
  }
  if (opts.participantCount <= 0) {
    return { text: "다음은 참여자입니다.", jump: "participation" };
  }
  if (opts.repRequested && opts.repGap) {
    return { text: opts.repGap, jump: "participation" };
  }
  return {
    text: opts.hasRepresentative
      ? "결재선을 저장한 뒤 상신하세요."
      : "없어도 다음으로 갑니다. 지정은 근로자 관리에 있습니다. 결재선을 저장한 뒤 상신하세요.",
    jump: "approval",
  };
}
