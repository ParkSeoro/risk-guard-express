// Health check for NVIDIA_API_KEY + primary model in the failover chain.
import { callGeminiChat, GeminiError, GEMINI_DEFAULT_MODEL } from '../_shared/gemini.ts';
import { peekPrimaryModelSync, resolveApiKey } from '../_shared/nvidiaChat.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const model = peekPrimaryModelSync() || GEMINI_DEFAULT_MODEL;
  const key = resolveApiKey();
  if (!key) {
    return new Response(
      JSON.stringify({
        status: 'error',
        provider: 'nvidia',
        model,
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
      compact: true,
    });
    return new Response(
      JSON.stringify({
        status: 'ok',
        provider: 'nvidia',
        model,
        message: 'NVIDIA API 키가 정상 동작합니다. (모델 체인 폴백 활성 시 한도 초과 시 다음 순위로 전환)',
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
          model,
          message: e.message,
          http_status: e.status,
          checked_at: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ status: 'error', provider: 'nvidia', model, message: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
