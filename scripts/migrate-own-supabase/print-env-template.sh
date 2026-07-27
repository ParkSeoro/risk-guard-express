#!/usr/bin/env bash
# Print cutover env template for Vercel / .env.local
# Usage:
#   NEW_PROJECT_REF=xxx NEW_ANON_KEY=yyy ./scripts/migrate-own-supabase/print-env-template.sh
set -euo pipefail

REF="${NEW_PROJECT_REF:?Set NEW_PROJECT_REF}"
ANON="${NEW_ANON_KEY:?Set NEW_ANON_KEY}"

if [[ "$REF" == "iqtiozscqwuacgzrlfzu" ]]; then
  echo "Refusing Lovable Cloud ref — use your new project." >&2
  exit 1
fi

cat <<EOF
# --- own Supabase (.env.local or Vercel) ---
VITE_SUPABASE_PROJECT_ID="${REF}"
VITE_SUPABASE_URL="https://${REF}.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="${ANON}"

# Keep repo .env pointing at Lovable as backup until cutover is confirmed.
# Lovable ref (DO NOT DELETE): iqtiozscqwuacgzrlfzu
EOF
