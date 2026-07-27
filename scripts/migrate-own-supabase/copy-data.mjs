#!/usr/bin/env node
/**
 * Copy public-table rows (+ optional storage) from Lovable Cloud → own Supabase.
 *
 * Requires .env.migrate.local:
 *   SOURCE_SUPABASE_URL
 *   SOURCE_SERVICE_ROLE_KEY
 *   DEST_SUPABASE_URL
 *   DEST_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/migrate-own-supabase/copy-data.mjs
 *   node scripts/migrate-own-supabase/copy-data.mjs --storage
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnv(resolve(process.cwd(), ".env.migrate.local"));

const SRC_URL = process.env.SOURCE_SUPABASE_URL;
const SRC_KEY = process.env.SOURCE_SERVICE_ROLE_KEY;
const DST_URL = process.env.DEST_SUPABASE_URL;
const DST_KEY = process.env.DEST_SERVICE_ROLE_KEY;
const WITH_STORAGE = process.argv.includes("--storage");

if (!SRC_URL || !SRC_KEY || !DST_URL || !DST_KEY) {
  console.error("Missing SOURCE_/DEST_ URL or SERVICE_ROLE_KEY in .env.migrate.local");
  process.exit(1);
}

const src = createClient(SRC_URL, SRC_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const dst = createClient(DST_URL, DST_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const SKIP_TABLES = new Set([
  // managed / ephemeral
  "schema_migrations",
]);

async function listPublicTables() {
  // Use REST OpenAPI or a known inventory from types — prefer RPC-less information_schema via SQL if available.
  // Fallback: probe from generated types file.
  const types = readFileSync(resolve(process.cwd(), "src/integrations/supabase/types.ts"), "utf8");
  const block = types.match(/Tables: \{([\s\S]*?)\n    Views: \{/)?.[1] || "";
  const tables = [...block.matchAll(/\n      ([a-z][a-z0-9_]*): \{\n        Row: \{/g)].map((m) => m[1]);
  return tables.filter((t) => !SKIP_TABLES.has(t));
}

async function copyTable(table) {
  const pageSize = 500;
  let from = 0;
  let total = 0;
  for (;;) {
    const { data, error } = await src.from(table).select("*").range(from, from + pageSize - 1);
    if (error) {
      // table may not exist / not exposed
      return { table, ok: false, error: error.message, total };
    }
    if (!data?.length) break;
    const { error: upErr } = await dst.from(table).upsert(data, { onConflict: "id" });
    if (upErr) {
      // try insert ignore style by chunk without upsert if no id
      const { error: insErr } = await dst.from(table).insert(data);
      if (insErr) return { table, ok: false, error: insErr.message, total };
    }
    total += data.length;
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { table, ok: true, total };
}

async function copyAuthUsers() {
  let page = 1;
  let copied = 0;
  let skipped = 0;
  for (;;) {
    const { data, error } = await src.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { ok: false, error: error.message, copied, skipped };
    const users = data?.users || [];
    if (!users.length) break;
    for (const u of users) {
      const { error: cErr } = await dst.auth.admin.createUser({
        id: u.id,
        email: u.email,
        email_confirm: !!u.email_confirmed_at,
        phone: u.phone || undefined,
        phone_confirm: !!u.phone_confirmed_at,
        user_metadata: u.user_metadata || {},
        app_metadata: u.app_metadata || {},
        // password unknown — user must reset password after migrate unless DB-level copy used
      });
      if (cErr) {
        // already exists
        if (/already|exists|registered/i.test(cErr.message)) skipped++;
        else console.warn("auth create", u.email, cErr.message);
      } else copied++;
    }
    if (users.length < 200) break;
    page++;
  }
  return { ok: true, copied, skipped };
}

async function copyStorage() {
  const { data: buckets, error } = await src.storage.listBuckets();
  if (error) return { ok: false, error: error.message };
  const summary = [];
  for (const b of buckets || []) {
    await dst.storage.createBucket(b.id, { public: !!b.public }).catch(() => {});
    // recursive list is limited — copy top-level then nested via queue
    const queue = [""];
    let files = 0;
    while (queue.length) {
      const prefix = queue.pop();
      const { data: entries, error: lErr } = await src.storage.from(b.id).list(prefix, { limit: 1000 });
      if (lErr) {
        summary.push({ bucket: b.id, error: lErr.message, files });
        break;
      }
      for (const e of entries || []) {
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) {
          queue.push(path);
          continue;
        }
        const { data: blob, error: dErr } = await src.storage.from(b.id).download(path);
        if (dErr) {
          console.warn("download", b.id, path, dErr.message);
          continue;
        }
        const buf = new Uint8Array(await blob.arrayBuffer());
        const { error: uErr } = await dst.storage.from(b.id).upload(path, buf, {
          upsert: true,
          contentType: blob.type || undefined,
        });
        if (uErr) console.warn("upload", b.id, path, uErr.message);
        else files++;
      }
    }
    summary.push({ bucket: b.id, files });
  }
  return { ok: true, summary };
}

async function main() {
  console.log("Source", SRC_URL);
  console.log("Dest  ", DST_URL);

  console.log("\n== Auth users ==");
  const auth = await copyAuthUsers();
  console.log(auth);

  const tables = await listPublicTables();
  console.log(`\n== Tables (${tables.length}) ==`);
  // Prefer dependency-friendly order: companies/projects first
  const preferred = [
    "projects",
    "companies",
    "project_companies",
    "profiles",
    "user_roles",
    "project_members",
  ];
  const ordered = [...preferred.filter((t) => tables.includes(t)), ...tables.filter((t) => !preferred.includes(t))];

  for (const t of ordered) {
    const r = await copyTable(t);
    if (r.total || !r.ok) console.log(r);
  }

  if (WITH_STORAGE) {
    console.log("\n== Storage ==");
    console.log(await copyStorage());
  }

  console.log("\nDone. Auth users copied without passwords — they need password reset on the new project (except accounts already created there).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
