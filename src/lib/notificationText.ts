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
  return out;
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
