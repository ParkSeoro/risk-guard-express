-- Clean up expired temporary files (>24h old) in private archive-restore-cache bucket nightly at KST 03:40 (UTC 18:40)
-- Ensures on-demand restored copies never accumulate in Supabase Storage.

CREATE OR REPLACE FUNCTION public.cleanup_expired_restore_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  _deleted integer := 0;
BEGIN
  DELETE FROM storage.objects
   WHERE bucket_id = 'archive-restore-cache'
     AND created_at < now() - interval '24 hours';
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_restore_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_restore_cache() FROM anon, authenticated;

DO $$
DECLARE
  _existing_id bigint;
BEGIN
  SELECT jobid INTO _existing_id FROM cron.job WHERE jobname = 'safenex-nightly-restore-cache-cleanup';
  IF _existing_id IS NOT NULL THEN
    PERFORM cron.unschedule(_existing_id);
  END IF;
  PERFORM cron.schedule(
    'safenex-nightly-restore-cache-cleanup',
    '40 18 * * *',
    'SELECT public.cleanup_expired_restore_cache();'
  );
END $$;
