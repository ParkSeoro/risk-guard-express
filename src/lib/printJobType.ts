import { supabase } from "@/integrations/supabase/client";
import { phoneDigits } from "@/lib/permitCrewSignatures";

export type JobTypeSource = {
  id?: string | null;
  phone?: string | null;
  job_type?: string | null;
};

export type JobTypeSigner = {
  id?: string | null;
  worker_id?: string | null;
  phone?: string | null;
  worker_phone?: string | null;
};

/** id first, then phone digits, so a hyphenated roster still matches. */
export function indexWorkerJobTypes(workers: JobTypeSource[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const worker of workers) {
    const job = String(worker.job_type || "").trim();
    if (!job) continue;
    const id = String(worker.id || "").trim();
    if (id) index.set(`id:${id}`, job);
    const phone = phoneDigits(worker.phone);
    if (phone) index.set(`phone:${phone}`, job);
  }
  return index;
}

export function jobTypeForSigner(index: Map<string, string>, row: JobTypeSigner): string {
  const id = String(row.worker_id || row.id || "").trim();
  if (id) {
    const byId = index.get(`id:${id}`);
    if (byId) return byId;
  }
  const phone = phoneDigits(row.worker_phone || row.phone);
  if (phone) return index.get(`phone:${phone}`) || "";
  return "";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function phoneLookupKeys(phone?: string | null): string[] {
  const raw = String(phone || "").trim();
  const digits = phoneDigits(raw);
  const keys = new Set<string>();
  if (raw) keys.add(raw);
  if (digits) keys.add(digits);
  if (digits.length === 11) keys.add(`${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`);
  if (digits.length === 10) keys.add(`${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`);
  return [...keys];
}

/** Load 직종 for the people on a signature sheet. Missing people stay blank. */
export async function fetchWorkerJobTypeIndex(
  projectId: string,
  signers: JobTypeSigner[],
): Promise<Map<string, string>> {
  if (!projectId || signers.length === 0) return new Map();
  const ids = [...new Set(signers.map((row) => String(row.worker_id || row.id || "").trim()).filter(Boolean))];
  const phones = [...new Set(signers.flatMap((row) => phoneLookupKeys(row.worker_phone || row.phone)))];
  const found: JobTypeSource[] = [];

  for (const idsChunk of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from("workers")
      .select("id, phone, job_type")
      .eq("project_id", projectId)
      .in("id", idsChunk);
    if (error) throw error;
    found.push(...((data || []) as JobTypeSource[]));
  }

  const knownPhones = new Set(found.map((row) => phoneDigits(row.phone)).filter(Boolean));
  const missingPhones = phones.filter((phone) => !knownPhones.has(phoneDigits(phone)));
  for (const phoneChunk of chunk(missingPhones, 100)) {
    const { data, error } = await supabase
      .from("workers")
      .select("id, phone, job_type")
      .eq("project_id", projectId)
      .in("phone", phoneChunk);
    if (error) throw error;
    found.push(...((data || []) as JobTypeSource[]));
  }

  return indexWorkerJobTypes(found);
}
