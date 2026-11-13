/** 개선대책 수립 완료일. 보존은 다음 날부터 3년. 완료일이 없으면 잠그지 않는다. */

export function seoulTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function retentionUnlockDate(completedOn: string | null | undefined): string | null {
  const raw = String(completedOn || "").slice(0, 10);
  const [y, m, d] = raw.split("-").map((n) => Number(n));
  if (!y || !m || !d) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  dt.setUTCFullYear(dt.getUTCFullYear() + 3);
  return dt.toISOString().slice(0, 10);
}

export function retentionBlocksDelete(
  completedOn: string | null | undefined,
  today = seoulTodayIso(),
): boolean {
  const unlock = retentionUnlockDate(completedOn);
  if (!unlock) return false;
  return today < unlock;
}

export function improvementPlanDateLabel(completedOn: string | null | undefined): string | null {
  const raw = String(completedOn || "").slice(0, 10);
  const [, m, d] = raw.split("-").map((n) => Number(n));
  if (!m || !d) return null;
  return `개선대책 수립일 ${m}월 ${d}일. 보존은 다음 날부터 3년`;
}

export function retentionLockMessage(completedOn: string | null | undefined): string {
  return `${improvementPlanDateLabel(completedOn) || "보존 기간"}이라 아직 삭제할 수 없습니다.`;
}
