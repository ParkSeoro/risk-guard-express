DO $$
BEGIN
  PERFORM cron.unschedule('scan-work-plan-end-warnings')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-work-plan-end-warnings');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'scan-work-plan-end-warnings',
  '0 15 * * *',
  $$SELECT public.scan_work_plan_end_warnings();$$
);
