import { ENTITY_LABELS, type ApprovalEntityType } from "@/lib/approvalRules";

/** 알림 트리거가 entity_type 키를 제목/본문에 그대로 넣은 경우 결재 화면과 같은 한글명으로 치환. */
export function localizeNotificationText(text: string): string {
  let out = String(text || "");
  if (!out) return out;
  const keys = (Object.keys(ENTITY_LABELS) as ApprovalEntityType[]).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of keys) {
    if (out.includes(key)) out = out.split(key).join(ENTITY_LABELS[key]);
  }
  if (out.includes("위험성평가 피드백(조치)")) {
    out = out.split("위험성평가 피드백(조치)").join(ENTITY_LABELS.assessment_run_feedback);
  }
  return out;
}

const KIND_BY_TYPE: Record<string, string> = {
  chat_message: "메신저",
  approval_request: "결재",
  approval_result: "결재",
  approval_rejected: "결재",
  approval_approved: "결재",
  return_request: "결재",
  announcement: "공지",
  assessment_share: "위험성평가",
  incident: "사고",
  incident_report: "사고",
  tbm: "TBM",
  tbm_sign_due: "TBM",
  work_permit: "허가서",
  permit_expiry: "허가서",
  work_plan_due: "작업계획서",
  safety_inspection: "안전점검",
  inspection_fail: "안전점검",
  work_stop: "작업중지",
  work_stop_request: "작업중지",
  danger_zone_entry: "위험구역",
  todo_due: "할 일",
  signup_pending: "가입",
};

const KIND_BY_RELATED: Record<string, string> = {
  chat_room: "메신저",
  work_permit: "허가서",
  assessment_run: "위험성평가",
  assessment_run_feedback: "위험성평가",
  work_plan: "작업계획서",
  announcement: "공지",
  tbm_session: "TBM",
  incident_report: "사고",
  safety_inspection: "안전점검",
};

/** Short kind shown in the inbox. Unknown types stay blank instead of showing a raw key. */
export function notificationKindLabel(
  n: { type?: string | null; related_type?: string | null } | null | undefined,
): string {
  const type = String(n?.type || "").trim().toLowerCase();
  if (KIND_BY_TYPE[type]) return KIND_BY_TYPE[type];
  const related = String(n?.related_type || "").trim().toLowerCase();
  return KIND_BY_RELATED[related] || "";
}

export function notificationTitle(
  n: { title?: string | null } | null | undefined,
): string {
  return localizeNotificationText(String(n?.title || "").trim());
}

/** 알림 본문 — 구형 트리거는 message 가 비고 body 에만 사유를 넣는다. */
export function notificationPreview(
  n: { message?: string | null; body?: string | null } | null | undefined,
): string {
  const message = localizeNotificationText(String(n?.message || "").trim());
  if (message) return message;
  return localizeNotificationText(String(n?.body || "").trim());
}
