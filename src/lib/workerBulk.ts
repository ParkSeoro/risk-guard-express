/** Map upsert_project_workers_bulk row errors to short Korean labels. */
export function formatWorkerBulkRowError(error?: string | null): string {
  const e = String(error || "").trim();
  if (!e) return "알 수 없는 오류";
  if (/gen_random_bytes/i.test(e)) return "QR 토큰 생성 실패(DB)";
  if (e === "INVALID_ROW") return "이름·전화·직종이 올바르지 않음";
  if (e === "OTHER_COMPANY") return "다른 회사 소속 전화번호";
  return e;
}
