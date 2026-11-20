-- Phase 1b: one-time director arm + auto purge gate (PR #684 §5.1)
-- Initial director_armed = false → purge stays OFF until master arms once.

CREATE TABLE IF NOT EXISTS public.storage_archive_policy (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  director_armed boolean NOT NULL DEFAULT false,
  armed_at timestamptz NULL,
  armed_by uuid NULL,
  auto_purge_allowed boolean NOT NULL DEFAULT false,
  copy_min_age_days integer NOT NULL DEFAULT 30 CHECK (copy_min_age_days >= 1),
  purge_min_age_days integer NOT NULL DEFAULT 60 CHECK (purge_min_age_days >= 30),
  canary_max_purge_per_tick integer NOT NULL DEFAULT 5 CHECK (canary_max_purge_per_tick >= 1),
  normal_max_purge_per_tick integer NOT NULL DEFAULT 15 CHECK (normal_max_purge_per_tick >= 1),
  consecutive_clean_nights integer NOT NULL DEFAULT 0 CHECK (consecutive_clean_nights >= 0),
  consecutive_canary_success_nights integer NOT NULL DEFAULT 0 CHECK (consecutive_canary_success_nights >= 0),
  last_counted_night text NULL,
  last_verified_restore_at timestamptz NULL,
  last_gate_notes text NULL,
  last_disarm_reason text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.storage_archive_policy (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.storage_archive_policy ENABLE ROW LEVEL SECURITY;

-- Masters may read policy status (no secrets). Writes go through RPCs below.
DROP POLICY IF EXISTS storage_archive_policy_master_select ON public.storage_archive_policy;
CREATE POLICY storage_archive_policy_master_select
  ON public.storage_archive_policy
  FOR SELECT
  TO authenticated
  USING (public.is_master(auth.uid()));

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
  -- Allowlist only (same domains as backup-storage-to-gdrive). Unknown paths never block the gate.
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
  v_allowed boolean := false;
  v_notes text := '';
  v_recent_count integer := 0;
  v_recent_bad integer := 0;
  v_quota_ok boolean := true;
  v_quota_used bigint;
  v_quota_limit bigint;
BEGIN
  SELECT * INTO p FROM public.storage_archive_policy WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('director_armed', false, 'auto_purge_allowed', false, 'notes', 'policy_missing');
  END IF;

  v_backlog := public.count_archive_copy_backlog(p.purge_min_age_days);

  -- K=3 distinct KST calendar nights (not raw ticks)
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

CREATE OR REPLACE FUNCTION public.get_storage_purge_policy_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.storage_archive_policy%ROWTYPE;
  v_backlog bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'master_only';
  END IF;
  SELECT * INTO p FROM public.storage_archive_policy WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'policy_missing');
  END IF;
  v_backlog := public.count_archive_copy_backlog(p.purge_min_age_days);
  RETURN jsonb_build_object(
    'director_armed', p.director_armed,
    'auto_purge_allowed', p.auto_purge_allowed,
    'purge_would_run', (p.director_armed AND p.auto_purge_allowed),
    'copy_min_age_days', p.copy_min_age_days,
    'purge_min_age_days', p.purge_min_age_days,
    'canary_max_purge_per_tick', p.canary_max_purge_per_tick,
    'normal_max_purge_per_tick', p.normal_max_purge_per_tick,
    'consecutive_canary_success_nights', p.consecutive_canary_success_nights,
    'backlog_over_purge_age', v_backlog,
    'last_verified_restore_at', p.last_verified_restore_at,
    'last_gate_notes', p.last_gate_notes,
    'last_disarm_reason', p.last_disarm_reason,
    'armed_at', p.armed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_storage_purge_gate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_storage_purge_gate() TO service_role;
REVOKE ALL ON FUNCTION public.get_storage_purge_policy_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storage_purge_policy_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.arm_storage_purge_policy()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'master_only';
  END IF;

  UPDATE public.storage_archive_policy
     SET director_armed = true,
         armed_at = now(),
         armed_by = auth.uid(),
         last_disarm_reason = null,
         updated_at = now()
   WHERE id = 1;

  RETURN public.evaluate_storage_purge_gate();
END;
$$;

REVOKE ALL ON FUNCTION public.arm_storage_purge_policy() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.arm_storage_purge_policy() TO authenticated;

CREATE OR REPLACE FUNCTION public.disarm_storage_purge_policy(_reason text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_role text := COALESCE(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.role(), ''),
    ''
  );
  v_service boolean := (v_jwt_role = 'service_role');
BEGIN
  IF NOT v_service AND (v_uid IS NULL OR NOT public.is_master(v_uid)) THEN
    RAISE EXCEPTION 'master_or_service_only';
  END IF;

  UPDATE public.storage_archive_policy
     SET director_armed = false,
         auto_purge_allowed = false,
         consecutive_canary_success_nights = 0,
         last_disarm_reason = COALESCE(NULLIF(trim(_reason), ''), 'manual'),
         updated_at = now()
   WHERE id = 1;

  RETURN jsonb_build_object(
    'director_armed', false,
    'auto_purge_allowed', false,
    'reason', COALESCE(NULLIF(trim(_reason), ''), 'manual')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.disarm_storage_purge_policy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disarm_storage_purge_policy(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pause_storage_auto_purge(_reason text DEFAULT 'transient')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.storage_archive_policy
     SET auto_purge_allowed = false,
         last_gate_notes = COALESCE(NULLIF(trim(_reason), ''), 'transient_pause'),
         updated_at = now()
   WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.pause_storage_auto_purge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pause_storage_auto_purge(text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_storage_purge_night_result(
  _error_cnt integer,
  _circuit_broken boolean,
  _purge_was_enabled boolean,
  _fatal boolean DEFAULT false,
  _fatal_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.storage_archive_policy%ROWTYPE;
  v_night text := to_char((now() AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD');
BEGIN
  SELECT * INTO p FROM public.storage_archive_policy WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF _fatal THEN
    PERFORM public.disarm_storage_purge_policy(COALESCE(_fatal_reason, 'fatal'));
    RETURN;
  END IF;

  IF _error_cnt > 0 OR _circuit_broken THEN
    UPDATE public.storage_archive_policy
       SET consecutive_clean_nights = 0,
           consecutive_canary_success_nights = 0,
           auto_purge_allowed = false,
           last_counted_night = v_night,
           last_gate_notes = 'night_errors_reset_counters',
           updated_at = now()
     WHERE id = 1;
    RETURN;
  END IF;

  -- Count at most once per KST calendar night
  IF p.last_counted_night IS NOT DISTINCT FROM v_night THEN
    RETURN;
  END IF;

  UPDATE public.storage_archive_policy
     SET consecutive_clean_nights = p.consecutive_clean_nights + 1,
         consecutive_canary_success_nights = CASE
           WHEN _purge_was_enabled AND p.consecutive_canary_success_nights < 2
             THEN p.consecutive_canary_success_nights + 1
           ELSE p.consecutive_canary_success_nights
         END,
         last_counted_night = v_night,
         updated_at = now()
   WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_storage_purge_night_result(integer, boolean, boolean, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_storage_purge_night_result(integer, boolean, boolean, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_storage_restore_verified()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.storage_archive_policy
     SET last_verified_restore_at = now(),
         updated_at = now()
   WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_storage_restore_verified() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_storage_restore_verified() TO service_role;

-- Nightly trigger: read gate instead of hard-coded purge_enabled=false
CREATE OR REPLACE FUNCTION public.trigger_nightly_gdrive_backup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _secret text;
  _gate jsonb;
  _purge boolean;
BEGIN
  _secret := public.get_runtime_secret('BACKUP_TRIGGER_SECRET');
  IF _secret IS NULL OR _secret = '' THEN
    RAISE WARNING 'BACKUP_TRIGGER_SECRET not configured; skipping nightly gdrive backup tick';
    RETURN;
  END IF;

  _gate := public.evaluate_storage_purge_gate();
  _purge := COALESCE((_gate->>'purge_enabled')::boolean, false);

  PERFORM net.http_post(
    url := 'https://qhntxmggacorqjjmjqgo.supabase.co/functions/v1/backup-storage-to-gdrive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-backup-trigger-secret', _secret
    ),
    body := jsonb_build_object(
      'purge_enabled', _purge,
      'copy_min_age_days', COALESCE((_gate->>'copy_min_age_days')::int, 30),
      'purge_min_age_days', COALESCE((_gate->>'purge_min_age_days')::int, 60),
      'max_files', 15,
      'max_purge_files', COALESCE((_gate->>'max_purge_files')::int, 5),
      'max_bytes', 52428800,
      'run_restore_probe', true
    ),
    timeout_milliseconds := 55000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_nightly_gdrive_backup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_nightly_gdrive_backup() FROM anon, authenticated;
