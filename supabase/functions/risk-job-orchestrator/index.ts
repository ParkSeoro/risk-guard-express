// 위험성평가 AI 대량 생성 오케스트레이터
// 비동기 백그라운드로 batch 분할 + 병렬 호출 + 진행률 업데이트
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BATCH_SIZE = 30;
const MAX_CONCURRENT = 3;

// inline decomposition map (mirror of src/lib/processDecomposer.ts)
const DECOMPOSITION_MAP: Record<string, string[]> = {
  "굴착": ["굴착", "토사 운반", "되메우기", "배수/물처리", "주변 정리"],
  "터널": ["막장 굴진", "버력 처리", "지보재 설치", "방수/배수", "환기"],
  "쉴드": ["세그먼트 조립", "추진/굴진", "이수/그라우팅", "버력 반출", "주입공 설치"],
  "tbm": ["커터 점검", "굴진", "세그먼트 조립", "버력 처리", "후방대차 이동"],
  "양중": ["줄걸이/슬링 점검", "신호 확인", "인양", "선회/이동", "안착/해체"],
  "고소": ["작업대 설치", "안전대 체결", "자재 운반", "본 작업", "정리/철거"],
  "용접": ["사전 환경 점검", "용접 본작업", "스패터 관리", "잔열 확인", "정리"],
  "밀폐": ["산소/유해가스 측정", "환기 설치", "감시인 배치", "본 작업", "비상 대피"],
  "전기": ["정전 절차", "검전/접지", "본 작업", "복전 점검", "정리"],
  "철근": ["가공", "운반", "조립/결속", "검사", "정리"],
  "거푸집": ["설치", "지지대 점검", "타설 입회", "해체", "정리"],
  "콘크리트": ["타설 준비", "타설", "다짐/마감", "양생", "정리"],
  "비계": ["기초 점검", "조립", "안전난간/발판 설치", "사용 중 점검", "해체"],
  "해체": ["사전 조사", "구조물 분리", "잔재 운반", "분진/소음 관리", "정리"],
  "도장": ["표면 처리", "혼합/조색", "도장 작업", "건조 관리", "정리"],
  "방수": ["바탕면 정리", "프라이머", "방수재 시공", "보호층", "검사"],
  "배관": ["가공/절단", "운반", "용접/접합", "수압 시험", "보온"],
};

function decompose(processName: string, total: number) {
  const lower = (processName || "").toLowerCase();
  let matched: string[] | null = null;
  for (const [k, subs] of Object.entries(DECOMPOSITION_MAP)) {
    if (lower.includes(k.toLowerCase())) { matched = subs; break; }
  }
  if (!matched) return [{ name: processName, count: total }];
  const per = Math.floor(total / matched.length);
  const rem = total % matched.length;
  return matched.map((n, i) => ({
    name: `${processName} - ${n}`,
    count: per + (i < rem ? 1 : 0),
  })).filter(s => s.count > 0);
}

interface BatchTask {
  index: number;
  subProcess: string;
  count: number;
}

