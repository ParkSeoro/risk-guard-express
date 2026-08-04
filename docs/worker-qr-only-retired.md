# QR-only worker portal — retired

SafeNex requires Auth accounts for workers. The legacy QR-only identity path is cut.

## Removed / redirected
- `/worker` — shows account-required CTA → login / register
- `/worker/portal/:token` — redirects to `/login`
- Mobile roster no longer generates portal QR stickers
- `register_worker` — execute revoked from `anon`
- `company_qr_check_in` — no longer inserts new `workers` rows (`WORKER_NOT_REGISTERED`)

## Keep (Auth-bound)
- `/worker/register?project&company` → Auth signup + roster RPC
- PC daily QR / company board QR for **existing** roster workers
- Account GPS via `/app/worker` + `track-location`

## Ops
Apply migration `20260804010000_worker_last_positions_qr_only_kill.sql` (SQL Editor if `db push` history mismatches).
Redeploy edge function `track-location` so last-GPS upserts run.
