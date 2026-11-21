-- Fix restore-cache cleanup: Supabase blocks direct SQL DELETE on storage.objects (protect_delete trigger).
-- Unschedule the direct-SQL job, turn cleanup_expired_restore_cache() into a no-op, and provide a
-- service_role-only SELECT RPC so backup-storage-to-gdrive deletes expired (>24h) cache files via Storage API.

DO $$
DECLARE
  _existing_id bigint;
BEGIN
  SELECT jobid INTO _existing_id FROM cron.job WHERE jobname = 'safenex-nightly-restore-cache-cleanup';
  IF _existing_id IS NOT NULL THEN
    PERFORM cron.unschedule(_existing_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_restore_cache()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 0;
$$;

CREATE OR REPLACE FUNCTION public.list_expired_restore_cache_objects(
  _older_than_hours integer DEFAULT 24,
  _limit integer DEFAULT 50
)
RETURNS TABLE(object_path text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  RETURN QUERY
  SELECT o.name AS object_path
  FROM storage.objects o
  WHERE o.bucket_id = 'archive-restore-cache'
    AND o.created_at < now() - make_interval(hours => GREATEST(1, _older_than_hours))
  ORDER BY o.created_at ASC
  LIMIT LEAST(GREATEST(1, _limit), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.list_expired_restore_cache_objects(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_expired_restore_cache_objects(integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_expired_restore_cache_objects(integer, integer) TO service_role;
