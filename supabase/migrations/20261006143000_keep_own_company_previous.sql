-- Keep a previous assessment when it is the same company, even if the
-- target-company tag differs. A chain lookup must not drop that link.
-- Another company's document still does not attach.

CREATE OR REPLACE FUNCTION public.assessment_run_author_company_id(_run public.assessment_runs)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT pm.company_id
    FROM public.project_members pm
   WHERE pm.project_id = _run.project_id
     AND pm.user_id = COALESCE(_run.author_user_id, _run.created_by)
     AND pm.company_id IS NOT NULL
   ORDER BY public.project_member_role_rank(pm.role_new::text) DESC,
            pm.created_at ASC,
            pm.company_id
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.assessment_runs_same_company(
  _a public.assessment_runs,
  _b public.assessment_runs
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT public.assessment_company_ids_overlap(
           public.assessment_run_effective_company_ids(_a),
           public.assessment_run_effective_company_ids(_b)
         )
      OR (
           public.assessment_run_author_company_id(_a) IS NOT NULL
           AND public.assessment_run_author_company_id(_a)
               = public.assessment_run_author_company_id(_b)
         );
$fn$;

CREATE OR REPLACE FUNCTION public.pick_previous_approved_assessment_run_pool(
  _current public.assessment_runs,
  _same_type_only boolean
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH current_start AS (
    SELECT NULLIF(btrim(left(_current.start_date::text, 10)), '') AS start_key
  ),
  cand AS (
    SELECT
      ar.id,
      ar.created_at,
      COALESCE(
        NULLIF(btrim(left(ar.start_date::text, 10)), ''),
        to_char(ar.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ) AS period_key
    FROM public.assessment_runs ar
    WHERE ar.project_id = _current.project_id
      AND ar.id <> _current.id
      AND COALESCE(ar.is_deleted, false) = false
      AND ar.status = '승인완료'
      AND (
        NOT _same_type_only
        OR (
          NULLIF(btrim(COALESCE(_current.type, '')), '') IS NOT NULL
          AND ar.type IS NOT DISTINCT FROM _current.type
        )
      )
      AND public.assessment_runs_same_company(_current, ar)
  ),
  before_start AS (
    SELECT c.id, c.created_at, c.period_key
      FROM cand c
      CROSS JOIN current_start s
     WHERE s.start_key IS NOT NULL
       AND c.period_key IS NOT NULL
       AND c.period_key < s.start_key
  ),
  pool AS (
    SELECT * FROM before_start
    UNION ALL
    SELECT c.id, c.created_at, c.period_key
      FROM cand c
     WHERE NOT EXISTS (SELECT 1 FROM before_start)
       AND c.created_at < _current.created_at
  )
  SELECT p.id
    FROM pool p
   ORDER BY p.period_key DESC NULLS LAST, p.created_at DESC
   LIMIT 1;
$fn$;

-- A saved previous_run_id stays when it is the same company.
-- A different company is not used. The column itself is not cleared.
CREATE OR REPLACE FUNCTION public.resolve_assessment_previous_run(
  _current public.assessment_runs,
  _override uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _hint uuid;
  _prev public.assessment_runs;
BEGIN
  _hint := COALESCE(_override, _current.previous_run_id);
  IF _hint IS NOT NULL AND _hint <> _current.id THEN
    SELECT * INTO _prev
      FROM public.assessment_runs
     WHERE id = _hint;
    IF FOUND
       AND _prev.project_id = _current.project_id
       AND COALESCE(_prev.is_deleted, false) = false
       AND _prev.status IN ('승인완료', '결재진행')
       AND public.assessment_runs_same_company(_current, _prev)
    THEN
      RETURN _prev.id;
    END IF;
  END IF;
  RETURN public.pick_previous_approved_assessment_run(_current);
END;
$fn$;

REVOKE ALL ON FUNCTION public.assessment_run_author_company_id(public.assessment_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assessment_runs_same_company(public.assessment_runs, public.assessment_runs) FROM PUBLIC, anon, authenticated;
