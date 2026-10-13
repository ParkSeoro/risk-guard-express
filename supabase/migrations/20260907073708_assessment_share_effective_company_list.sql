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
  SELECT
    ar.id,
    ar.project_id,
    ar.period_label,
    ar.type,
    ar.status,
    ar.start_date,
    ar.end_date,
    public.assessment_share_summary(ar.id),
    an.id
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
      SELECT 1 FROM public.assessment_run_share_acks a
       WHERE a.run_id = ar.id
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
  ORDER BY ar.start_date DESC NULLS LAST, ar.created_at DESC;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_company_period_assessment_run_ids(
  _project_id uuid,
  _company_id uuid,
  _day date DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date)
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _ids uuid[];
  _latest uuid;
BEGIN
  IF _project_id IS NULL OR _company_id IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;

  SELECT array_agg(ar.id) INTO _ids
    FROM public.assessment_runs ar
   WHERE ar.project_id = _project_id
     AND ar.status = '승인완료'
     AND COALESCE(ar.is_deleted, false) = false
     AND public.assessment_run_applies_to_companies(
           public.assessment_run_effective_company_ids(ar),
           ARRAY[_company_id]
         )
     AND (ar.start_date IS NULL OR ar.start_date <= _day)
     AND (ar.end_date IS NULL OR ar.end_date >= _day);

  IF COALESCE(array_length(_ids, 1), 0) > 0 THEN
    RETURN _ids;
  END IF;

  SELECT ar.id INTO _latest
    FROM public.assessment_runs ar
   WHERE ar.project_id = _project_id
     AND ar.status = '승인완료'
     AND COALESCE(ar.is_deleted, false) = false
     AND public.assessment_run_applies_to_companies(
           public.assessment_run_effective_company_ids(ar),
           ARRAY[_company_id]
         )
   ORDER BY ar.start_date DESC NULLS LAST, ar.created_at DESC
   LIMIT 1;

  IF _latest IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  RETURN ARRAY[_latest];
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_company_period_assessment_run_ids(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_company_period_assessment_run_ids(uuid, uuid, date) TO authenticated, service_role;
