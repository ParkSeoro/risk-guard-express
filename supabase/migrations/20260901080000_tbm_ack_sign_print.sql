-- Daily ack / crew sync could not write tbm_participations (RLS had SELECT+DELETE only).
-- GPS exit discarded the signature pad. Workers could not see their own TBM row.

-- 1) Manager INSERT/UPDATE for unsigned crew sync; worker INSERT/UPDATE/SELECT for own phone.

DROP POLICY IF EXISTS "Managers can insert tbm_participations" ON public.tbm_participations;
CREATE POLICY "Managers can insert tbm_participations"
ON public.tbm_participations
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND (
        public.is_master(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.user_id = auth.uid()
            AND pm.project_id = s.project_id
            AND pm.role_new IN (
              'project_admin'::public.project_role,
              'safety_manager'::public.project_role,
              'site_manager'::public.project_role,
              'site_supervisor'::public.project_role,
              'supervisor'::public.project_role
            )
        )
      )
  )
);

DROP POLICY IF EXISTS "Managers can update tbm_participations" ON public.tbm_participations;
CREATE POLICY "Managers can update tbm_participations"
ON public.tbm_participations
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND (
        public.is_master(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.user_id = auth.uid()
            AND pm.project_id = s.project_id
            AND pm.role_new IN (
              'project_admin'::public.project_role,
              'safety_manager'::public.project_role,
              'site_manager'::public.project_role,
              'site_supervisor'::public.project_role,
              'supervisor'::public.project_role
            )
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND (
        public.is_master(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.project_members pm
          WHERE pm.user_id = auth.uid()
            AND pm.project_id = s.project_id
            AND pm.role_new IN (
              'project_admin'::public.project_role,
              'safety_manager'::public.project_role,
              'site_manager'::public.project_role,
              'site_supervisor'::public.project_role,
              'supervisor'::public.project_role
            )
        )
      )
  )
);

DROP POLICY IF EXISTS "Workers can view own tbm_participations" ON public.tbm_participations;
CREATE POLICY "Workers can view own tbm_participations"
ON public.tbm_participations
FOR SELECT
TO authenticated
USING (
  public.normalize_phone_digits(tbm_participations.worker_phone) <> ''
  AND public.normalize_phone_digits(tbm_participations.worker_phone) = (
    SELECT public.normalize_phone_digits(p.phone)
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
    LIMIT 1
  )
);

-- 2) SECURITY DEFINER: copy daily-ack signature onto linked TBM rows.

