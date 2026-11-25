import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function resolveVaultGeminiKey(): Promise<string> {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (url && service) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const resp = await fetch(`${url}/rest/v1/rpc/get_runtime_secret`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: service,
          Authorization: `Bearer ${service}`,
        },
        body: JSON.stringify({ secret_name: "GEMINI_API_KEY" }),
        signal: controller.signal,
      });
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        if (typeof data === "string" && data.trim()) return data.trim();
      }
    } catch {
      /* fall through */
    } finally {
      clearTimeout(timer);
    }
  }
  return (Deno.env.get("GEMINI_API_KEY") || "").trim();
}

async function translateFields(fields: Record<string, string>, locale: string): Promise<Record<string, string>> {
  const langName = locale === "zh" ? "Simplified Chinese" : locale === "ja" ? "Japanese" : "English";
  const sysPrompt = `Translate construction-safety field values from Korean into ${langName}. Return JSON {"fields":{"<key>":"<translated>"}}. Keep numbers, PPE codes, and proper names. Do not add advice.`;
  let content = "";

  // 1) Gemini primary (Vault key + x-goog-api-key header)
  const geminiKey = await resolveVaultGeminiKey();
  if (geminiKey) {
    try {
      const gResp = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [{ role: "user", parts: [{ text: JSON.stringify({ fields }) }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 2500,
              responseMimeType: "application/json",
            },
          }),
        },
      );
      if (gResp.ok) {
        const gData = await gResp.json();
        content = String(gData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
      }
    } catch {
      /* fall through to OpenAI */
    }
  }

  // 2) OpenAI emergency fallback
  if (!content) {
    const apiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
    if (!apiKey) throw new Error("GEMINI_API_KEY / OPENAI_API_KEY missing");
    const model = (Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini").trim();
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 2500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: JSON.stringify({ fields }) },
        ],
      }),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(text.slice(0, 200));
    const data = JSON.parse(text);
    content = String(data?.choices?.[0]?.message?.content ?? "").trim();
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim() || "{}");
  } catch {
    parsed = {};
  }
  const translated = (parsed.fields && typeof parsed.fields === "object" ? parsed.fields : parsed) as Record<string, string>;
  const payload: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const next = translated[k];
    payload[k] = typeof next === "string" && next.trim() ? next.trim() : v;
  }
  return payload;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOCALES = new Set(["en", "zh", "ja"]);
const TYPES = new Set(["assessment_run", "work_plan", "work_permit", "tbm_session"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const entityType = String(body.entity_type || "");
    const entityId = String(body.entity_id || "");
    const locale = String(body.locale || "");
    const contentHash = String(body.content_hash || "");
    const fields = (body.fields && typeof body.fields === "object" ? body.fields : {}) as Record<string, string>;

    if (!TYPES.has(entityType) || !entityId || !LOCALES.has(locale) || !contentHash) {
      return new Response(JSON.stringify({ error: "invalid_request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, service);
    const { data: cached } = await admin
      .from("doc_view_translations")
      .select("payload")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .eq("locale", locale)
      .eq("content_hash", contentHash)
      .maybeSingle();
    if (cached?.payload) {
      return new Response(JSON.stringify({ payload: cached.payload, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await translateFields(fields, locale);

    await admin.from("doc_view_translations").upsert(
      {
        entity_type: entityType,
        entity_id: entityId,
        locale,
        content_hash: contentHash,
        payload,
      },
      { onConflict: "entity_type,entity_id,locale,content_hash" },
    );

    return new Response(JSON.stringify({ payload, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
