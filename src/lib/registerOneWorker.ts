import { supabase } from "@/integrations/supabase/client";
import { isClaimableOrphanWorker } from "@/lib/companyLabel";
import { isStandardJobType } from "@/lib/jobCategories";
import { provisionWorkerAccounts, type ProvisionWorkerResult } from "@/lib/provisionWorkerAccounts";
import { digitsOnlyPhone, formatPhoneMask } from "@/lib/workerAuth";
import { formatWorkerBulkRowError } from "@/lib/workerBulk";

export function workerLoginPreview(phone: string): { loginId: string; password: string } | null {
  const digits = digitsOnlyPhone(phone);
  if (digits.length < 10) return null;
  return { loginId: digits, password: digits.slice(-4) };
}

export function formatWorkerPhoneInput(raw: string): string {
  return formatPhoneMask(raw);
}

type PhoneHit = {
  worker_id?: string | null;
  id?: string | null;
  phone?: string | null;
  phone_digits?: string | null;
  company_id?: string | null;
  company_name?: string | null;
};

export type RegisterOneWorkerInput = {
  projectId: string;
  companyId: string;
  companyName: string;
  name: string;
  phone: string;
  jobType: string;
  birthDate?: string | null;
  hireDate?: string | null;
  transferIfOtherCompany?: boolean;
};

export type RegisterOneWorkerResult = {
  ok: boolean;
  action?: "insert" | "update" | "claim" | "transfer";
  provision?: ProvisionWorkerResult;
  error?: string;
  needsTransferConfirm?: {
    workerId: string;
    sourceCompanyName: string | null;
  };
};

async function lookupPhoneHit(projectId: string, phoneDigits: string): Promise<PhoneHit | null> {
  const hits = await (supabase as any).rpc("list_project_worker_phone_hits", {
    _project_id: projectId,
    _phones: [phoneDigits],
  });
  if (!hits.error && Array.isArray(hits.data) && hits.data[0]) {
    return hits.data[0] as PhoneHit;
  }
  const { data } = await supabase
    .from("workers")
    .select("id, phone, company_id, company_name")
    .eq("project_id", projectId)
    .limit(80);
  const match = (data || []).find((w) => digitsOnlyPhone(w.phone) === phoneDigits);
  return match ? { ...match, worker_id: (match as { id?: string }).id } : null;
}

export async function registerOneWorker(
  input: RegisterOneWorkerInput,
): Promise<RegisterOneWorkerResult> {
  const name = String(input.name || "").trim();
  const phoneDigits = digitsOnlyPhone(input.phone);
  const phone = formatPhoneMask(input.phone);
  const jobType = String(input.jobType || "").trim();
  if (!input.projectId) return { ok: false, error: "프로젝트를 먼저 선택하세요" };
  if (!input.companyId) return { ok: false, error: "소속 회사를 선택하세요" };
  if (!name) return { ok: false, error: "이름을 입력하세요" };
  if (phoneDigits.length < 10) return { ok: false, error: "전화번호 형식이 올바르지 않습니다" };
  if (!isStandardJobType(jobType)) return { ok: false, error: "표준 직종을 선택하세요" };

  const hit = await lookupPhoneHit(input.projectId, phoneDigits);
  let action: RegisterOneWorkerResult["action"] = "insert";
  if (hit) {
    if (hit.company_id == null) {
      if (isClaimableOrphanWorker(hit, input.companyId, input.companyName)) action = "claim";
      else return { ok: false, error: "동일 연락처의 기존 근로자 업체명과 일치하지 않아 귀속할 수 없습니다" };
    } else if (hit.company_id === input.companyId) {
      action = "update";
    } else {
      const workerId = String(hit.worker_id || hit.id || "").trim();
      if (!workerId) return { ok: false, error: "동일 연락처가 다른 업체에 이미 등록되어 있습니다" };
      if (!input.transferIfOtherCompany) {
        return {
          ok: false,
          needsTransferConfirm: {
            workerId,
            sourceCompanyName: hit.company_name || null,
          },
        };
      }
      const transferred = await (supabase as any).rpc("transfer_worker_company", {
        _worker_id: workerId,
        _to_company_id: input.companyId,
      });
      if (transferred.error) return { ok: false, error: transferred.error.message };
      if (transferred.data?.error) return { ok: false, error: String(transferred.data.error) };
      action = "transfer";
    }
  }

  const { data: res, error: rpcErr } = await (supabase as any).rpc("upsert_project_workers_bulk", {
    _project_id: input.projectId,
    _company_id: input.companyId,
    _company_name: input.companyName || "",
    _rows: [
      {
        name,
        phone,
        job_type: jobType,
        birth_date: input.birthDate || null,
        hire_date: input.hireDate || null,
      },
    ],
  });
  if (rpcErr) return { ok: false, error: rpcErr.message };
  if (res?.error) return { ok: false, error: String(res.error) };
  const failed = Array.isArray(res?.failed) ? res.failed : [];
  if (failed.length) {
    return { ok: false, error: formatWorkerBulkRowError(failed[0]?.error) };
  }

  const provision = await provisionWorkerAccounts({
    projectId: input.projectId,
    companyId: input.companyId,
    companyName: input.companyName,
    workers: [{ phone, name, job_type: jobType }],
  });

  return { ok: true, action, provision };
}
