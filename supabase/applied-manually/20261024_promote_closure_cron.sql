-- Applied by hand on 2026-10-24. Do not put this in supabase/migrations.
-- Schedules only promote_permits_to_closure_pending.
-- The daily worker edge function stays unscheduled.
-- Registering these jobs does not run the function.
-- 09:05 KST and 11:05 KST. The date window inside the function stays yesterday UTC.
-- Rollback: supabase/applied-manually/20261024_promote_closure_cron_rollback.sql

SELECT cron.unschedule(jobid)
  FROM cron.job
 WHERE jobname IN ('promote-closure-0905-kst', 'promote-closure-1105-kst');

SELECT cron.schedule(
  'promote-closure-0905-kst',
  '5 0 * * *',
  $$SELECT public.promote_permits_to_closure_pending();$$
);

SELECT cron.schedule(
  'promote-closure-1105-kst',
  '5 2 * * *',
  $$SELECT public.promote_permits_to_closure_pending();$$
);