CREATE OR REPLACE FUNCTION public.upsert_tbm_participation_from_ack(
  _tbm_session_id uuid,
  _worker_id uuid,
  _signature_data text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _digits text;
  _w record;
  _s record;
  _existing uuid;
  _phone text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;
  IF _tbm_session_id IS NULL OR _worker_id IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ARGS');
  END IF;
  IF _signature_data IS NULL OR length(_signature_data) < 100 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED');
  END IF;

  SELECT * INTO _s FROM public.tbm_sessions WHERE id = _tbm_session_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
  END IF;

  SELECT id, project_id, name, phone, company_name, is_active
    INTO _w
    FROM public.workers
   WHERE id = _worker_id
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'WORKER_NOT_FOUND');
  END IF;

  SELECT public.normalize_phone_digits(phone) INTO _digits
    FROM public.profiles WHERE user_id = _uid LIMIT 1;

  IF NOT public.is_master(_uid) THEN
    IF COALESCE(_digits, '') = '' THEN
      RETURN jsonb_build_object('error', 'PHONE_REQUIRED');
    END IF;
    IF public.normalize_phone_digits(_w.phone) IS DISTINCT FROM _digits THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN', 'message', '본인 근로자 기록만 처리할 수 있습니다.');
    END IF;
    IF NOT public.is_project_member(_uid, _s.project_id) THEN
      RETURN jsonb_build_object('error', 'NOT_PROJECT_MEMBER');
    END IF;
  END IF;

  _phone := COALESCE(NULLIF(trim(_w.phone), ''), '');
  IF _phone = '' THEN
    RETURN jsonb_build_object('error', 'WORKER_PHONE_REQUIRED', 'message', '근로자 전화번호가 없어 TBM 서명에 반영할 수 없습니다.');
  END IF;

  SELECT id INTO _existing
    FROM public.tbm_participations
   WHERE tbm_session_id = _tbm_session_id
     AND (
       worker_id = _worker_id
       OR public.normalize_phone_digits(worker_phone) = public.normalize_phone_digits(_phone)
     )
   ORDER BY CASE WHEN length(coalesce(signature_data, '')) > 100 THEN 0 ELSE 1 END
   LIMIT 1;

  IF _existing IS NOT NULL THEN
    UPDATE public.tbm_participations
       SET worker_id = _worker_id,
           worker_name = COALESCE(NULLIF(trim(_w.name), ''), worker_name),
           worker_phone = _phone,
           company_name = COALESCE(NULLIF(trim(_w.company_name), ''), company_name),
           briefing_confirmed = true,
           signature_data = _signature_data,
           participated_at = now()
     WHERE id = _existing;
  ELSE
    INSERT INTO public.tbm_participations (
      tbm_session_id, worker_id, worker_name, worker_phone, company_name,
      briefing_confirmed, signature_data
    ) VALUES (
      _tbm_session_id, _worker_id,
      COALESCE(NULLIF(trim(_w.name), ''), '근로자'),
      _phone,
      COALESCE(_w.company_name, ''),
      true, _signature_data
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_tbm_participation_from_ack(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_tbm_participation_from_ack(uuid, uuid, text) TO authenticated, service_role;

-- 3) Persist GPS checkout signature (column already exists).

DROP FUNCTION IF EXISTS public.worker_gps_daily_lifecycle(text, uuid, uuid, double precision, double precision, double precision);

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

  IF _signature IS NULL OR length(_signature) < 100 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED', 'message', '퇴근 서명이 필요합니다.');
  END IF;

  UPDATE public.worker_entry_logs
     SET exit_at = now(),
         no_accident_confirmed = true,
         exit_signature_data = _signature
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
  IS 'Authenticated worker GPS check-in / daily ack / check-out. Exit stores _signature on worker_entry_logs.exit_signature_data.';

-- 4) Heal existing daily-ack signatures that never reached TBM (RLS blocked client upsert).

INSERT INTO public.tbm_participations (
  tbm_session_id, worker_id, worker_name, worker_phone, company_name,
  briefing_confirmed, signature_data, participated_at
)
SELECT DISTINCT ON (p.tbm_session_id, public.normalize_phone_digits(COALESCE(w.phone, a.worker_phone)))
  p.tbm_session_id,
  a.worker_id,
  COALESCE(NULLIF(trim(a.worker_name), ''), COALESCE(w.name, '근로자')),
  COALESCE(NULLIF(trim(w.phone), ''), a.worker_phone),
  COALESCE(w.company_name, ''),
  true,
  a.signature_data,
  COALESCE(a.updated_at, a.created_at, now())
FROM public.worker_daily_acks a
JOIN public.work_permits p
  ON p.id = ANY (a.permit_ids)
 AND p.tbm_session_id IS NOT NULL
 AND COALESCE(p.is_deleted, false) = false
LEFT JOIN public.workers w ON w.id = a.worker_id
WHERE length(COALESCE(a.signature_data, '')) >= 100
  AND public.normalize_phone_digits(COALESCE(w.phone, a.worker_phone)) <> ''
ORDER BY p.tbm_session_id, public.normalize_phone_digits(COALESCE(w.phone, a.worker_phone)), a.updated_at DESC NULLS LAST
ON CONFLICT (tbm_session_id, worker_phone) DO UPDATE
SET signature_data = EXCLUDED.signature_data,
    briefing_confirmed = true,
    worker_id = COALESCE(EXCLUDED.worker_id, public.tbm_participations.worker_id),
    participated_at = COALESCE(public.tbm_participations.participated_at, EXCLUDED.participated_at)
WHERE length(COALESCE(public.tbm_participations.signature_data, '')) < 100;
