import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) {
    return new Response(
      JSON.stringify({ status: 'error', message: 'LOVABLE_API_KEY 미설정' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Lovable-API-Key': key,
        'Content-Type': 'application/json',
        'X-Lovable-AIG-SDK': 'vercel-ai-sdk',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [{ role: 'user', content: 'ok' }],
        max_tokens: 1,
      }),
    });

    // Pull any X-Lovable-AIG-* metadata for diagnostics
    const meta: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      if (k.toLowerCase().startsWith('x-lovable-aig-')) meta[k] = v;
    });

    let status: 'ok' | 'rate_limited' | 'exhausted' | 'error' = 'ok';
    let message = '정상';

    if (r.status === 402) {
      status = 'exhausted';
      message = 'AI 크레딧이 모두 소진되었습니다. 워크스페이스 설정에서 충전하세요.';
    } else if (r.status === 429) {
      status = 'rate_limited';
      message = '일시적 요청 한도 초과(rate limit). 잠시 후 다시 시도하세요.';
    } else if (!r.ok) {
      status = 'error';
      const body = await r.text().catch(() => '');
      message = `게이트웨이 오류 (${r.status}) ${body.slice(0, 200)}`;
    }

    return new Response(
      JSON.stringify({ status, message, http_status: r.status, meta, checked_at: new Date().toISOString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ status: 'error', message: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
