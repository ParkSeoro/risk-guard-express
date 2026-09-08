function digits(input?: string | null): string {
  return String(input || "").replace(/\D/g, "");
}

/** Map upsert_project_workers_bulk row errors to short Korean labels. */
export function formatWorkerBulkRowError(error?: string | null): string {
  const e = String(error || "").trim();
  if (!e) return "알 수 없는 오류";
  if (/gen_random_bytes/i.test(e)) return "QR 토큰 생성 실패(DB)";
  if (e === "INVALID_ROW") return "이름·전화·직종이 올바르지 않음";
  if (e === "OTHER_COMPANY") return "다른 회사 소속 전화번호";
  return e;
}

/** Never mint a login for a phone the roster upsert rejected (e.g. OTHER_COMPANY). */
export function phonesEligibleForProvision(opts: {
  validDigits: string[];
  okPhones?: string[] | null;
  failedPhones?: string[] | null;
}): string[] {
  const valid = new Set((opts.validDigits || []).map(digits).filter((d) => d.length >= 9));
  const failed = new Set((opts.failedPhones || []).map(digits).filter(Boolean));
  const ok = (opts.okPhones || []).map(digits).filter((d) => valid.has(d));
  if (ok.length) return [...new Set(ok.filter((d) => !failed.has(d)))];
  return [...valid].filter((d) => !failed.has(d));
}
