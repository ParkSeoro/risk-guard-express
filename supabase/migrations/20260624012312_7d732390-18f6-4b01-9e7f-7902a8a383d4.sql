
-- Anonymize lat/lng/accuracy on events older than 90 days, keep the event record itself.
CREATE OR REPLACE FUNCTION public.anonymize_old_location_data()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.worker_zone_events
     SET lat = NULL, lng = NULL, accuracy_m = NULL
   WHERE created_at < now() - interval '90 days'
     AND (lat IS NOT NULL OR lng IS NOT NULL OR accuracy_m IS NOT NULL);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_old_location_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_old_location_data() TO service_role;

-- Schedule daily at 03:00 UTC (12:00 KST). Drop existing schedule first to keep idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('anonymize-location-daily');
EXCEPTION WHEN OTHERS THEN
  -- not scheduled yet, ignore
  NULL;
END $$;

SELECT cron.schedule(
  'anonymize-location-daily',
  '0 3 * * *',
  $$ SELECT public.anonymize_old_location_data(); $$
);
