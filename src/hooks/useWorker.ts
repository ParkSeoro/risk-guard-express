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
  // 일반 분류
  general: "일반작업(건설일용)",
  construction_perm: "건설 상시근로자",
  office: "사무직",
  manager: "관리감독자",
  safety_officer: "안전보건관리책임자/관리자",
  // 위험·특별교육 대상 직종 (산안법 시행규칙 [별표5])
  hazardous: "유해·위험작업(일반)",
  chemical: "화학물질 취급",
  asbestos: "석면해체·제거",
  confined: "밀폐공간 작업",
  welding: "용접·용단",
  height: "고소작업(2m↑)",
  scaffold: "비계 조립·해체",
  formwork: "거푸집·동바리",
  demolition: "구조물 해체",
  excavation: "굴착·흙막이",
  electrical: "전기작업(활선)",
  crane_signal: "크레인 신호수",
  heavy_equipment: "건설기계 운전",
  rigging: "양중·줄걸이",
  // 보호 대상
  night_shift: "야간작업자",
  elderly: "고령근로자(55세↑)",
  foreign: "외국인 근로자",
  young: "연소근로자(18세 미만)",
  pregnant: "임산부/모성보호 대상",
  short_term: "단시간/기간제",
};

export const REQ_TYPE_LABELS: Record<string, string> = {
  new_hire: "신규 채용자 교육",
  new_hire_construction: "건설업 기초안전보건교육",
  regular: "정기 안전보건교육",
  special: "특별교육",
  job_change: "작업내용 변경시 교육",
  manager: "관리감독자 교육",
  msds: "MSDS 교육(화학물질)",
  general_health: "일반 건강진단",
  special_health: "특수 건강진단",
  night_health: "야간작업자 특수건진",
  pre_placement_health: "배치 전 건강진단",
  msd_survey: "근골격계 유해요인조사",
  foreign_safety: "외국인 안전보건교육",
  young_protection: "연소근로자 보호교육",
  pregnant_protection: "모성보호 교육",
  age65: "고령자 일일 건강일지",
  health_d: "유소견자 일일 건강일지",
};
