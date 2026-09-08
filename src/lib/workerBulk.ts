import { isClaimableOrphanWorker } from "@/lib/companyLabel";

function digits(input?: string | null): string {
  return String(input || "").replace(/\D/g, "");
}

export type BulkPhoneHit = {
  worker_id?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  is_active?: boolean | null;
};

export type BulkPhoneClass =
  | { action: "insert" }
  | { action: "update" }
  | { action: "claim" }
  | {
      action: "transfer";
      workerId: string;
      sourceCompanyId: string | null;
      sourceCompanyName: string | null;
      isActive: boolean | null;
    }
  | { error: string };

/** Preview a bulk-import phone against an existing same-project roster row. */
export function classifyBulkPhoneHit(
  hit: BulkPhoneHit | null | undefined,
  destCompanyId: string,
  destCompanyName?: string | null,
): BulkPhoneClass {
  if (!hit) return { action: "insert" };
  if (hit.company_id == null) {
    if (isClaimableOrphanWorker(hit, destCompanyId, destCompanyName)) {
      return { action: "claim" };
    }
    return { error: "동일 연락처의 기존 근로자 업체명과 일치하지 않아 귀속할 수 없습니다" };
  }
  if (hit.company_id === destCompanyId) return { action: "update" };
  const workerId = String(hit.worker_id || "").trim();
  if (!workerId) {
    return { error: "동일 연락처가 다른 업체에 이미 등록되어 있습니다" };
  }
  return {
    action: "transfer",
    workerId,
    sourceCompanyId: hit.company_id,
    sourceCompanyName: hit.company_name || null,
    isActive: hit.is_active ?? true,
  };
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
