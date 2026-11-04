-- The hourly scan walked every still-open permit. End-of-work pushes were rare.
-- Next-day closure and the day-before work-plan notice keep their own jobs.

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'scan-permit-expiries';

REVOKE ALL ON FUNCTION public.scan_permit_expiries() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scan_permit_expiries() TO service_role;
