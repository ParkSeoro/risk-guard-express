/**
 * Client helper: ask Edge Function to create Auth logins for roster workers.
 * ID = phone digits (@worker.local), password = last 4 digits.
 * Existing Auth users are linked only (password not overwritten).
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeWorkerPhone } from "@/lib/workerAuth";

export type ProvisionWorkerInput = {
  phone: string;
  name: string;
  job_type?: string | null;
};

export type ProvisionWorkerResult = {
  ok: boolean;
  created: number;
  linked: number;
  failed: number;
  results?: Array<{ phone: string; status: string; error?: string }>;
  error?: string;
};

export async function provisionWorkerAccounts(args: {
  projectId: string;
  companyId: string;
  companyName?: string;
  workers: ProvisionWorkerInput[];
}): Promise<ProvisionWorkerResult> {
  const workers = (args.workers || [])
    .map((w) => ({
      phone: normalizeWorkerPhone(w.phone),
      name: String(w.name || "").trim(),
      job_type: w.job_type || null,
    }))
    .filter((w) => w.phone.length >= 10 && w.name);

  if (workers.length === 0) {
    return { ok: true, created: 0, linked: 0, failed: 0 };
  }

  const { data, error } = await supabase.functions.invoke("provision-worker-accounts", {
    body: {
      project_id: args.projectId,
      company_id: args.companyId,
      company_name: args.companyName || "",
      workers,
    },
  });

  if (error) {
    return {
      ok: false,
      created: 0,
      linked: 0,
      failed: workers.length,
      error: error.message,
    };
  }

  const body = data as any;
  if (!body?.ok) {
    return {
      ok: false,
      created: 0,
      linked: 0,
      failed: workers.length,
      error: body?.message || body?.error || "계정 생성 실패",
      results: body?.results,
    };
  }

  return {
    ok: true,
    created: Number(body.created || 0),
    linked: Number(body.linked || 0),
    failed: Number(body.failed || 0),
    results: body.results,
  };
}
