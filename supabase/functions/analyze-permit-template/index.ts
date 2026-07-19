// 허가서 양식 PDF를 Gemini(멀티모달)로 분석하여
// 입력란/체크박스/서명란의 라벨·위치를 자동 인식한다.
// 요청: { templateId, pageImages: string[] (base64 data URL, 페이지 순) }
// 응답: { result: AIAnalysisResult, layoutPatch: FormLayout, overlayPatch: PrintOverlay, signatureSlots: SignatureSlot[] }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGeminiChat, GeminiError } from '../_shared/gemini.ts';

// Lovable AI Gateway 우선 사용 (사용자 GEMINI_API_KEY 무료 할당량 소진 대비)
async function callLovableAIGateway(messages: any[], temperature = 0.1): Promise<string> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) throw new Error('LOVABLE_API_KEY 미설정');
  const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) throw new GeminiError('AI 요청이 몰려 잠시 후 다시 시도해주세요.', 429, 'RATE_LIMIT');
    if (resp.status === 402) throw new GeminiError('AI 크레딧이 부족합니다. 워크스페이스에서 충전이 필요합니다.', 402, 'QUOTA_EXHAUSTED');
    throw new GeminiError(`AI 게이트웨이 오류 (${resp.status}): ${text.slice(0, 200)}`, resp.status, 'SERVER_ERROR');
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '{}';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `당신은 한국의 산업안전 관련 문서(작업허가서, 점검표, 확인서 등) 양식 분석 전문가입니다.
사용자가 제공한 각 페이지 이미지를 분석하여 다음 JSON 스키마로만 응답하세요.

{
  "detected_title": "문서 최상단의 제목 (예: '화기작업허가서')",
  "page_count": <총 페이지 수>,
  "fields": [
    { "label": "필드명(라벨)", "type": "text|textarea|number|date|time|select", "page": 1, "bbox": [x, y, w, h] }
  ],
  "checkboxes": [
    { "label": "체크박스 옆 문구", "page": 1, "bbox": [x, y, w, h] }
  ],
  "signatures": [
    { "label": "서명란 라벨 (예: 안전관리자, 현장대리인, 승인, 확인)",
      "role_hint": "creator|contractor_pic|sm|site_director|pm|client|master|custom",
      "page": 1, "bbox": [x, y, w, h] }
  ]
}

규칙:
- bbox 좌표는 0~1 범위의 페이지 상대 좌표. [x=좌상단X, y=좌상단Y, w=너비, h=높이].
- 필드 라벨 옆의 "빈 입력칸"만 bbox로 지정. 라벨 자체는 포함하지 말 것.
- "작업명/공사명/장소/일자/시간" 등 짧은 값 → text 또는 date/time.
- "작업내용/특이사항/조치사항" 등 여러 줄 → textarea.
- "□ ☐ ☑ ( )" 근처의 항목 → checkboxes.
- "서명/확인/승인/결재/검토" 셀 → signatures. 라벨 문구로 role_hint 추정.
  · "작성/기안" → creator, "협력사/시공사" → contractor_pic
  · "안전관리자/안전담당" → sm, "현장대리인/현장소장" → site_director
  · "관리감독자/PM/공사팀장" → pm, "발주처/감리" → client
  · "최종/승인/사장" → master, 그 외 → custom
- 반드시 순수 JSON만 출력. 마크다운 코드블록·설명 금지.
- 확실하지 않은 요소는 포함하지 말 것 (정밀도 > 재현율).`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supaUrl, supaAnon, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const templateId = String(body?.templateId || '');
    const pageImages: string[] = Array.isArray(body?.pageImages) ? body.pageImages : [];
    if (!templateId || pageImages.length === 0) {
      return new Response(JSON.stringify({ error: 'templateId와 pageImages가 필요합니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (pageImages.length > 6) {
      return new Response(JSON.stringify({ error: '한 번에 6페이지까지만 분석할 수 있습니다.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // master 여부 검증
    const { data: isMaster } = await supabase.rpc('is_master', { _user_id: userRes.user.id });
    if (!isMaster) {
      return new Response(JSON.stringify({ error: '마스터 권한이 필요합니다.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Gemini 멀티모달 호출
    const content: any[] = [
      { type: 'text', text: `총 ${pageImages.length} 페이지입니다. 각 페이지를 순서대로 분석해 주세요.` },
    ];
    pageImages.forEach((url, i) => {
      content.push({ type: 'text', text: `--- Page ${i + 1} ---` });
      content.push({ type: 'image_url', image_url: { url } });
    });

    // Lovable AI Gateway 우선, 실패 시 사용자 GEMINI_API_KEY로 폴백
    let raw = '{}';
    try {
      raw = await callLovableAIGateway(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        0.1,
      );
    } catch (gwErr) {
      console.warn('[analyze-permit-template] Lovable Gateway 실패, GEMINI_API_KEY 폴백:', gwErr instanceof Error ? gwErr.message : gwErr);
      const geminiRes = await callGeminiChat({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });
      raw = geminiRes.choices[0]?.message?.content || '{}';
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 마크다운 fence 제거 재시도
      const stripped = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
      parsed = JSON.parse(stripped);
    }

    const result = {
      detected_title: String(parsed.detected_title || ''),
      page_count: Number(parsed.page_count || pageImages.length),
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
      checkboxes: Array.isArray(parsed.checkboxes) ? parsed.checkboxes : [],
      signatures: Array.isArray(parsed.signatures) ? parsed.signatures : [],
    };

    // 결과 → layout / overlay / signature_slots 로 변환
    const now = Date.now();
    const rand = () => Math.random().toString(36).slice(2, 6);

    const layoutFields: any[] = [];
    const overlayBoxes: any[] = [];

    // 일반 필드
    result.fields.forEach((f: any, i: number) => {
      const key = `ai_f_${now}_${i}_${rand()}`;
      const bbox = normalizeBbox(f.bbox);
      layoutFields.push({
        key,
        label: String(f.label || `필드 ${i + 1}`),
        type: allowedFieldType(f.type),
        width: f.type === 'textarea' ? 4 : 2,
      });
      overlayBoxes.push({
        id: `box_${now}_${i}_${rand()}`,
        field_key: key,
        page: Number(f.page) || 1,
        x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3],
        render: 'text',
        font_size: 10,
        align: 'left',
        ai_generated: true,
        label_hint: String(f.label || ''),
      });
    });

    // 체크박스
    result.checkboxes.forEach((c: any, i: number) => {
      const key = `ai_c_${now}_${i}_${rand()}`;
      const bbox = normalizeBbox(c.bbox);
      layoutFields.push({
        key,
        label: String(c.label || `체크 ${i + 1}`),
        type: 'checkbox',
        width: 2,
      });
      overlayBoxes.push({
        id: `chk_${now}_${i}_${rand()}`,
        field_key: key,
        page: Number(c.page) || 1,
        x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3],
        render: 'check',
        check_when: 'true',
        ai_generated: true,
        label_hint: String(c.label || ''),
      });
    });

    // 서명 슬롯
    const signatureSlots: any[] = [];
    result.signatures.forEach((s: any, i: number) => {
      const bbox = normalizeBbox(s.bbox);
      signatureSlots.push({
        id: `sig_${now}_${i}_${rand()}`,
        role: allowedRole(s.role_hint),
        label: String(s.label || `서명 ${i + 1}`),
        page: Number(s.page) || 1,
        x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3],
        order: i + 1,
        render_name: true,
        render_date: true,
      });
    });

    const layoutPatch = {
      header: { title: result.detected_title || '허가서', rev: 'AI-1' },
      sections: layoutFields.length
        ? [{ id: `sec_ai_${now}`, title: 'AI 자동 인식 필드', fields: layoutFields }]
        : [],
    };

    // overlay: 페이지별로 묶기
    const overlayPages: Record<number, any[]> = {};
    overlayBoxes.forEach((b) => {
      if (!overlayPages[b.page]) overlayPages[b.page] = [];
      overlayPages[b.page].push(b);
    });
    const overlayPatch = {
      pages: Object.entries(overlayPages).map(([p, boxes]) => ({ page: Number(p), boxes })),
    };

    // DB 저장
    await supabase
      .from('permit_form_templates')
      .update({
        ai_analysis_json: result,
        ai_analyzed_at: new Date().toISOString(),
        signature_slots: signatureSlots,
        suggested_approval_steps: signatureSlots.length,
      } as any)
      .eq('id', templateId);

    return new Response(
      JSON.stringify({ result, layoutPatch, overlayPatch, signatureSlots }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('[analyze-permit-template]', e);
    const msg = e instanceof GeminiError ? e.message : (e instanceof Error ? e.message : String(e));
    const status = e instanceof GeminiError ? e.status : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function normalizeBbox(b: any): [number, number, number, number] {
  if (!Array.isArray(b) || b.length < 4) return [0.1, 0.1, 0.2, 0.03];
  const [x, y, w, h] = b.map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
  return [x, y, Math.max(0.01, w), Math.max(0.01, h)];
}

function allowedFieldType(t: any): string {
  const allowed = ['text', 'textarea', 'number', 'date', 'time', 'select'];
  return allowed.includes(String(t)) ? String(t) : 'text';
}

function allowedRole(r: any): string {
  const allowed = ['creator', 'contractor_pic', 'sm', 'site_director', 'pm', 'client', 'master', 'custom'];
  return allowed.includes(String(r)) ? String(r) : 'custom';
}
