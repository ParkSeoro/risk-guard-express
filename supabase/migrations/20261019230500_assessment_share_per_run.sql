-- Share confirm is per assessment_run (document), not per week+type group.
-- Cloning / revising creates a new run that must collect its own signatures again.
-- Do not treat another run's share_acks as satisfying this run.

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
    ar.id AS run_id,
    ar.project_id,
    ar.period_label,
    ar.type,
    ar.status,
    ar.start_date,
    ar.end_date,
    public.assessment_share_summary(ar.id) AS summary,
    an.id AS notice_id
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
       WHERE a.run_id = ar.id
         AND (
           a.user_id = _uid
           OR (
             a.worker_id IS NOT NULL
             AND a.worker_id IN (
               SELECT w.id
                 FROM public.workers w
                 JOIN public.profiles p ON p.user_id = _uid
                WHERE w.project_id = ar.project_id
                  AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
                  AND public.normalize_phone_digits(w.phone)
                    = public.normalize_phone_digits(COALESCE(p.phone, ''))
             )
           )
         )
    )
  ORDER BY
    ar.start_date ASC NULLS LAST,
    CASE ar.type WHEN '상시' THEN 0 WHEN '수시' THEN 1 ELSE 2 END,
    ar.created_at DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_my_pending_assessment_shares(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_assessment_shares(uuid) TO authenticated, service_role;
