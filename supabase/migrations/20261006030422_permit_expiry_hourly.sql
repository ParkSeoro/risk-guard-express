DO $$
BEGIN
  PERFORM cron.unschedule('scan-permit-expiries')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scan-permit-expiries');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'scan-permit-expiries',
  '0 * * * *',
  $$SELECT public.scan_permit_expiries();$$
);
