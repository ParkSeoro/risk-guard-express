-- GPS daily check-in/ack/exit for authenticated workers.
-- worker_entry_logs blocks client INSERT (wel_no_client_insert); mutations go through this RPC.

CREATE OR REPLACE FUNCTION public.worker_gps_daily_lifecycle(
  _action text,
  _worker_id uuid,
  _project_id uuid,
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _accuracy double precision DEFAULT NULL
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

  SELECT w.id, w.project_id, w.phone, w.is_active,
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

  -- Own worker (phone match) or master; must also be project member unless master
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

  -- ack / exit need today's open log
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

  -- exit
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
         no_accident_confirmed = true
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

REVOKE ALL ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision)
  IS 'Authenticated worker GPS check-in / daily ack / check-out (SECURITY DEFINER; bypasses wel_no_client_insert).';
