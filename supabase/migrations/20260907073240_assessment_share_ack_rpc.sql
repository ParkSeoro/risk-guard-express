CREATE OR REPLACE FUNCTION public.ack_assessment_run_share(
  _run_id uuid,
  _signature_data text,
  _worker_id uuid DEFAULT NULL,
  _source text DEFAULT 'notice'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _run public.assessment_runs%ROWTYPE;
  _worker public.workers%ROWTYPE;
  _name text;
  _company_id uuid;
  _company_name text;
  _src text;
  _existing uuid;
  _notice_id uuid;
  _user_companies uuid[];
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF _run_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGS');
  END IF;
  IF _signature_data IS NULL OR length(_signature_data) < 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNATURE_REQUIRED');
  END IF;
  IF _signature_data !~ '^data:image/(png|jpeg|jpg|webp);base64,' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNATURE_INVALID');
  END IF;

  _src := COALESCE(NULLIF(btrim(_source), ''), 'notice');
  IF _src NOT IN ('notice', 'daily_ack', 'viewer') THEN
    _src := 'notice';
  END IF;

  SELECT * INTO _run FROM public.assessment_runs WHERE id = _run_id LIMIT 1;
  IF NOT FOUND OR COALESCE(_run.is_deleted, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RUN_NOT_FOUND');
  END IF;
  IF _run.status IS DISTINCT FROM '승인완료' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_APPROVED');
  END IF;

  IF NOT public.is_master(_uid) AND NOT EXISTS (
    SELECT 1 FROM public.project_members pm
     WHERE pm.user_id = _uid AND pm.project_id = _run.project_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  _user_companies := public.user_company_ids_for_project(_uid, _run.project_id);
  IF NOT public.is_master(_uid)
     AND NOT public.assessment_run_applies_to_companies(_run.target_company_ids, _user_companies) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WRONG_COMPANY');
  END IF;

  SELECT * INTO _worker
    FROM public.workers
   WHERE _worker_id IS NOT NULL AND id = _worker_id
   LIMIT 1;

  IF _worker.id IS NULL THEN
    SELECT w.* INTO _worker
      FROM public.workers w
      JOIN public.profiles p ON p.user_id = _uid
     WHERE w.project_id = _run.project_id
       AND COALESCE(w.is_active, true) = true
       AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
       AND public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(COALESCE(p.phone, ''))
     LIMIT 1;
  ELSIF _worker.project_id IS DISTINCT FROM _run.project_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WORKER_PROJECT_MISMATCH');
  END IF;

  SELECT a.id INTO _existing
    FROM public.assessment_run_share_acks a
   WHERE a.run_id = _run_id
     AND (
       a.user_id = _uid
       OR (_worker.id IS NOT NULL AND a.worker_id = _worker.id)
     )
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'id', _existing);
  END IF;

  SELECT COALESCE(NULLIF(display_name, ''), '사용자') INTO _name
    FROM public.profiles WHERE user_id = _uid LIMIT 1;
  IF _worker.id IS NOT NULL THEN
    _name := COALESCE(NULLIF(_worker.name, ''), _name);
    _company_id := _worker.company_id;
    _company_name := NULLIF(_worker.company_name, '');
  END IF;
  IF _company_id IS NULL THEN
    SELECT pm.company_id INTO _company_id
      FROM public.project_members pm
     WHERE pm.user_id = _uid AND pm.project_id = _run.project_id
       AND pm.company_id IS NOT NULL
     LIMIT 1;
  END IF;
  IF _company_name IS NULL AND _company_id IS NOT NULL THEN
    SELECT c.name INTO _company_name FROM public.companies c WHERE c.id = _company_id LIMIT 1;
  END IF;
  IF _company_name IS NULL THEN
    SELECT NULLIF(company, '') INTO _company_name FROM public.profiles WHERE user_id = _uid LIMIT 1;
  END IF;

  BEGIN
    INSERT INTO public.assessment_run_share_acks (
      run_id, project_id, user_id, worker_id, worker_name,
      company_id, company_name, signature_data, source
    ) VALUES (
      _run_id, _run.project_id, _uid, _worker.id, _name,
      _company_id, _company_name, _signature_data, _src
    )
    RETURNING id INTO _existing;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO _existing
      FROM public.assessment_run_share_acks
     WHERE run_id = _run_id
       AND (user_id = _uid OR (_worker.id IS NOT NULL AND worker_id = _worker.id))
     LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'already', true, 'id', _existing);
  END;

  SELECT id INTO _notice_id FROM public.assessment_notices WHERE run_id = _run_id LIMIT 1;
  IF _notice_id IS NOT NULL AND _worker.id IS NOT NULL THEN
    UPDATE public.assessment_notices
       SET acknowledged_worker_ids = ARRAY(
             SELECT DISTINCT x FROM unnest(
               COALESCE(acknowledged_worker_ids, ARRAY[]::uuid[]) || ARRAY[_worker.id]
             ) AS x
           ),
           updated_at = now()
     WHERE id = _notice_id
       AND NOT (_worker.id = ANY (COALESCE(acknowledged_worker_ids, ARRAY[]::uuid[])));
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'id', _existing);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ack_assessment_run_share(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_assessment_run_share(uuid, text, uuid, text) TO authenticated, service_role;
