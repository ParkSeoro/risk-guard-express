-- Service-role-only helper to list storage.objects older than _min_age_days not yet backed up
CREATE OR REPLACE FUNCTION public.list_archive_candidate_objects(
  _bucket_id text DEFAULT 'attachments',
  _min_age_days integer DEFAULT 30,
  _limit integer DEFAULT 30
)
RETURNS TABLE(
  object_path text,
  file_size bigint,
  mime_type text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  RETURN QUERY
  SELECT
    o.name AS object_path,
    NULLIF(o.metadata->>'size', '')::bigint AS file_size,
    NULLIF(o.metadata->>'mimetype', '') AS mime_type,
    o.created_at
  FROM storage.objects o
  LEFT JOIN public.storage_archive_registry r
    ON r.bucket_id = o.bucket_id
   AND r.object_path = o.name
  WHERE o.bucket_id = _bucket_id
    AND o.created_at <= now() - make_interval(days => GREATEST(1, _min_age_days))
    AND (r.id IS NULL OR r.archive_status IN ('active', 'failed'))
  ORDER BY o.created_at ASC
  LIMIT LEAST(GREATEST(1, _limit), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.list_archive_candidate_objects(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_archive_candidate_objects(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_archive_candidate_objects(text, integer, integer) TO service_role;
