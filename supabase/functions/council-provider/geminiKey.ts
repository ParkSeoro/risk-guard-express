/**
 * Vault-first GEMINI_API_KEY lookup.
 * Same order as supabase/functions/_shared/geminiNative.ts:
 * Vault wins so a stale edge secret does not keep an old key.
 */
const VAULT_SECRET_NAME = "GEMINI_API_KEY";
const KEY_CACHE_MS = 60_000;

let cachedKey: { value: string; at: number } | null = null;

async function readVaultGeminiKey(): Promise<string> {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !service) return "";
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
      body: JSON.stringify({ secret_name: VAULT_SECRET_NAME }),
      signal: controller.signal,
    });
    if (!resp.ok) return "";
    const data = await resp.json().catch(() => null);
    return typeof data === "string" ? data.trim() : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveGeminiApiKey(): Promise<string> {
  const now = Date.now();
  if (cachedKey && now - cachedKey.at < KEY_CACHE_MS) return cachedKey.value;
  const fromVault = await readVaultGeminiKey();
  const fromEnv = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  const value = fromVault || fromEnv;
  cachedKey = { value, at: now };
  return value;
}
