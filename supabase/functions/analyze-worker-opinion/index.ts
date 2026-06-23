// Edge function: 근로자 의견 텍스트를 분석하여 위험요인 / 보건요인 / 사고사례 후보를 생성
// 또한 공종 기반 보건/사고 자동 생성 모드도 지원
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

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

interface RequestBody {
  mode: 'opinion' | 'health' | 'accident';
  opinion?: string;
  process?: string;
  equipment?: string;
  worker_name?: string;
}

const SAFETY_PROMPT = `당신은 대한민국 산업안전보건법 및 KOSHA 가이드에 정통한 20년 경력 안전관리 전문가입니다.
근로자 의견(현장에서 근로자가 직접 제기한 위험 의견)을 분석하여:
1) 안전 위험요인(safety) 및 2) 보건 유해요인(health) 후보를 추출하고,
각각에 대한 개선대책(보호구/작업방법/설비)을 제시합니다.
한국 건설·플랜트 현장 용어를 사용하고, 핵심만 간결하게 작성하세요.`;

const HEALTH_PROMPT = `당신은 산업보건 전문가입니다. 주어진 공종/장비를 기반으로
보건 유해요인(분진, 소음, 화학물질, 고온/저온, 밀폐공간, 진동 등)과 노출 정도, 대응대책,
관련 법조항(산업안전보건기준에 관한 규칙 등)을 추출합니다.`;

const ACCIDENT_PROMPT = `당신은 건설 안전 사고분석 전문가입니다. 주어진 공종/장비에 대해
국내 유사 사고사례 1~3건을 요약하여 사고유형, 원인, 결과, 예방대책을 한국어로 제시합니다.`;

async function callAI(systemPrompt: string, userPrompt: string, schema: any) {
  const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      tools: [{ type: 'function', function: { name: 'submit', description: '결과', parameters: schema } }],
      tool_choice: { type: 'function', function: { name: 'submit' } },
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`AI Gateway error ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  return args ? JSON.parse(args) : {};
}

const opinionSchema = {
  type: 'object',
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, description: '핵심 키워드(예: 미끄러움, 소음, 분진)' },
    safety_risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          process: { type: 'string' },
          sub_task: { type: 'string' },
          hazard: { type: 'string', description: '위험요인' },
          hazard_situation: { type: 'string', description: '위험상황' },
          existing_measure: { type: 'string' },
          improvement_measure: { type: 'string' },
          ppe: { type: 'array', items: { type: 'string' } },
          likelihood_grade: { type: 'string', enum: ['상', '중', '하'] },
          severity_grade: { type: 'string', enum: ['상', '중', '하'] },
        },
        required: ['hazard', 'hazard_situation', 'improvement_measure', 'likelihood_grade', 'severity_grade'],
      },
    },
    health_hazards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['분진', '소음', '화학물질', '고온/저온', '밀폐공간', '진동', '기타'] },
          description: { type: 'string' },
          exposure_level: { type: 'string', enum: ['낮음', '보통', '높음'] },
          countermeasure: { type: 'string' },
          legal_basis: { type: 'string' },
        },
        required: ['category', 'description', 'countermeasure'],
      },
    },
  },
  required: ['keywords', 'safety_risks', 'health_hazards'],
};

const healthSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['분진', '소음', '화학물질', '고온/저온', '밀폐공간', '진동', '기타'] },
          description: { type: 'string' },
          exposure_level: { type: 'string', enum: ['낮음', '보통', '높음'] },
          countermeasure: { type: 'string' },
          legal_basis: { type: 'string' },
        },
        required: ['category', 'description', 'countermeasure'],
      },
    },
  },
  required: ['items'],
};

const accidentSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          accident_type: { type: 'string' },
          cause: { type: 'string' },
          result: { type: 'string' },
          prevention: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['accident_type', 'cause', 'prevention'],
      },
    },
  },
  required: ['items'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;
  try {
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY missing');
    const body = (await req.json()) as RequestBody;

    if (body.mode === 'opinion') {
      const userText = `근로자 의견:\n"${body.opinion || ''}"\n\n공종: ${body.process || '미상'}\n작성자: ${body.worker_name || ''}\n\n위 의견을 분석하여 안전 위험요인과 보건 유해요인을 모두 도출하세요.`;
      const result = await callAI(SAFETY_PROMPT, userText, opinionSchema);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (body.mode === 'health') {
      const userText = `공종: ${body.process || '일반'}\n장비: ${body.equipment || ''}\n해당 공종에서 발생 가능한 보건 유해요인을 4~6개 도출.`;
      const result = await callAI(HEALTH_PROMPT, userText, healthSchema);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (body.mode === 'accident') {
      const userText = `공종: ${body.process || '일반'}\n장비: ${body.equipment || ''}\n유사 사고사례 1~3건 요약.`;
      const result = await callAI(ACCIDENT_PROMPT, userText, accidentSchema);
      return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'invalid mode' }), { status: 400, headers: corsHeaders });
  } catch (e: any) {
    console.error('analyze-worker-opinion error', e);
    return new Response(JSON.stringify({ error: e.message || 'unknown' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
