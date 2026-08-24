/** 알림 본문 — 구형 트리거는 message 가 비고 body 에만 사유를 넣는다. */
export function notificationPreview(
  n: { message?: string | null; body?: string | null } | null | undefined,
): string {
  const message = String(n?.message || "").trim();
  if (message) return message;
  return String(n?.body || "").trim();
}
