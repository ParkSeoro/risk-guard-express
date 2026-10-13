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
