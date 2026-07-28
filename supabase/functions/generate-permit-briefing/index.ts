// Edge function: 작업허가서 상신 시 AI 결재 브리핑 생성 (모바일 UX)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callGeminiChat, parseJsonLoose, GeminiError } from '../_shared/gemini.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Body {
  permit_id: string;
  project_id?: string | null;
  permit_kinds?: string[];
  kind_labels?: string[];
  work_name?: string;
  work_description?: string;
  work_location?: string;
  permit_date?: string;
  form_data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.slice(7);
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userSb = createClient(supabaseUrl, anonKey);
    const { data: claims, error: claimErr } = await userSb.auth.getClaims(token);
    if (claimErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!Deno.env.get('NVIDIA_API_KEY')) {
      return new Response(JSON.stringify({ error: 'NVIDIA_API_KEY가 설정되지 않았습니다.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as Body;
    if (!body.permit_id) {
      return new Response(JSON.stringify({ error: 'permit_id가 필요합니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: permit } = await admin
      .from('work_permits')
      .select('id, project_id, permit_type, permit_kinds, form_data, work_name, work_description, location, permit_date, contractor_company')
      .eq('id', body.permit_id)
      .maybeSingle();

    const formData = { ...((permit as any)?.form_data || {}), ...(body.form_data || {}) };
    const kinds = (body.permit_kinds?.length
      ? body.permit_kinds
      : ((permit as any)?.permit_kinds || [(permit as any)?.permit_type || 'general'])) as string[];
    const kindLabels = body.kind_labels?.length ? body.kind_labels : kinds;

    const payload = {
      permit_date: body.permit_date || (permit as any)?.permit_date,
      work_name: body.work_name || (permit as any)?.work_name || formData.work_name,
      work_description: body.work_description || (permit as any)?.work_description || formData.work_description,
      work_location: body.work_location || (permit as any)?.location || formData.work_location,
      contractor_company: (permit as any)?.contractor_company || formData.contractor_company,
      permit_kinds: kindLabels,
      hazards: {
        confined: !!(formData.hz_confined || kinds.includes('confined_space')),
        hot_work: !!(formData.hz_hot || kinds.includes('hot_work')),
        excavation: !!(formData.hz_excavation || kinds.includes('excavation')),
        height: !!formData.hz_height,
        heavy: !!formData.hz_heavy,
        loto: !!formData.hz_loto,
      },
      gas: {
        o2: formData.gas_o2, h2s: formData.gas_h2s, co: formData.gas_co, hc: formData.gas_hc,
      },
      checklist_highlights: Object.entries(formData)
        .filter(([k, v]) => (k.startsWith('chk_') || k.startsWith('att_')) && v === true)
        .map(([k]) => k)
        .slice(0, 12),
    };

    const schemaHint = `{
  "work_overview": "모바일에서 한눈에 읽히는 작업 개요 2~3문장",
  "included_kinds": ["일반","화기"],
  "top_risks": ["치명적 위험1","위험2","위험3"],
  "required_controls": ["필수 안전조치1","조치2","조치3"]
}`;

    const system = `당신은 대한민국 건설현장 안전관리 전문가다.
결재자가 모바일에서 빠르게 판단할 수 있도록 작업허가서 묶음을 요약한다.
규칙:
1) 반드시 JSON만 출력
2) top_risks는 정확히 3개, 치명도 높은 순
3) required_controls는 3~5개, 현장 즉시 점검 가능한 조치
4) 한국어, 단정형, 번역투 금지
스키마:
${schemaHint}`;

    const userText = `다음 작업허가서(단일 작업 묶음)를 결재 브리핑용으로 요약하라.\n${JSON.stringify(payload)}`;

    let briefing: any;
    try {
      const ai = await callGeminiChat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
        max_tokens: 1200,
      });
      const content = ai.choices?.[0]?.message?.content || '';
      briefing = parseJsonLoose(content);
    } catch (e) {
      if (e instanceof GeminiError) {
        return new Response(JSON.stringify({ error: e.message, code: e.code }), {
          status: e.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      throw e;
    }

    const normalized = {
      work_overview: String(briefing.work_overview || ''),
      included_kinds: Array.isArray(briefing.included_kinds) ? briefing.included_kinds.map(String) : kindLabels,
      top_risks: (Array.isArray(briefing.top_risks) ? briefing.top_risks : []).map(String).slice(0, 3),
      required_controls: (Array.isArray(briefing.required_controls) ? briefing.required_controls : []).map(String).slice(0, 5),
      generated_at: new Date().toISOString(),
    };

    await admin.from('work_permits').update({ ai_briefing: normalized }).eq('id', body.permit_id);

    return new Response(JSON.stringify({ success: true, briefing: normalized }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('generate-permit-briefing error', e);
    return new Response(JSON.stringify({ error: e.message || 'unknown' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
