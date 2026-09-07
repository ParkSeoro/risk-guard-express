-- Prompt each person once per (project, type, start_date).
-- Hide runs that have not started yet, and treat sibling weekly copies as already signed.

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
      AND (ar.start_date IS NULL OR ar.start_date <= _today)
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
