// Health check for NVIDIA_API_KEY (primary AI provider).
import { callGeminiChat, GeminiError } from '../_shared/gemini.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const key = Deno.env.get('NVIDIA_API_KEY');
  if (!key) {
    return new Response(
      JSON.stringify({
        status: 'error',
        provider: 'nvidia',
        model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
        message: 'NVIDIA_API_KEY가 설정되지 않았습니다. Supabase Edge Secrets에 등록해야 합니다.',
        signup_url: 'https://build.nvidia.com/settings/api-keys',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    await callGeminiChat({
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
      temperature: 0,
    });
    return new Response(
      JSON.stringify({
        status: 'ok',
        provider: 'nvidia',
        model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
        message: 'NVIDIA API 키가 정상 동작합니다.',
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
          provider: 'nvidia',
          model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
          message: e.message,
          http_status: e.status,
          checked_at: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ status: 'error', provider: 'nvidia', message: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
