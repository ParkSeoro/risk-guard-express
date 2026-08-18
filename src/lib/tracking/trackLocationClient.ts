/** User-visible copy when track-location rejects the JWT/body identity. */
export const TRACK_LOCATION_IDENTITY_DENIED =
  "GPS 신원 거부: 이 계정과 근로자 명부가 일치하지 않습니다. 관리자에게 문의하세요.";

export function isTrackLocationIdentityDenied(message: string | null | undefined): boolean {
  const m = String(message || "");
  return /Identity mismatch/i.test(m) || /신원 거부/.test(m);
}

/**
 * Map supabase.functions.invoke error to a chip/toast string.
 * 403 identity mismatch is never silent — GPS looks "on" locally while the
 * server drops every ping.
 */
export function trackLocationInvokeUserMessage(error: {
  message?: string | null;
  context?: { status?: number } | null;
} | null | undefined): string | null {
  if (!error) return null;
  const raw = String(error.message || "");
  if (isTrackLocationIdentityDenied(raw)) return TRACK_LOCATION_IDENTITY_DENIED;
  const status = error.context?.status;
  if (status === 403 || /Forbidden/i.test(raw)) {
    return "GPS 거부: 이 프로젝트에서 위치를 보낼 수 없습니다.";
  }
  return raw || "위치 전송에 실패했습니다.";
}
