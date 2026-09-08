-- Share confirm follows the approval event: fan out that day, stamp that run.
-- Do not wait for start_date. Duplicate weekly copies still collapse to one prompt.

CREATE OR REPLACE FUNCTION public.notify_assessment_run_share(_run public.assessment_runs)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _n int := 0;
  _title text;
  _body text;
  _notice_id uuid;
  _summary text;
  _share_cos uuid[];
BEGIN
  IF _run.id IS NULL OR _run.status IS DISTINCT FROM '승인완료' THEN
    RETURN 0;
  END IF;

  _share_cos := public.assessment_run_effective_company_ids(_run);
  IF COALESCE(array_length(_share_cos, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  _summary := public.assessment_share_summary(_run.id);
  _title := COALESCE(NULLIF(_run.period_label, ''), '위험성평가') || ' 승인 · 결과 공유';
  _body := COALESCE(NULLIF(_run.period_label, ''), '위험성평가')
        || '가 승인되었습니다. 내용을 확인하고 서명해 주세요.'
        || E'\n\n' || _summary;

  SELECT id INTO _notice_id FROM public.assessment_notices WHERE run_id = _run.id LIMIT 1;
  IF _notice_id IS NULL THEN
    INSERT INTO public.assessment_notices (
      project_id, run_id, title, body, posted_at, created_by
    ) VALUES (
      _run.project_id, _run.id, _title, _body, now(), _run.created_by
    )
    RETURNING id INTO _notice_id;
  END IF;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT r.user_id, _run.project_id, 'assessment_share', _title, _body, _body,
         '/assessment-run/' || _run.id::text,
         'assessment_run', _run.id::text, 'high', false, now()
    FROM (
      SELECT pm.user_id
        FROM public.project_members pm
        JOIN public.profiles pr ON pr.user_id = pm.user_id
       WHERE pm.project_id = _run.project_id
         AND pm.user_id IS NOT NULL
         AND COALESCE(pr.account_status, 'active') = 'active'
         AND public.assessment_run_applies_to_companies(
               _share_cos,
               CASE WHEN pm.company_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[pm.company_id] END
             )
      UNION
      SELECT pr.user_id
        FROM public.workers w
        JOIN public.profiles pr
          ON public.normalize_phone_digits(COALESCE(pr.phone, '')) <> ''
         AND public.normalize_phone_digits(pr.phone) = public.normalize_phone_digits(w.phone)
       WHERE w.project_id = _run.project_id
         AND COALESCE(w.is_active, true) = true
         AND COALESCE(pr.account_status, 'active') = 'active'
         AND public.assessment_run_applies_to_companies(
               _share_cos,
               CASE WHEN w.company_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[w.company_id] END
             )
    ) r
   WHERE r.user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = r.user_id
          AND n.type = 'assessment_share'
          AND n.related_id = _run.id::text
          AND n.created_at > now() - interval '1 day'
     );

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_assessment_run_share(public.assessment_runs) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_assessment_run_share(public.assessment_runs) TO service_role;

CREATE OR REPLACE FUNCTION public.list_my_pending_assessment_shares(_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  run_id uuid,
  project_id uuid,
  period_label text,
  type text,
  status text,
  start_date date,
  end_date date,
  summary text,
  notice_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      ar.id AS e_run_id,
      ar.project_id AS e_project_id,
      ar.period_label AS e_period_label,
      ar.type AS e_type,
      ar.status AS e_status,
      ar.start_date AS e_start_date,
      ar.end_date AS e_end_date,
      public.assessment_share_summary(ar.id) AS e_summary,
      an.id AS e_notice_id,
      ar.created_at AS e_created_at
    FROM public.assessment_runs ar
    LEFT JOIN LATERAL (
      SELECT n.id
        FROM public.assessment_notices n
       WHERE n.run_id = ar.id
       ORDER BY n.posted_at DESC NULLS LAST
       LIMIT 1
    ) an ON true
    WHERE COALESCE(ar.is_deleted, false) = false
      AND ar.status = '승인완료'
      AND (_project_id IS NULL OR ar.project_id = _project_id)
      AND (
        (ar.end_date IS NOT NULL AND ar.end_date >= _today)
        OR (
          ar.end_date IS NULL
          AND COALESCE(ar.start_date, (ar.created_at AT TIME ZONE 'Asia/Seoul')::date)
            >= (_today - 21)
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.user_id = _uid AND pm.project_id = ar.project_id
      )
      AND public.assessment_run_applies_to_companies(
        public.assessment_run_effective_company_ids(ar),
        public.user_company_ids_for_project(_uid, ar.project_id)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.assessment_run_share_acks a
        JOIN public.assessment_runs sibling
          ON sibling.id = a.run_id
        WHERE sibling.project_id = ar.project_id
          AND sibling.type IS NOT DISTINCT FROM ar.type
          AND sibling.start_date IS NOT DISTINCT FROM ar.start_date
          AND COALESCE(sibling.is_deleted, false) = false
          AND (
            a.user_id = _uid
            OR (
              a.worker_id IS NOT NULL
              AND a.worker_id IN (
                SELECT w.id FROM public.workers w
                JOIN public.profiles p ON p.user_id = _uid
                 WHERE w.project_id = ar.project_id
                   AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
                   AND public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(COALESCE(p.phone, ''))
              )
            )
          )
      )
  ),
  ranked AS (
    SELECT
      e.*,
      row_number() OVER (
        PARTITION BY e.e_project_id, e.e_type, e.e_start_date
        ORDER BY e.e_created_at DESC, e.e_run_id DESC
      ) AS rn
    FROM eligible e
  )
  SELECT
    ranked.e_run_id,
    ranked.e_project_id,
    ranked.e_period_label,
    ranked.e_type,
    ranked.e_status,
    ranked.e_start_date,
    ranked.e_end_date,
    ranked.e_summary,
    ranked.e_notice_id
  FROM ranked
  WHERE ranked.rn = 1
  ORDER BY
    ranked.e_start_date ASC NULLS LAST,
    CASE ranked.e_type WHEN '상시' THEN 0 WHEN '수시' THEN 1 ELSE 2 END,
    ranked.e_created_at DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_my_pending_assessment_shares(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_assessment_shares(uuid) TO authenticated, service_role;

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
     AND NOT public.assessment_run_applies_to_companies(
       public.assessment_run_effective_company_ids(_run),
       _user_companies
     ) THEN
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
