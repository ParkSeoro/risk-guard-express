// Edge function: 작업허가서 상신 시 AI 결재 브리핑 생성 (모바일 UX)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { callGeminiChat, parseJsonLoose, GeminiError } from '../_shared/gemini.ts';
import {
  PERMIT_BRIEFING_SYSTEM_PROMPT,
  extractPermitBriefingFacts,
  buildPermitBriefingLlmPayload,
  normalizePermitBriefing,
} from '../_shared/permitBriefing.ts';

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
  contractor_company?: string;
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
      .select('id, project_id, company_id, permit_type, permit_kinds, form_data, work_name, work_description, location, permit_date, contractor_company, work_start_at, work_end_at, status')
      .eq('id', body.permit_id)
      .maybeSingle();

    const permitStatus = String((permit as any)?.status || '');
    if (permitStatus && !['작성중', '반려', '임시저장'].includes(permitStatus)) {
      return new Response(JSON.stringify({ error: 'PERMIT_LOCKED', message: '결재 진행중/완료 허가서는 브리핑을 다시 만들 수 없습니다.' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const formData = { ...((permit as any)?.form_data || {}), ...(body.form_data || {}) };
    const kinds = (body.permit_kinds?.length
      ? body.permit_kinds
      : ((permit as any)?.permit_kinds || [(permit as any)?.permit_type || 'general'])) as string[];

    let companyFromDb = '';
    const companyId = (permit as any)?.company_id;
    if (companyId && !body.contractor_company && !formData.contractor_company && !formData.applicant_company && !(permit as any)?.contractor_company) {
      const { data: co } = await admin.from('companies').select('name').eq('id', companyId).maybeSingle();
      companyFromDb = (co as any)?.name || '';
    }

    const facts = extractPermitBriefingFacts({
      formData,
      permitKinds: kinds,
      kindLabels: body.kind_labels,
      workName: body.work_name || (permit as any)?.work_name,
      workDescription: body.work_description || (permit as any)?.work_description,
      workLocation: body.work_location || (permit as any)?.location,
      permitDate: body.permit_date || (permit as any)?.permit_date,
      contractorCompany: body.contractor_company || (permit as any)?.contractor_company || companyFromDb,
      workStartAt: (permit as any)?.work_start_at,
      workEndAt: (permit as any)?.work_end_at,
    });

    const payload = buildPermitBriefingLlmPayload(facts);
    const schemaHint = `{
  "work_overview": "작업 내용 1~2문장(업체명·날짜 제외). 투입장비가 있으면 장비명만 언급",
  "included_kinds": ["일반","중장비"],
  "top_risks": ["입력 hazards에 있는 위험만. 굴착은 has_excavation_work가 true일 때만"],
  "required_controls": ["입력 checklist·조치만"]
}`;

    const userText = `다음 작업허가서 사실만 결재 브리핑용으로 요약하라. 없는 내용은 비워 둔다.\n${JSON.stringify(payload)}\n스키마:\n${schemaHint}`;

    let briefing: any;
    try {
      const ai = await callGeminiChat({
        messages: [
          { role: 'system', content: PERMIT_BRIEFING_SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
        max_tokens: 900,
        compact: true,
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

    const normalized = normalizePermitBriefing(briefing, facts);

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
