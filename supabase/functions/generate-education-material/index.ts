// Generate safety education material from a risk assessment run via Google Gemini.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callGeminiChat, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function requireUser(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const token = authHeader.slice(7);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!);
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  return { userId: data.claims.sub as string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { run_id, work_plan_id, project_id } = await req.json();
    if (!project_id) {
      return new Response(JSON.stringify({ error: "project_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify caller is project member before reading project data
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: isMember } = await userClient.rpc('is_project_member', {
      _user_id: auth.userId, _project_id: project_id,
    });
    if (!isMember) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }


    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Gather context
    let contextItems: any[] = [];
    let processes: string[] = [];
    let runTitle = "";

    if (run_id) {
      const { data: run } = await sb.from("assessment_runs")
        .select("period_label, target_processes").eq("id", run_id).maybeSingle();
      runTitle = run?.period_label || "";
      processes = run?.target_processes || [];
      const { data: items } = await sb.from("risk_items")
        .select("process,sub_task,hazard,hazard_situation,improvement_measure,risk_grade,ppe,legal_basis")
        .eq("run_id", run_id).order("risk_grade", { ascending: false }).limit(40);
      contextItems = items || [];
    } else if (work_plan_id) {
      const { data: wp } = await sb.from("work_plans")
        .select("title, work_type, work_description, hazards, safety_measures").eq("id", work_plan_id).maybeSingle();
      runTitle = wp?.title || "";
      contextItems = [{ ...wp }];
      processes = [wp?.work_type || ""];
    }

    // Past accident cases
    const { data: accidents } = await sb.from("accident_cases")
      .select("accident_type,cause,result,description,prevention_measures,fatality")
      .in("process_category", processes.length ? processes : [""])
      .limit(10);

    const ctxText = JSON.stringify({ runTitle, processes, items: contextItems.slice(0, 20), past_accidents: accidents || [] });

    // Tool calling for structured output
    const tools = [{
      type: "function",
      function: {
        name: "build_education_material",
        description: "건설현장 산업안전보건교육 자료 생성",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "교육자료 제목" },
            work_overview: { type: "string", description: "작업 개요 (2~4문장)" },
            key_hazards: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  hazard: { type: "string" },
                  description: { type: "string" },
                  risk_level: { type: "string", enum: ["상", "중", "하"] },
                },
                required: ["hazard", "description", "risk_level"],
              },
            },
            accident_cases: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  summary: { type: "string" },
                  lesson: { type: "string" },
                },
                required: ["title", "summary", "lesson"],
              },
            },
            safety_measures: {
              type: "array",
              items: { type: "string" },
              description: "구체적 안전대책 6~10개",
            },
            prohibited_actions: {
              type: "array",
              items: { type: "string" },
              description: "작업 금지사항 4~8개",
            },
            ppe_requirements: {
              type: "array",
              items: { type: "string" },
              description: "PPE 보호구 목록",
            },
            tbm_summary: { type: "string", description: "TBM 브리핑용 5~8줄 요약" },
          },
          required: ["title", "work_overview", "key_hazards", "accident_cases", "safety_measures", "prohibited_actions", "ppe_requirements", "tbm_summary"],
        },
      },
    }];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "당신은 대한민국 산업안전보건법 기준의 건설현장 안전교육 전문가입니다. 제공된 위험성평가/작업계획서/사고사례를 분석하여 현장 근로자 교육자료를 작성하세요. 모든 답변은 한국어, 실무적이며 구체적이어야 합니다." },
          { role: "user", content: `다음 정보를 기반으로 교육자료를 생성하세요:\n\n${ctxText}` },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "build_education_material" } },
      }),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "요청이 많습니다. 잠시 후 다시 시도해주세요." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI 크레딧이 소진되었습니다." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI 호출 실패");
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("AI 응답 형식 오류");
    const result = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ success: true, material: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
