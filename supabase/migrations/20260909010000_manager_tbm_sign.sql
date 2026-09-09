-- Manager TBM confirm+sign (시공사 이하) and morning reminder.
-- 발주처(client / OWNER_*) is excluded. Signing writes tbm_participations with now().

CREATE OR REPLACE FUNCTION public.synthetic_manager_phone(_user_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '020' || lpad((
    ('x' || substr(replace(_user_id::text, '-', ''), 1, 8))::bit(32)::bigint % 100000000
  )::text, 8, '0');
$$;

REVOKE ALL ON FUNCTION public.synthetic_manager_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.synthetic_manager_phone(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_manager_tbm_sign_eligible(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    LEFT JOIN public.companies c ON c.id = pm.company_id
    WHERE pm.user_id = _user_id
      AND pm.project_id = _project_id
      AND pm.role_new IN (
        'project_admin'::public.project_role,
        'safety_manager'::public.project_role,
        'site_manager'::public.project_role,
        'supervisor'::public.project_role,
        'site_supervisor'::public.project_role
      )
      AND COALESCE(pm.position_new::text, '') NOT IN (
        'OWNER_PM', 'OWNER_CM', 'OWNER_SM', 'OWNER_HSE'
      )
      AND lower(COALESCE(c.type, '')) NOT IN (
        'client', 'owner', '발주', '발주사', '발주처'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_manager_tbm_sign_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_manager_tbm_sign_eligible(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manager_tbm_signed_by_user(_session_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tbm_participations p
    WHERE p.tbm_session_id = _session_id
      AND length(trim(COALESCE(p.signature_data, ''))) >= 50
      AND (
        (
          public.normalize_phone_digits(p.worker_phone) <> ''
          AND public.normalize_phone_digits(p.worker_phone) = public.normalize_phone_digits((
            SELECT pr.phone FROM public.profiles pr WHERE pr.user_id = _user_id LIMIT 1
          ))
        )
        OR public.normalize_phone_digits(p.worker_phone)
             = public.normalize_phone_digits(public.synthetic_manager_phone(_user_id))
      )
  );
$$;

REVOKE ALL ON FUNCTION public.manager_tbm_signed_by_user(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_tbm_signed_by_user(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_manager_tbm_worker(_project_id uuid, _user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_name text;
  v_profile_phone text;
  v_digits text;
  v_synth text;
  v_phone text;
  v_company_id uuid;
  v_company_name text;
  v_role text;
  v_worker_id uuid;
BEGIN
  SELECT display_name, phone INTO v_name, v_profile_phone
    FROM public.profiles WHERE user_id = _user_id LIMIT 1;

  SELECT pm.company_id, pm.role_new::text
    INTO v_company_id, v_role
    FROM public.project_members pm
   WHERE pm.user_id = _user_id AND pm.project_id = _project_id
   ORDER BY CASE WHEN pm.role_new IN (
     'project_admin'::public.project_role,
     'safety_manager'::public.project_role,
     'site_manager'::public.project_role,
     'supervisor'::public.project_role,
     'site_supervisor'::public.project_role
   ) THEN 0 ELSE 1 END
   LIMIT 1;

  SELECT name INTO v_company_name FROM public.companies WHERE id = v_company_id;

  v_digits := COALESCE(public.normalize_phone_digits(v_profile_phone), '');
  v_synth := public.synthetic_manager_phone(_user_id);
  v_phone := COALESCE(NULLIF(v_digits, ''), v_synth);

  SELECT w.id INTO v_worker_id
    FROM public.workers w
   WHERE w.project_id = _project_id
     AND (
       (v_digits <> '' AND public.normalize_phone_digits(w.phone) = v_digits)
       OR public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(v_synth)
       OR w.phone = v_synth
     )
   ORDER BY CASE
     WHEN v_digits <> '' AND public.normalize_phone_digits(w.phone) = v_digits THEN 0
     ELSE 1
   END
   LIMIT 1;

  IF v_worker_id IS NOT NULL THEN
    RETURN v_worker_id;
  END IF;

  BEGIN
    INSERT INTO public.workers (
      project_id, name, phone, company_id, company_name, job_type, is_active, hire_date
    ) VALUES (
      _project_id,
      COALESCE(NULLIF(trim(v_name), ''), '관리자'),
      v_phone,
      v_company_id,
      COALESCE(v_company_name, ''),
      CASE WHEN v_role = 'safety_manager' THEN '안전관리자' ELSE '관리감독자' END,
      true,
      (now() AT TIME ZONE 'Asia/Seoul')::date
    )
    RETURNING id INTO v_worker_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT w.id INTO v_worker_id
      FROM public.workers w
     WHERE w.project_id = _project_id
       AND (
         public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(v_phone)
         OR w.phone = v_phone
       )
     LIMIT 1;
  END;

  RETURN v_worker_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_manager_tbm_worker(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_manager_tbm_worker(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_my_pending_tbm_signs()
RETURNS TABLE (
  session_id uuid,
  project_id uuid,
  project_name text,
  title text,
  tbm_date date,
  location text,
  leader_name text,
  briefing_summary text,
  briefing_risks jsonb,
  company_name text,
  qr_token text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.project_id,
    pr.name,
    s.title,
    s.tbm_date,
    s.location,
    s.leader_name,
    s.briefing_summary,
    s.briefing_risks::jsonb,
    s.company_name,
    s.qr_token
  FROM public.tbm_sessions s
  JOIN public.projects pr ON pr.id = s.project_id
  WHERE s.tbm_date = v_today
    AND COALESCE(s.is_deleted, false) = false
    AND public.is_manager_tbm_sign_eligible(v_uid, s.project_id)
    AND NOT public.manager_tbm_signed_by_user(s.id, v_uid)
  ORDER BY s.created_at;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_my_pending_tbm_signs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_tbm_signs() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manager_sign_tbm_participation(
  _tbm_session_id uuid,
  _signature_data text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.tbm_sessions%ROWTYPE;
  v_worker_id uuid;
  v_worker public.workers%ROWTYPE;
  v_existing uuid;
  v_phone text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;
  IF _tbm_session_id IS NULL THEN
    RETURN jsonb_build_object('error', 'INVALID_ARGS');
  END IF;
  IF _signature_data IS NULL OR length(_signature_data) < 100 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED');
  END IF;

  SELECT * INTO v_session FROM public.tbm_sessions WHERE id = _tbm_session_id LIMIT 1;
  IF NOT FOUND OR COALESCE(v_session.is_deleted, false) THEN
    RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
  END IF;

  IF NOT public.is_manager_tbm_sign_eligible(v_uid, v_session.project_id) THEN
    IF EXISTS (
      SELECT 1
      FROM public.project_members pm
      LEFT JOIN public.companies c ON c.id = pm.company_id
      WHERE pm.user_id = v_uid
        AND pm.project_id = v_session.project_id
        AND (
          COALESCE(pm.position_new::text, '') IN ('OWNER_PM', 'OWNER_CM', 'OWNER_SM', 'OWNER_HSE')
          OR lower(COALESCE(c.type, '')) IN ('client', 'owner', '발주', '발주사', '발주처')
        )
    ) THEN
      RETURN jsonb_build_object('error', 'OWNER_NOT_REQUIRED');
    END IF;
    RETURN jsonb_build_object('error', 'NOT_ELIGIBLE');
  END IF;

  IF public.manager_tbm_signed_by_user(_tbm_session_id, v_uid) THEN
    RETURN jsonb_build_object('error', 'ALREADY_SIGNED', 'success', true);
  END IF;

  v_worker_id := public.resolve_manager_tbm_worker(v_session.project_id, v_uid);
  IF v_worker_id IS NULL THEN
    RETURN jsonb_build_object('error', 'WORKER_RESOLVE_FAILED');
  END IF;

  SELECT * INTO v_worker FROM public.workers WHERE id = v_worker_id LIMIT 1;
  v_phone := COALESCE(NULLIF(trim(v_worker.phone), ''), public.synthetic_manager_phone(v_uid));

  SELECT p.id INTO v_existing
    FROM public.tbm_participations p
   WHERE p.tbm_session_id = _tbm_session_id
     AND (
       p.worker_id = v_worker_id
       OR public.normalize_phone_digits(p.worker_phone) = public.normalize_phone_digits(v_phone)
     )
   ORDER BY CASE WHEN length(trim(COALESCE(p.signature_data, ''))) >= 50 THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.tbm_participations
       SET worker_id = v_worker_id,
           worker_name = COALESCE(NULLIF(trim(v_worker.name), ''), worker_name),
           worker_phone = COALESCE(NULLIF(v_phone, ''), worker_phone),
           company_name = COALESCE(NULLIF(trim(v_worker.company_name), ''), company_name),
           briefing_confirmed = true,
           signature_data = _signature_data,
           participated_at = now()
     WHERE id = v_existing;
  ELSE
    BEGIN
      INSERT INTO public.tbm_participations (
        tbm_session_id, worker_id, worker_name, worker_phone, company_name,
        briefing_confirmed, signature_data, participated_at
      ) VALUES (
        _tbm_session_id, v_worker_id,
        COALESCE(NULLIF(trim(v_worker.name), ''), '관리자'),
        v_phone,
        COALESCE(v_worker.company_name, ''),
        true, _signature_data, now()
      );
    EXCEPTION WHEN unique_violation THEN
      UPDATE public.tbm_participations
         SET worker_id = COALESCE(v_worker_id, worker_id),
             worker_name = COALESCE(NULLIF(trim(v_worker.name), ''), worker_name),
             company_name = COALESCE(NULLIF(trim(v_worker.company_name), ''), company_name),
             briefing_confirmed = true,
             signature_data = _signature_data,
             participated_at = now()
       WHERE tbm_session_id = _tbm_session_id
         AND (
           worker_id = v_worker_id
           OR public.normalize_phone_digits(worker_phone) = public.normalize_phone_digits(v_phone)
         );
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'worker_id', v_worker_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.manager_sign_tbm_participation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_sign_tbm_participation(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.notify_manager_tbm_sign_due()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_today_start timestamptz := (v_today::timestamp AT TIME ZONE 'Asia/Seoul');
  v_count int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT
      pm.user_id,
      s.id AS session_id,
      s.project_id,
      s.title,
      pr.name AS project_name
    FROM public.tbm_sessions s
    JOIN public.projects pr ON pr.id = s.project_id
    JOIN public.project_members pm ON pm.project_id = s.project_id
    LEFT JOIN public.companies c ON c.id = pm.company_id
    WHERE s.tbm_date = v_today
      AND COALESCE(s.is_deleted, false) = false
      AND pm.role_new IN (
        'project_admin'::public.project_role,
        'safety_manager'::public.project_role,
        'site_manager'::public.project_role,
        'supervisor'::public.project_role,
        'site_supervisor'::public.project_role
      )
      AND COALESCE(pm.position_new::text, '') NOT IN (
        'OWNER_PM', 'OWNER_CM', 'OWNER_SM', 'OWNER_HSE'
      )
      AND lower(COALESCE(c.type, '')) NOT IN (
        'client', 'owner', '발주', '발주사', '발주처'
      )
      AND NOT public.manager_tbm_signed_by_user(s.id, pm.user_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = pm.user_id
          AND n.type = 'tbm_sign_due'
          AND n.related_id = s.id
          AND n.created_at >= v_today_start
      )
  LOOP
    INSERT INTO public.notifications (
      user_id, type, title, message, related_type, related_id, project_id, link
    ) VALUES (
      r.user_id,
      'tbm_sign_due',
      '오늘 TBM 확인·서명',
      '[' || COALESCE(r.project_name, '현장') || '] '
        || COALESCE(NULLIF(trim(r.title), ''), 'TBM')
        || ' — 앱에서 브리핑을 확인하고 서명해 주세요.',
      'tbm_session',
      r.session_id,
      r.project_id,
      '/app/worker/tbm-sign?session=' || r.session_id::text
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_manager_tbm_sign_due() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_manager_tbm_sign_due() TO service_role;

CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  _is_mandatory boolean;
  _now_t time := (now() AT TIME ZONE 'Asia/Seoul')::time;
BEGIN
  _is_mandatory := _type IN (
    'incident','approval_request','approval_result','critical_alert',
    'danger_zone_entry','emergency_drill','work_stop','announcement',
    'assessment_share','tbm_sign_due'
  );

  SELECT * INTO p FROM public.notification_preferences WHERE user_id = _user_id;
  IF p IS NULL THEN RETURN true; END IF;
  IF NOT _is_mandatory AND COALESCE(p.channel_push, true) = false THEN RETURN false; END IF;

  IF NOT _is_mandatory AND p.push_quiet_start IS NOT NULL AND p.push_quiet_end IS NOT NULL THEN
    IF p.push_quiet_start < p.push_quiet_end THEN
      IF _now_t >= p.push_quiet_start AND _now_t < p.push_quiet_end THEN RETURN false; END IF;
    ELSE
      IF _now_t >= p.push_quiet_start OR _now_t < p.push_quiet_end THEN RETURN false; END IF;
    END IF;
  END IF;

  RETURN CASE _type
    WHEN 'approval_request'    THEN true
    WHEN 'approval_result'     THEN true
    WHEN 'danger_zone_entry'   THEN true
    WHEN 'announcement'        THEN true
    WHEN 'assessment_share'    THEN true
    WHEN 'tbm_sign_due'        THEN true
    WHEN 'return_request'      THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'   THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'         THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                 THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'      THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due'  THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident'            THEN true
    WHEN 'todo_due'            THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'   THEN COALESCE(p.event_assessment_result, true)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$function$;
