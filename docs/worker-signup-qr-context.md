# Worker signup QR context (S0)

Apply this migration on Supabase **SQL Editor** (or `supabase db push` when history is repaired):

`supabase/migrations/20260803220000_worker_signup_qr_context.sql`

It provides:
- `map_signup_position_to_role` — position → `role_new` (Q4)
- Updated `process_signup_company_selection`
- `complete_worker_roster_signup` — Auth + membership + `workers` row (등록대기)

## Flow
1. Admin: 근로자 관리 → 소속사 필수 → 등록 QR
2. Worker scans → `/worker/register?project&company` → app download CTA → `/register?audience=worker&…`
3. Signup creates pending account + roster row (상태 **등록대기**)
4. Admin approves in 사용자 관리 → 활성

Play Store: `https://play.google.com/store/apps/details?id=org.safenex.app`  
Override: `VITE_PLAY_STORE_URL`
