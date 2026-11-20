-- Fix Phase 1b gate: quota < 80% in evaluate, allowlist-aligned backlog, revoke public count RPC.

CREATE OR REPLACE FUNCTION public.count_archive_copy_backlog(_min_age_days integer DEFAULT 60)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_count bigint;
BEGIN
  -- Count only paths the backup worker would copy (same allowlist as backup-storage-to-gdrive).
  SELECT COUNT(*)::bigint INTO v_count
  FROM storage.objects o
  LEFT JOIN public.storage_archive_registry r
    ON r.bucket_id = o.bucket_id
   AND r.object_path = o.name
  WHERE o.bucket_id = 'attachments'
    AND o.created_at <= now() - make_interval(days => GREATEST(1, _min_age_days))
    AND (r.id IS NULL OR r.archive_status IN ('active', 'failed'))
    AND lower(o.name) NOT LIKE '%/site-maps/%'
    AND lower(o.name) NOT LIKE '%/drone-maps/%'
    AND lower(o.name) NOT LIKE '%/print-cache/%'
    AND lower(o.name) NOT LIKE 'chat/%'
    AND (
      lower(o.name) LIKE 'safety-cost/%'
      OR lower(o.name) LIKE 'worker-photos/%'
      OR lower(o.name) LIKE 'feedback/%'
      OR o.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(work-plans|tbm|safety-inspection|mobile-inspect|inspection-actions|accidents|incidents|work-stop|chemicals|worker-sign)/'
    );
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.count_archive_copy_backlog(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_archive_copy_backlog(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_archive_copy_backlog(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.evaluate_storage_purge_gate()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.storage_archive_policy%ROWTYPE;
  v_backlog bigint := 0;
  v_recent_ok boolean := false;
  v_restore_ok boolean := false;
  v_quota_ok boolean := true;
  v_allowed boolean := false;
  v_notes text := '';
  v_recent_count integer := 0;
  v_recent_bad integer := 0;
  v_quota_used bigint;
  v_quota_limit bigint;
BEGIN
  SELECT * INTO p FROM public.storage_archive_policy WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('director_armed', false, 'auto_purge_allowed', false, 'notes', 'policy_missing');
  END IF;

  v_backlog := public.count_archive_copy_backlog(p.purge_min_age_days);

  WITH night_dates AS (
    SELECT d FROM (
      SELECT DISTINCT (started_at AT TIME ZONE 'Asia/Seoul')::date AS d
      FROM public.storage_backup_runs
      WHERE finished_at IS NOT NULL
    ) raw
    ORDER BY d DESC
    LIMIT 3
  ),
  night_ok AS (
    SELECT nd.d,
           bool_and(r.error_cnt = 0 AND NOT r.circuit_broken) AS ok
    FROM night_dates nd
    JOIN public.storage_backup_runs r
      ON (r.started_at AT TIME ZONE 'Asia/Seoul')::date = nd.d
     AND r.finished_at IS NOT NULL
    GROUP BY nd.d
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE NOT ok)
    INTO v_recent_count, v_recent_bad
  FROM night_ok;
  v_recent_ok := (v_recent_count = 3 AND v_recent_bad = 0);

  v_restore_ok := (
    p.last_verified_restore_at IS NOT NULL
    AND p.last_verified_restore_at >= now() - interval '7 days'
  );

  SELECT quota_used_bytes, quota_limit_bytes
    INTO v_quota_used, v_quota_limit
  FROM public.storage_backup_runs
  WHERE finished_at IS NOT NULL
    AND quota_limit_bytes IS NOT NULL
    AND quota_limit_bytes > 0
  ORDER BY started_at DESC
  LIMIT 1;

  IF v_quota_limit IS NOT NULL AND v_quota_limit > 0 AND v_quota_used IS NOT NULL THEN
    v_quota_ok := (v_quota_used::numeric / v_quota_limit::numeric) < 0.80;
  END IF;

  v_allowed := p.director_armed
    AND v_backlog = 0
    AND v_recent_ok
    AND v_restore_ok
    AND v_quota_ok;

  v_notes := format(
    'armed=%s backlog60=%s recent_ok=%s restore_ok=%s quota_ok=%s clean_nights=%s canary_nights=%s',
    p.director_armed, v_backlog, v_recent_ok, v_restore_ok, v_quota_ok,
    p.consecutive_clean_nights, p.consecutive_canary_success_nights
  );

  UPDATE public.storage_archive_policy
     SET auto_purge_allowed = v_allowed,
         last_gate_notes = v_notes,
         updated_at = now()
   WHERE id = 1;

  RETURN jsonb_build_object(
    'director_armed', p.director_armed,
    'auto_purge_allowed', v_allowed,
    'purge_enabled', (p.director_armed AND v_allowed),
    'copy_min_age_days', p.copy_min_age_days,
    'purge_min_age_days', p.purge_min_age_days,
    'max_purge_files', CASE
      WHEN p.consecutive_canary_success_nights >= 2 THEN p.normal_max_purge_per_tick
      ELSE p.canary_max_purge_per_tick
    END,
    'backlog_over_purge_age', v_backlog,
    'last_verified_restore_at', p.last_verified_restore_at,
    'quota_ok', v_quota_ok,
    'notes', v_notes
  );
END;
$$;
