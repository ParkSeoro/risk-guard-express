-- Master-only read-only live dashboard RPC for Google One storage archive & purge policy

CREATE OR REPLACE FUNCTION public.get_storage_archive_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p public.storage_archive_policy%ROWTYPE;
  v_backlog_60 bigint := 0;
  v_backlog_30 bigint := 0;
  v_storage jsonb;
  v_registry jsonb;
  v_by_domain jsonb;
  v_quota jsonb;
  v_runs jsonb;
  v_copied_24h bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'master_only';
  END IF;

  SELECT * INTO p FROM public.storage_archive_policy WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'policy_missing');
  END IF;

  v_backlog_60 := public.count_archive_copy_backlog(p.purge_min_age_days);
  v_backlog_30 := public.count_archive_copy_backlog(p.copy_min_age_days);

  SELECT jsonb_build_object(
    'total_objects', count(*),
    'total_bytes', coalesce(sum((metadata->>'size')::bigint), 0),
    'over_30d_objects', count(*) FILTER (WHERE created_at < now() - make_interval(days => p.copy_min_age_days)),
    'over_60d_objects', count(*) FILTER (WHERE created_at < now() - make_interval(days => p.purge_min_age_days))
  ) INTO v_storage
  FROM storage.objects;

  SELECT jsonb_build_object(
    'backed_up_count', count(*) FILTER (WHERE archive_status IN ('backed_up', 'verified')),
    'backed_up_bytes', coalesce(sum(file_size) FILTER (WHERE archive_status IN ('backed_up', 'verified')), 0),
    'purged_count', count(*) FILTER (WHERE archive_status = 'purged'),
    'purged_bytes', coalesce(sum(file_size) FILTER (WHERE archive_status = 'purged'), 0),
    'failed_count', count(*) FILTER (WHERE archive_status = 'failed' OR last_error IS NOT NULL)
  ) INTO v_registry
  FROM public.storage_archive_registry;

  SELECT coalesce(jsonb_agg(row_to_json(d)), '[]'::jsonb) INTO v_by_domain
  FROM (
    SELECT
      coalesce(domain, 'other') AS domain,
      count(*) FILTER (WHERE archive_status IN ('backed_up', 'verified')) AS backed_up_count,
      count(*) FILTER (WHERE archive_status = 'purged') AS purged_count,
      coalesce(sum(file_size), 0) AS total_bytes
    FROM public.storage_archive_registry
    GROUP BY coalesce(domain, 'other')
    ORDER BY count(*) DESC
    LIMIT 10
  ) d;

  SELECT jsonb_build_object(
    'used_bytes', quota_used_bytes,
    'limit_bytes', quota_limit_bytes
  ) INTO v_quota
  FROM public.storage_backup_runs
  WHERE quota_used_bytes IS NOT NULL
  ORDER BY started_at DESC
  LIMIT 1;

  SELECT coalesce(sum(copied_cnt), 0) INTO v_copied_24h
  FROM public.storage_backup_runs
  WHERE started_at >= now() - interval '24 hours';

  SELECT coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_runs
  FROM (
    SELECT
      id,
      mode,
      started_at,
      finished_at,
      copied_cnt,
      verified_cnt,
      purged_cnt,
      skipped_cnt,
      error_cnt,
      circuit_broken
    FROM public.storage_backup_runs
    ORDER BY started_at DESC
    LIMIT 12
  ) r;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'policy', jsonb_build_object(
      'director_armed', p.director_armed,
      'auto_purge_allowed', p.auto_purge_allowed,
      'purge_would_run', (p.director_armed AND p.auto_purge_allowed),
      'copy_min_age_days', p.copy_min_age_days,
      'purge_min_age_days', p.purge_min_age_days,
      'canary_max_purge_per_tick', p.canary_max_purge_per_tick,
      'normal_max_purge_per_tick', p.normal_max_purge_per_tick,
      'consecutive_clean_nights', p.consecutive_clean_nights,
      'consecutive_canary_success_nights', p.consecutive_canary_success_nights,
      'backlog_over_purge_age', v_backlog_60,
      'backlog_over_copy_age', v_backlog_30,
      'last_verified_restore_at', p.last_verified_restore_at,
      'last_gate_notes', p.last_gate_notes,
      'last_disarm_reason', p.last_disarm_reason,
      'armed_at', p.armed_at
    ),
    'storage', coalesce(v_storage, '{}'::jsonb),
    'registry', coalesce(v_registry, '{}'::jsonb),
    'by_domain', v_by_domain,
    'quota', coalesce(v_quota, '{}'::jsonb),
    'copied_24h', v_copied_24h,
    'recent_runs', v_runs
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_storage_archive_dashboard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storage_archive_dashboard() TO authenticated;
