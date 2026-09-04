-- 분포도 was GPS-only (last 12h worker_last_positions). Check-in does not write
-- that table, so morning 출근 (33 at GSC 2026-09-05) showed 2 dots.
-- Count today's open check-ins; use last GPS zone when we have one.

CREATE OR REPLACE FUNCTION public.get_worker_distribution_counts(_project_id uuid)
RETURNS TABLE (
  company_id uuid,
  company_name text,
  zone_id uuid,
  headcount bigint,
  stale_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text;
  _is_master boolean;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  _is_master := public.is_master(_uid);

  SELECT pm.role_new::text
    INTO _role
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id = _uid
   ORDER BY CASE pm.role_new::text
     WHEN 'master' THEN 0
     WHEN 'project_admin' THEN 1
     WHEN 'safety_manager' THEN 2
     ELSE 10
   END
   LIMIT 1;

  IF NOT _is_master AND _role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  WITH on_site AS (
    SELECT e.worker_id, e.entry_at
    FROM public.worker_entry_logs e
    WHERE e.project_id = _project_id
      AND e.exit_at IS NULL
      AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
  ),
  located AS (
    SELECT
      COALESCE(wlp.company_id, w.company_id) AS company_id,
      COALESCE(c.name, w.company_name, '(미지정)') AS company_name,
      CASE
        WHEN wlp.updated_at IS NOT NULL
         AND wlp.updated_at >= (now() - interval '12 hours')
        THEN wlp.zone_id
        ELSE NULL
      END AS zone_id,
      wlp.updated_at
    FROM on_site o
    JOIN public.workers w ON w.id = o.worker_id
    LEFT JOIN public.worker_last_positions wlp
      ON wlp.worker_id = o.worker_id
     AND wlp.project_id = _project_id
    LEFT JOIN public.companies c ON c.id = COALESCE(wlp.company_id, w.company_id)
    WHERE (
      _is_master
      OR public.can_access_company_data(_uid, _project_id, COALESCE(wlp.company_id, w.company_id))
    )
  )
  SELECT
    s.company_id,
    s.company_name,
    s.zone_id,
    count(*)::bigint AS headcount,
    count(*) FILTER (
      WHERE s.updated_at IS NULL OR s.updated_at < (now() - interval '30 minutes')
    )::bigint AS stale_count
  FROM located s
  GROUP BY s.company_id, s.company_name, s.zone_id
  ORDER BY s.company_name, s.zone_id NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_worker_distribution_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_worker_distribution_counts(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_worker_distribution_counts(uuid) IS
  '오늘 미퇴근 출근자 집계. 12시간 내 GPS가 있으면 구역, 없으면 미지정.';

-- Seed last-known GPS on check-in so later tracking / maps have a point.
CREATE OR REPLACE FUNCTION public.upsert_worker_last_position_from_checkin(
  _worker_id uuid,
  _project_id uuid,
  _company_id uuid,
  _lat double precision,
  _lng double precision,
  _accuracy double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF _worker_id IS NULL OR _project_id IS NULL OR _lat IS NULL OR _lng IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.worker_last_positions (
    worker_id, project_id, company_id, zone_id, lat, lng, accuracy_m, source, updated_at
  ) VALUES (
    _worker_id, _project_id, _company_id, NULL, _lat, _lng, _accuracy, 'checkin', now()
  )
  ON CONFLICT (worker_id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    company_id = COALESCE(EXCLUDED.company_id, public.worker_last_positions.company_id),
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    accuracy_m = EXCLUDED.accuracy_m,
    source = EXCLUDED.source,
    updated_at = now();
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_worker_last_position_from_checkin(uuid, uuid, uuid, double precision, double precision, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_worker_last_position_from_checkin(uuid, uuid, uuid, double precision, double precision, double precision)
  TO service_role;

CREATE OR REPLACE FUNCTION public.worker_gps_daily_lifecycle(
  _action text,
  _worker_id uuid,
  _project_id uuid,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _accuracy double precision DEFAULT NULL,
  _signature text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _uid uuid := auth.uid();
  _phone text;
  _digits text;
  _w record;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  _log record;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;

  IF _action IS NULL OR _action NOT IN ('entry', 'ack', 'exit') THEN
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;

  IF _worker_id IS NULL OR _project_id IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ARGS');
  END IF;

  SELECT phone INTO _phone FROM public.profiles WHERE user_id = _uid LIMIT 1;
  _digits := public.normalize_phone_digits(_phone);

  IF COALESCE(_digits, '') = '' AND NOT public.is_master(_uid) THEN
    RETURN jsonb_build_object('error', 'PHONE_REQUIRED', 'message', '프로필 전화번호가 필요합니다.');
  END IF;

  SELECT w.id, w.project_id, w.phone, w.is_active, w.company_id,
         w.site_entry_suspended_until, w.site_entry_suspension_reason
    INTO _w
    FROM public.workers w
   WHERE w.id = _worker_id
     AND w.project_id = _project_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'WORKER_NOT_FOUND');
  END IF;

  IF COALESCE(_w.is_active, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('error', 'WORKER_INACTIVE');
  END IF;

  IF NOT public.is_master(_uid) THEN
    IF public.normalize_phone_digits(_w.phone) IS DISTINCT FROM _digits THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN', 'message', '본인 근로자 기록만 처리할 수 있습니다.');
    END IF;
    IF NOT public.is_project_member(_uid, _project_id) THEN
      RETURN jsonb_build_object('error', 'NOT_PROJECT_MEMBER');
    END IF;
  END IF;

  IF _action = 'entry' THEN
    IF _w.site_entry_suspended_until IS NOT NULL AND _w.site_entry_suspended_until > now() THEN
      RETURN jsonb_build_object(
        'error', 'SUSPENDED',
        'until', _w.site_entry_suspended_until,
        'reason', _w.site_entry_suspension_reason
      );
    END IF;

    SELECT id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed
      INTO _log
      FROM public.worker_entry_logs
     WHERE worker_id = _worker_id
       AND project_id = _project_id
       AND exit_at IS NULL
       AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
     ORDER BY entry_at DESC
     LIMIT 1;

    IF FOUND THEN
      PERFORM public.upsert_worker_last_position_from_checkin(
        _worker_id, _project_id, _w.company_id, _lat, _lng, _accuracy
      );
      RETURN jsonb_build_object(
        'success', true,
        'action', 'entry',
        'already', true,
        'log', jsonb_build_object(
          'id', _log.id,
          'entry_at', _log.entry_at,
          'exit_at', _log.exit_at,
          'tbm_confirmed', _log.tbm_confirmed,
          'no_accident_confirmed', _log.no_accident_confirmed
        )
      );
    END IF;

    INSERT INTO public.worker_entry_logs (
      worker_id, project_id, entry_at, entry_method,
      tbm_confirmed, no_accident_confirmed,
      risk_assessment_confirmed, education_confirmed
    ) VALUES (
      _worker_id, _project_id, now(), 'gps',
      false, false, false, false
    ) RETURNING id INTO _new_id;

    PERFORM public.upsert_worker_last_position_from_checkin(
      _worker_id, _project_id, _w.company_id, _lat, _lng, _accuracy
    );

    SELECT id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed
      INTO _log
      FROM public.worker_entry_logs
     WHERE id = _new_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'entry',
      'already', false,
      'log', jsonb_build_object(
        'id', _log.id,
        'entry_at', _log.entry_at,
        'exit_at', _log.exit_at,
        'tbm_confirmed', _log.tbm_confirmed,
        'no_accident_confirmed', _log.no_accident_confirmed
      ),
      'gps', CASE WHEN _lat IS NULL THEN NULL ELSE jsonb_build_object(
        'lat', _lat, 'lng', _lng, 'accuracy', _accuracy
      ) END
    );
  END IF;

  SELECT id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed
    INTO _log
    FROM public.worker_entry_logs
   WHERE worker_id = _worker_id
     AND project_id = _project_id
     AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
   ORDER BY entry_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NO_ENTRY', 'message', '오늘 출근 기록이 없습니다.');
  END IF;

  IF _action = 'ack' THEN
    IF _log.exit_at IS NOT NULL THEN
      RETURN jsonb_build_object('error', 'ALREADY_EXITED');
    END IF;

    UPDATE public.worker_entry_logs
       SET tbm_confirmed = true,
           risk_assessment_confirmed = true
     WHERE id = _log.id
    RETURNING id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed INTO _log;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'ack',
      'log', jsonb_build_object(
        'id', _log.id,
        'entry_at', _log.entry_at,
        'exit_at', _log.exit_at,
        'tbm_confirmed', _log.tbm_confirmed,
        'no_accident_confirmed', _log.no_accident_confirmed
      )
    );
  END IF;

  IF _log.exit_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'exit',
      'already', true,
      'log', jsonb_build_object(
        'id', _log.id,
        'entry_at', _log.entry_at,
        'exit_at', _log.exit_at,
        'tbm_confirmed', _log.tbm_confirmed,
        'no_accident_confirmed', _log.no_accident_confirmed
      )
    );
  END IF;

  UPDATE public.worker_entry_logs
     SET exit_at = now(),
         no_accident_confirmed = true,
         exit_signature_data = CASE
           WHEN _signature IS NOT NULL AND length(_signature) >= 100 THEN _signature
           ELSE exit_signature_data
         END
   WHERE id = _log.id
  RETURNING id, entry_at, exit_at, tbm_confirmed, no_accident_confirmed INTO _log;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'exit',
    'already', false,
    'log', jsonb_build_object(
      'id', _log.id,
      'entry_at', _log.entry_at,
      'exit_at', _log.exit_at,
      'tbm_confirmed', _log.tbm_confirmed,
      'no_accident_confirmed', _log.no_accident_confirmed
    )
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision, text)
  IS 'Authenticated worker GPS check-in / daily ack / check-out. Entry seeds worker_last_positions when lat/lng are present.';
