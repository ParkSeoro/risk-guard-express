-- Applied by hand on 2026-10-24. Do not put this in supabase/migrations.
-- Each statement must run on its own, outside a transaction.
-- These are expression indexes only. They are not unique.
-- The attendance view and who counts as attended stay unchanged.
-- Rollback: supabase/applied-manually/20261024_attendance_kst_date_indexes_rollback.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wel_entry_kst_date
  ON public.worker_entry_logs (((entry_at AT TIME ZONE 'Asia/Seoul')::date));

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tbm_part_kst_date
  ON public.tbm_participations (((participated_at AT TIME ZONE 'Asia/Seoul')::date));
