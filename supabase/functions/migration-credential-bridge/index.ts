// Temporary Lovable Cloud helper — DELETE after migration.
// Returns source DB credentials so we can copy data to own Supabase.
// Protected by ACCESS_KEY query/header.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const ACCESS_KEY = "Ku3YYTR673NcBslYjkw-o1qx5VwLNnHI";

serve(async (req) => {
  const url = new URL(req.url);
  const key =
    url.searchParams.get("key") ||
    req.headers.get("x-migrate-key") ||
    "";

  if (key !== ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Prefer full DB URL; fall back to pieces Lovable may inject
  const dbUrl =
    Deno.env.get("SUPABASE_DB_URL") ||
    Deno.env.get("POSTGRES_URL") ||
    Deno.env.get("DATABASE_URL") ||
    null;

  const body = {
    supabase_url: Deno.env.get("SUPABASE_URL") || null,
    service_role_key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null,
    anon_key:
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
      null,
    supabase_db_url: dbUrl,
    note: "Delete this function immediately after migration.",
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
