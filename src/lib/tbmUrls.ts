/** Manager QR / 미로그인 스캔용 공개 TBM URL */
export const PUBLIC_TBM_ORIGIN = "https://safenex.org";

export function tbmPublicUrl(token: string): string {
  return `${PUBLIC_TBM_ORIGIN}/tbm/${encodeURIComponent(token)}`;
}

/** 로그인 근로자 — 앱 셸 안에서 참여 (외부 브라우저로 나가지 않음) */
export function tbmInAppPath(token: string): string {
  return `/app/worker/tbm/${encodeURIComponent(token)}`;
}
