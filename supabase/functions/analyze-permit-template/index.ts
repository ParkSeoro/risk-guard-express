// 허가서 양식 PDF를 Gemini vision(비용 레인)으로 분석하여
// 입력란/체크박스/서명란의 라벨·위치를 자동 인식한다.
// 요청: { templateId, pageImages: string[] (base64 data URL, 페이지 순) }
// 응답: { result, layoutPatch, overlayPatch, signatureSlots, diagnostics }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { callGeminiChat, GeminiError } from '../_shared/gemini.ts';

// 통합 AI 호출 — OpenAI gpt-4o-mini vision (gemini.ts가 이미지 블록을 전달)
async function callAI(
  messages: any[],
  opts: { temperature?: number } = {},
): Promise<string> {
  const r = await callGeminiChat({
    purpose: 'permit_template',
    messages,
    temperature: opts.temperature ?? 0.1,
    response_format: { type: 'json_object' },
  });
  return r.choices?.[0]?.message?.content || '{}';
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM_PROMPT = `당신은 한국의 산업안전 관련 문서(작업허가서, 점검표, 확인서 등) 양식 분석 전문가입니다.
사용자가 제공한 각 페이지 이미지를 정밀히 분석하여 아래 JSON 스키마로만 응답하세요.

{
  "detected_title": "문서 최상단의 제목 (예: '화기작업허가서')",
  "page_count": <총 페이지 수>,
  "notes": ["페이지별 관찰(예: 'p1 표 형식 양식', 'p2 백지')"],
  "fields": [
    { "label": "필드명(라벨)", "type": "text|textarea|number|date|time|select", "page": 1, "bbox": [x, y, w, h] }
  ],
  "checkboxes": [
    { "label": "체크박스 옆 문구", "page": 1, "bbox": [x, y, w, h] }
  ],
  "signatures": [
    { "label": "서명란 라벨", "role_hint": "creator|contractor_pic|sm|site_director|pm|client|master|custom",
      "page": 1, "bbox": [x, y, w, h] }
  ]
}

**bbox 좌표계 (매우 중요)**:
- 0~1 정규화. x=좌상단X, y=좌상단Y, w=너비, h=높이.
- **좌표 참조점**: 이미지의 좌상단이 (0,0), 우하단이 (1,1). x=0.9 는 페이지의 오른쪽 끝(90%) 위치.
- **체크박스 좌표는 □ 기호가 위치한 네모 자체의 좌표**여야 함. 옆의 라벨 텍스트 영역이 아님.
  · 예: "□ 화기작업" → bbox 는 □ 만 (보통 w≈0.015, h≈0.015 정도의 작은 정사각형).
- **입력란 좌표는 값이 들어갈 빈 셀 자체의 사각형** (라벨이 아니라 그 옆의 입력 공간).
- 좌표를 대충 추정하지 말고, 실제 이미지에서 해당 요소가 시작하는 픽셀을 정확히 관찰해 상대좌표로 환산할 것.

**커버리지 필수 규칙 (누락 방지)**:
- 페이지를 **좌상/우상/좌하/우하 4분면**으로 나눠 각 분면을 반드시 순차 스캔하고, 어느 분면도 건너뛰지 말 것.
- **우측(x>0.5) 영역**에 체크박스·서명란이 많은 경우가 흔함. 좌측만 보고 끝내지 말 것.
- **하단(y>0.7) 영역**의 서명란/체크박스/합의사항도 빠뜨리지 말 것.

**표(테이블) 스캔 규칙 (매우 중요 — 우측 체크박스 누락 원인 1위)**:
- 표 형식이면 **모든 행을 위→아래로 순회**하고, 각 행 안에서 **좌→우로 모든 셀을 스캔**할 것.
- 각 행에 □ ☐ ▢ ○ 등 체크 마커가 **여러 개** 나열되어 있으면 **각 마커마다 개별 checkboxes 항목**으로 등록 (라벨 텍스트가 없어도 됨).
  · 라벨이 없으면 좌측 행 라벨을 상속하여 "행라벨 - N번째" 로 지정.
- 우측 컬럼(x > 0.55)에 □가 반복되어 나오는 "요구사항/확인/조치" 형태의 표는 특히 놓치기 쉬우니, **행 개수와 우측 □ 개수를 두 번 확인**한 뒤 응답할 것.
- 같은 라벨이 여러 곳에 반복되면 각각 별도 항목으로 등록.

**타입 판정**:
- "작업명/공사명/장소/일자/시간" 등 짧은 값 → text 또는 date/time.
- "작업내용/특이사항/조치사항" 등 여러 줄 → textarea.
- "□ ☐ ☑ ( ) [ ]" 근처 항목 → checkboxes.
- "서명/확인/승인/결재/검토/날인" 셀 → signatures. 라벨 문구로 role_hint 추정.
  · "작성/기안" → creator, "협력사/시공사" → contractor_pic
  · "안전관리자/안전담당" → sm, "현장대리인/현장소장" → site_director
  · "관리감독자/PM/공사팀장" → pm, "발주처/감리" → client
  · "최종/승인/사장/대표" → master, 그 외 → custom

- 각 페이지 최소 1개 이상 요소를 찾을 것. 백지면 notes 에 사유 기재.
- 반드시 순수 JSON만. 마크다운·설명 금지.`;

const REFINE_PROMPT = `당신은 방금 위 이미지에 대해 아래 JSON 결과를 냈습니다.
이제 **누락 탐지 + 좌표 보정** 을 수행하세요.

<previous_result>
{{PREV}}
</previous_result>

수행 지침:
1) 이미지의 **우측(x>0.5) 영역**과 **하단(y>0.65) 영역**을 다시 정밀 스캔해, previous_result 에 **누락된 체크박스/입력란/서명란**을 모두 찾아 추가.
2) **표 각 행을 다시 확인**: 행별로 좌→우 셀을 훑으며 □ 개수를 세고, previous_result 의 해당 행 체크박스 수보다 실제가 많으면 부족분을 모두 추가.
3) previous_result 의 각 항목 bbox 가 실제 요소 위치와 어긋나면 **더 정확한 bbox 로 교체**.
4) 중복(동일 라벨 + 거의 같은 위치, IoU>0.5)은 제거.
5) 응답은 **최종 완성본 전체**를 원 스키마 그대로 반환 (fields/checkboxes/signatures 전체 배열).
6) 순수 JSON만.`;

const SWEEP_PROMPT = `당신은 표 형식 문서의 **체크박스(□ ☐ ▢) 전용 스캐너**입니다.
아래 이미지들에서 **□ 심볼 하나하나의 위치만** JSON 으로 반환하세요. 다른 요소는 무시합니다.

이미 감지된 체크박스 중심점(중복 방지용):
<already_detected>
{{PREV_CHECKS}}
</already_detected>

지시:
1) 페이지를 **표 행 단위로 위→아래**, 각 행 내에서 **좌→우** 로 모든 □ 를 찾을 것.
2) 특히 표의 **우측(x > 0.55) 컬럼**에 반복되는 □ 를 빠짐없이 등록.
3) already_detected 좌표와 중심점 거리가 0.02 이내면 응답에서 제외.
4) 라벨을 모르면 좌측 행 라벨을 상속하거나 빈 문자열.
5) 응답 스키마: { "checkboxes": [ { "label": "...", "page": 1, "bbox": [x,y,w,h] } ] }
6) 순수 JSON만.`;

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
    // 성능/타임아웃 대응: 기본은 1차만. 클라이언트가 명시적으로 켤 때만 refine/sweep 실행
    const enableRefine = body?.enableRefine === true;
    const enableSweep = body?.enableSweep === true;
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
    const totalBytes = pageImages.reduce((s, u) => s + u.length, 0);
    if (totalBytes > 26_000_000) {
      return new Response(JSON.stringify({ error: '이미지 총 용량이 너무 큽니다(약 25MB 초과). 페이지 수를 줄이거나 해상도를 낮춰 다시 시도하세요.' }), {
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

    // 멀티모달 메시지
    const content: any[] = [
      { type: 'text', text: `총 ${pageImages.length} 페이지입니다. 각 페이지를 순서대로 분석해 주세요.` },
    ];
    pageImages.forEach((url, i) => {
      content.push({ type: 'text', text: `--- Page ${i + 1} ---` });
      content.push({ type: 'image_url', image_url: { url } });
    });
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ];

    let raw = '{}';
    let modelUsed = 'gpt-4o-mini';
    try {
      raw = await callAI(messages, { temperature: 0.1 });
      console.log(`[analyze-permit-template] model=${modelUsed} raw_len=${raw.length} preview=${raw.slice(0, 400)}`);
    } catch (e) {
      console.error('[analyze-permit-template] OpenAI 호출 실패:', e instanceof Error ? e.message : e);
      throw e;
    }


    let parsed: any = {};
    let parseError: string | undefined;
    const tryParse = (s: string) => {
      try { return JSON.parse(s); } catch {
        try { return JSON.parse(s.replace(/^```json\s*/i, '').replace(/```$/, '').trim()); }
        catch (e) { parseError = String(e); return null; }
      }
    };
    parsed = tryParse(raw) || {};

    // ==== 2차 검증 패스 (누락/좌표 보정) — 옵션 ====
    let refined: any = null;
    if (enableRefine && (parsed?.fields || parsed?.checkboxes || parsed?.signatures)) {
      try {
        const refineMessages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
          { role: 'assistant', content: JSON.stringify(parsed) },
          {
            role: 'user',
            content: [
              { type: 'text', text: REFINE_PROMPT.replace('{{PREV}}', JSON.stringify(parsed).slice(0, 6000)) },
              ...pageImages.flatMap((url, i) => [
                { type: 'text', text: `--- Page ${i + 1} 재검토 ---` },
                { type: 'image_url', image_url: { url } },
              ]),
            ],
          },
        ];
        const rawRefined = await callAI(refineMessages, { temperature: 0.1 });

        const rp = tryParse(rawRefined);
        if (rp && (Array.isArray(rp.fields) || Array.isArray(rp.checkboxes) || Array.isArray(rp.signatures))) {
          refined = rp;
          parsed = rp;
          console.log(`[analyze-permit-template] refine pass ok: f=${rp.fields?.length||0} c=${rp.checkboxes?.length||0} s=${rp.signatures?.length||0}`);
        }
      } catch (e) {
        console.warn('[analyze-permit-template] refine pass skipped:', e instanceof Error ? e.message : e);
      }
    }

    // ==== 3차 체크박스 스윕 패스 (표 우측 컬럼 누락 보정) ====
    // 조건: 체크박스 총 개수 < 15 OR 우측(x>0.5) 체크박스 < 5
    let sweep_added = 0;
    const existingChecks: any[] = Array.isArray(parsed.checkboxes) ? parsed.checkboxes : [];
    const rightChecks = existingChecks.filter((c: any) => Array.isArray(c.bbox) && c.bbox[0] > 0.5).length;
    if (enableSweep && (existingChecks.length < 15 || rightChecks < 5)) {
      try {
        const prevCenters = existingChecks
          .filter((c: any) => Array.isArray(c.bbox))
          .map((c: any) => ({ page: Number(c.page) || 1, cx: c.bbox[0] + c.bbox[2] / 2, cy: c.bbox[1] + c.bbox[3] / 2 }));
        const sweepMessages = [
          { role: 'system', content: SWEEP_PROMPT.replace('{{PREV_CHECKS}}', JSON.stringify(prevCenters).slice(0, 4000)) },
          {
            role: 'user',
            content: pageImages.flatMap((url, i) => [
              { type: 'text', text: `--- Page ${i + 1} 체크박스 스윕 ---` },
              { type: 'image_url', image_url: { url } },
            ]),
          },
        ];
        const rawSweep = await callAI(sweepMessages, { temperature: 0.1 });
        const sp = tryParse(rawSweep);
        const newChecks: any[] = Array.isArray(sp?.checkboxes) ? sp.checkboxes : [];
        // dedupe: 중심점 거리 < 0.02
        const toAdd = newChecks.filter((n: any) => {
          if (!Array.isArray(n.bbox)) return false;
          const ncx = n.bbox[0] + n.bbox[2] / 2;
          const ncy = n.bbox[1] + n.bbox[3] / 2;
          const np = Number(n.page) || 1;
          return !prevCenters.some((p) => p.page === np && Math.abs(p.cx - ncx) < 0.02 && Math.abs(p.cy - ncy) < 0.02);
        });
        if (toAdd.length > 0) {
          parsed.checkboxes = [...existingChecks, ...toAdd];
          sweep_added = toAdd.length;
          console.log(`[analyze-permit-template] sweep pass added ${sweep_added} checkboxes`);
        }
      } catch (e) {
        console.warn('[analyze-permit-template] sweep pass skipped:', e instanceof Error ? e.message : e);
      }
    }


    const result = {
      detected_title: String(parsed.detected_title || ''),
      page_count: Number(parsed.page_count || pageImages.length),
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
      fields: Array.isArray(parsed.fields) ? parsed.fields : [],
      checkboxes: Array.isArray(parsed.checkboxes) ? parsed.checkboxes : [],
      signatures: Array.isArray(parsed.signatures) ? parsed.signatures : [],
    };

    const now = Date.now();
    const rand = () => Math.random().toString(36).slice(2, 6);
    const layoutFields: any[] = [];
    const overlayBoxes: any[] = [];

    result.fields.forEach((f: any, i: number) => {
      const key = `ai_f_${now}_${i}_${rand()}`;
      const bbox = normalizeBbox(f.bbox);
      layoutFields.push({
        key, label: String(f.label || `필드 ${i + 1}`),
        type: allowedFieldType(f.type),
        width: f.type === 'textarea' ? 4 : 2,
      });
      overlayBoxes.push({
        id: `box_${now}_${i}_${rand()}`, field_key: key,
        page: Number(f.page) || 1,
        x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3],
        render: 'text', font_size: 10, align: 'left',
        ai_generated: true, label_hint: String(f.label || ''),
      });
    });

    result.checkboxes.forEach((c: any, i: number) => {
      const key = `ai_c_${now}_${i}_${rand()}`;
      const bbox = normalizeBbox(c.bbox);
      layoutFields.push({ key, label: String(c.label || `체크 ${i + 1}`), type: 'checkbox', width: 2 });
      overlayBoxes.push({
        id: `chk_${now}_${i}_${rand()}`, field_key: key,
        page: Number(c.page) || 1,
        x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3],
        render: 'check', check_when: 'true',
        ai_generated: true, label_hint: String(c.label || ''),
      });
    });

    const signatureSlots: any[] = [];
    result.signatures.forEach((s: any, i: number) => {
      const bbox = normalizeBbox(s.bbox);
      signatureSlots.push({
        id: `sig_${now}_${i}_${rand()}`,
        role: allowedRole(s.role_hint),
        label: String(s.label || `서명 ${i + 1}`),
        page: Number(s.page) || 1,
        x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3],
        order: i + 1, render_name: true, render_date: true,
      });
    });

    const layoutPatch = {
      header: { title: result.detected_title || '허가서', rev: 'AI-1' },
      sections: layoutFields.length
        ? [{ id: `sec_ai_${now}`, title: 'AI 자동 인식 필드', fields: layoutFields }]
        : [],
    };

    const overlayPages: Record<number, any[]> = {};
    overlayBoxes.forEach((b) => {
      if (!overlayPages[b.page]) overlayPages[b.page] = [];
      overlayPages[b.page].push(b);
    });
    const overlayPatch = {
      pages: Object.entries(overlayPages).map(([p, boxes]) => ({ page: Number(p), boxes })),
    };

    const totalDetected = result.fields.length + result.checkboxes.length + result.signatures.length;
    // 우측/하단 커버리지 진단 (누락 힌트)
    const allBoxes = [...result.fields, ...result.checkboxes, ...result.signatures];
    const rightSide = allBoxes.filter((b: any) => Array.isArray(b.bbox) && b.bbox[0] > 0.5).length;
    const bottom = allBoxes.filter((b: any) => Array.isArray(b.bbox) && b.bbox[1] > 0.65).length;
    const diagnostics = {
      model_used: modelUsed,
      refine_applied: !!refined,
      sweep_added,
      raw_preview: raw.slice(0, 600),
      page_count: pageImages.length,
      image_bytes_total: totalBytes,
      total_detected: totalDetected,
      right_side_count: rightSide,
      bottom_count: bottom,
      reason: totalDetected === 0 ? 'no_elements_detected' : 'ok',
      notes: result.notes,
      parse_error: parseError,
    };

    await supabase
      .from('permit_form_templates')
      .update({
        ai_analysis_json: { ...result, diagnostics },
        ai_analyzed_at: new Date().toISOString(),
        signature_slots: signatureSlots,
        suggested_approval_steps: signatureSlots.length,
      } as any)
      .eq('id', templateId);

    return new Response(
      JSON.stringify({ result, layoutPatch, overlayPatch, signatureSlots, diagnostics }),
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
