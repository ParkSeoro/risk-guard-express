import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type WorkerDetail = {
  worker: any;
  requiredItems: any[];
  checkups: any[];
  educations: any[];
  dailyLogs: any[];
  recentEntries: any[];
  warnings: any[];
};

export function useWorker(workerId: string | undefined) {
  return useQuery<WorkerDetail | null>({
    queryKey: ["worker-detail", workerId],
    enabled: !!workerId,
    queryFn: async () => {
      if (!workerId) return null;
      const [
        workerRes,
        reqRes,
        checkupRes,
        eduRes,
        logRes,
        entryRes,
        warnRes,
      ] = await Promise.all([
        supabase.from("workers").select("*").eq("id", workerId).maybeSingle(),
        supabase
          .from("worker_required_items")
          .select("*")
          .eq("worker_id", workerId)
          .eq("is_deleted", false)
          .order("due_date", { ascending: true }),
        supabase
          .from("health_checkups")
          .select("*")
          .eq("worker_id", workerId)
          .order("conducted_date", { ascending: false })
          .limit(20),
        supabase
          .from("health_education_logs")
          .select("*")
          .eq("worker_id", workerId)
          .order("conducted_at", { ascending: false })
          .limit(20),
        supabase
          .from("worker_daily_health_logs")
          .select("*")
          .eq("worker_id", workerId)
          .eq("is_deleted", false)
          .order("log_date", { ascending: false })
          .limit(60),
        supabase
          .from("worker_entry_logs")
          .select("*")
          .eq("worker_id", workerId)
          .order("entry_at", { ascending: false })
          .limit(30),
        supabase.rpc("get_worker_health_warnings", { _worker_id: workerId }),
      ]);

      const warningsRaw = (warnRes.data as any) ?? { warnings: [] };
      return {
        worker: workerRes.data,
        requiredItems: reqRes.data || [],
        checkups: checkupRes.data || [],
        educations: eduRes.data || [],
        dailyLogs: logRes.data || [],
        recentEntries: entryRes.data || [],
        warnings: warningsRaw.warnings || [],
      };
    },
  });
}

export function calcAge(birthDate?: string | null): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  if (isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) age--;
  return age;
}

export const JOB_TYPE_LABELS: Record<string, string> = {
  general: "일반작업",
  office: "사무직",
  manager: "관리감독자",
  hazardous: "유해위험작업",
  chemical: "화학물질 취급",
};

export const REQ_TYPE_LABELS: Record<string, string> = {
  new_hire: "신규 채용자 교육",
  regular: "정기 안전보건교육",
  special: "특별교육",
  manager: "관리감독자 교육",
  general_health: "일반 건강진단",
  special_health: "특수 건강진단",
  age65: "고령자 일일 건강일지",
  health_d: "유소견자 일일 건강일지",
};
