#!/usr/bin/env bash
# Provision schema on a NEW (own) Supabase project.
# Does NOT touch Lovable Cloud project iqtiozscqwuacgzrlfzu.
#
# Required:
#   SUPABASE_ACCESS_TOKEN  - https://supabase.com/dashboard/account/tokens
#   NEW_PROJECT_REF        - new project reference id
#
# Optional:
#   DATABASE_PASSWORD      - if link prompts / non-interactive
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Set SUPABASE_ACCESS_TOKEN first." >&2
  exit 1
fi
if [[ -z "${NEW_PROJECT_REF:-}" ]]; then
  echo "Set NEW_PROJECT_REF to your new project ref (not iqtiozscqwuacgzrlfzu)." >&2
  exit 1
fi
if [[ "$NEW_PROJECT_REF" == "iqtiozscqwuacgzrlfzu" ]]; then
  echo "Refusing to link Lovable Cloud project. Create your own project first." >&2
  exit 1
fi

echo "==> Linking project $NEW_PROJECT_REF"
LINK_ARGS=(link --project-ref "$NEW_PROJECT_REF" --yes)
if [[ -n "${DATABASE_PASSWORD:-}" ]]; then
  LINK_ARGS+=(--password "$DATABASE_PASSWORD")
fi
npx supabase "${LINK_ARGS[@]}"

echo "==> Pushing migrations"
npx supabase db push --yes

echo "==> Reminder: run scripts/migrate-own-supabase/ensure-buckets.sql in SQL Editor"
echo "==> Reminder: deploy functions with: npx supabase functions deploy"
echo "Done. Lovable project iqtiozscqwuacgzrlfzu was not modified."
