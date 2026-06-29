// Health check for GEMINI_API_KEY (replaces former Lovable AI Gateway check).
import { callGeminiChat, GeminiError } from '../_shared/gemini.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) {
    return new Response(
      JSON.stringify({
        status: 'error',
        provider: 'gemini',
        message: 'GEMINI_API_KEY가 설정되지 않았습니다. 마스터가 Lovable 시크릿에 키를 등록해야 합니다.',
        signup_url: 'https://aistudio.google.com/apikey',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    await callGeminiChat({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      temperature: 0,
    });
    return new Response(
      JSON.stringify({
        status: 'ok',
        provider: 'gemini',
        message: 'Gemini API 키가 정상 동작합니다.',
        checked_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    if (e instanceof GeminiError) {
      const status: 'rate_limited' | 'exhausted' | 'error' =
        e.code === 'RATE_LIMIT' ? 'rate_limited' :
        e.code === 'QUOTA_EXHAUSTED' ? 'exhausted' : 'error';
      return new Response(
        JSON.stringify({
          status,
          provider: 'gemini',
          message: e.message,
          http_status: e.status,
          checked_at: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ status: 'error', provider: 'gemini', message: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
