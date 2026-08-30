# AGENTS.md

## New chat / handoff

Do **not** replay a long prior Cloud Agent thread. At the start of a new chat, read `.cursor/HANDOFF.md` (product decisions + what is on `main`) and handle **only** the issue in the user’s message. One issue per chat.

## Cursor Cloud specific instructions

### Overview
Single-service frontend SPA: **SafeNex** safety management system (Korean-language UI). Stack: Vite + React + TypeScript + shadcn-ui + Tailwind. The backend is a **hosted, remote Supabase project** (not run locally) — credentials live in `.env` (`VITE_SUPABASE_*`). Capacitor is used for mobile builds but is not needed for local web development.

### Package manager
Use **Bun**, not npm. CI (`.github/workflows/mobile-release.yml`) uses `bun install --frozen-lockfile`, and `bun.lock` is the source of truth. The committed `package-lock.json` is stale and `npm ci` fails against it — do not use npm.

### Commands (run from repo root)
- Install: `bun install --frozen-lockfile`
- Dev server: `bun run dev` (Vite on port **8080**, host `::`)
- Lint: `bun run lint` (see caveat below)
- Test: `bun run test` (Vitest, jsdom; `bun run test:watch` for watch mode)
- Build: `bun run build` (production) / `bun run build:dev` (development mode)

### Non-obvious caveats
- **Lint is expected to fail.** `bun run lint` reports a large number of pre-existing errors (mostly `@typescript-eslint/no-explicit-any`), many inside `supabase/functions/**` (Deno edge functions). The tooling works; the failures are pre-existing repo state, not an environment problem.
- The dev server talks to the **live remote Supabase**. Signing up creates a real auth user. Email confirmation is required (`mailer_autoconfirm=false`) and new accounts start as `pending` (need admin approval), so a fresh signup cannot reach the authenticated dashboard without an approved account.
- Signup ("회원가입") requires selecting a real project + company from a public directory (RPC `get_signup_company_directory`) or a valid invite code. The directory is populated from the remote DB.
- Root routes require auth and redirect unauthenticated users to `/landing`. Public routes include `/landing`, `/auth`, `/manual`, `/privacy`, and worker/QR entry points.
