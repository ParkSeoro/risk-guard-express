// Health check: OpenAI first, NVIDIA only as leftover.
import { callGeminiChat, GeminiError } from '../_shared/gemini.ts';
import { isOpenAiFallbackEnabled, resolveOpenAiModel } from '../_shared/openaiChat.ts';
import { peekPrimaryModelSync, resolveApiKey } from '../_shared/nvidiaChat.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const openaiOn = isOpenAiFallbackEnabled();
  const model = openaiOn ? resolveOpenAiModel() : (peekPrimaryModelSync() || 'unknown');
  const provider = openaiOn ? 'openai' : 'nvidia';

  if (!openaiOn && !resolveApiKey()) {
    return new Response(
      JSON.stringify({
        status: 'error',
        provider,
        model,
        message: 'OPENAI_API_KEY가 설정되지 않았습니다. Supabase Edge Secrets에 등록해야 합니다.',
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
        provider,
        model,
        message: openaiOn
          ? 'OpenAI API가 정상 동작합니다.'
          : 'NVIDIA API 키가 정상 동작합니다.',
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
          provider,
          model,
          message: e.message,
          http_status: e.status,
          checked_at: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ status: 'error', provider, model, message: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
