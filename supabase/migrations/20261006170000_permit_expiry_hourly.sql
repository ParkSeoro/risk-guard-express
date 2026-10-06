-- Permit end notices are checked once an hour. A 10-minute poll is unnecessary
-- for a close-the-permit reminder, and this replaces that schedule where it exists.

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