async function runBatch(
  admin: any,
  jobId: string,
  task: BatchTask,
  baseBody: any,
  supabaseUrl: string,
  serviceKey: string,
): Promise<any[]> {
  const startTime = Date.now();
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/generate-risk-ai`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...baseBody,
        process_name: task.subProcess,
        target_count: task.count,
        batch_index: 0,
        batch_size: task.count,
      }),
    });

    const latency = Date.now() - startTime;
    const result = await resp.json();
    const items = Array.isArray(result?.items) ? result.items : [];

    await admin.from("ai_generation_logs").insert({
      job_id: jobId,
      batch_index: task.index,
      prompt: `subProcess=${task.subProcess}, count=${task.count}`,
      raw_response: { itemCount: items.length, source: result?.source } as any,
      model: result?.source || "ai",
      latency_ms: latency,
      error: result?.error || null,
    });

    return items;
  } catch (err: any) {
    await admin.from("ai_generation_logs").insert({
      job_id: jobId,
      batch_index: task.index,
      error: String(err?.message || err),
      latency_ms: Date.now() - startTime,
    });
    return [];
  }
}

function computeQuality(items: any[]) {
  const total = items.length;
  if (total === 0) return { quality_score: 0, diversity_score: 0, duplicate_rate: 0 };
  const hazardSet = new Set<string>();
  const subSet = new Set<string>();
  const grades: Record<string, number> = { 상: 0, 중: 0, 하: 0 };
  for (const it of items) {
    if (it.hazard) hazardSet.add(String(it.hazard).trim());
    if (it.sub_task) subSet.add(String(it.sub_task).trim());
    const g = it.likelihood_grade || "중";
    grades[g] = (grades[g] || 0) + 1;
  }
  const dup = 1 - hazardSet.size / total;
  const div = subSet.size / total;
  let entropy = 0;
  for (const k of Object.keys(grades)) {
    const p = grades[k] / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const ne = entropy / Math.log2(3);
  const score = Math.round(div * 50 + (1 - dup) * 30 + ne * 20);
  return {
    quality_score: score,
    diversity_score: Math.round(div * 1000) / 1000,
    duplicate_rate: Math.round(dup * 1000) / 1000,
  };
}

async function processJob(jobId: string, admin: any, supabaseUrl: string, serviceKey: string) {
  const { data: job } = await admin.from("ai_generation_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job) return;

  const subs = decompose(job.process_name, job.target_count);
  const tasks: BatchTask[] = [];
  let idx = 0;
  for (const sub of subs) {
    let remaining = sub.count;
    while (remaining > 0) {
      const c = Math.min(BATCH_SIZE, remaining);
      tasks.push({ index: idx++, subProcess: sub.name, count: c });
      remaining -= c;
    }
  }

  await admin.from("ai_generation_jobs").update({
    status: "running",
    started_at: new Date().toISOString(),
    total_batches: tasks.length,
  }).eq("id", jobId);

  const baseBody = {
    equipment: job.equipment || "",
    work_description: job.work_description || "",
    work_location: job.work_location || "일반",
    work_environment: job.work_environment || [],
    project_id: job.project_id,
  };

  const allItems: any[] = [];
  const seen = new Set<string>();
  let completedBatches = 0;
  let failedBatches = 0;

  // Run with concurrency limit
  for (let i = 0; i < tasks.length; i += MAX_CONCURRENT) {
    const slice = tasks.slice(i, i + MAX_CONCURRENT);
    const results = await Promise.all(slice.map(t => runBatch(admin, jobId, t, baseBody, supabaseUrl, serviceKey)));

    for (let j = 0; j < results.length; j++) {
      const items = results[j];
      const task = slice[j];
      if (items.length === 0) failedBatches++;

      // dedupe
      const newItems = items.filter((it: any) => {
        const key = `${(it.sub_task || "").trim()}|${(it.hazard || "").trim()}`;
        if (!key.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      allItems.push(...newItems);
      completedBatches++;

      await admin.from("ai_generated_items_buffer").insert({
        job_id: jobId,
        batch_index: task.index,
        items: newItems as any,
      });
    }

    await admin.from("ai_generation_jobs").update({
      completed_batches: completedBatches,
      items_generated: allItems.length,
    }).eq("id", jobId);
  }

  const metrics = computeQuality(allItems);
  const finalStatus = failedBatches === tasks.length ? "failed" : (failedBatches > 0 ? "partial" : "completed");

  await admin.from("ai_generation_jobs").update({
    status: finalStatus,
    completed_at: new Date().toISOString(),
    items_generated: allItems.length,
    completed_batches: completedBatches,
    ...metrics,
    error_message: finalStatus === "failed" ? "모든 배치 생성 실패" : null,
  }).eq("id", jobId);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const action = body.action || "start";

    if (action === "start") {
      const {
        project_id,
        run_id,
        created_by,
        process_name,
        equipment,
        work_description,
        work_location,
        work_environment,
        target_count,
      } = body;

      if (!project_id || !created_by || !process_name) {
        return new Response(JSON.stringify({ error: "필수 파라미터 누락" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const tc = [50, 100, 150, 300].includes(Number(target_count)) ? Number(target_count) : 50;

      const { data: job, error } = await admin
        .from("ai_generation_jobs")
        .insert({
          project_id,
          run_id: run_id || null,
          created_by,
          process_name,
          equipment: equipment || null,
          work_description: work_description || null,
          work_location: work_location || null,
          work_environment: work_environment || [],
          target_count: tc,
          status: "queued",
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // background processing
      // @ts-ignore EdgeRuntime is provided in Supabase Edge Functions
      EdgeRuntime.waitUntil(processJob(job.id, admin, supabaseUrl, serviceKey));

      return new Response(JSON.stringify({ job_id: job.id, status: "queued", target_count: tc }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("orchestrator error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
