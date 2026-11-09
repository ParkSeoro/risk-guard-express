-- Weekly feedback follows the document's target company.
-- A GC author who writes several partner documents no longer joins those chains.
-- A blank target is still the author's company. Two blank lists are not the same company.
-- A saved previous_run_id that names another target company is ignored. The column stays.

CREATE OR REPLACE FUNCTION public.assessment_company_ids_equal(_a uuid[], _b uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH left_ids AS (
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) AS ids
      FROM unnest(COALESCE(_a, ARRAY[]::uuid[])) AS x
     WHERE x IS NOT NULL
  ),
  right_ids AS (
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) AS ids
      FROM unnest(COALESCE(_b, ARRAY[]::uuid[])) AS x
     WHERE x IS NOT NULL
  )
  SELECT COALESCE(array_length(l.ids, 1), 0) > 0
     AND l.ids = r.ids
    FROM left_ids l
    CROSS JOIN right_ids r;
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
  SELECT public.assessment_company_ids_equal(
           public.assessment_run_effective_company_ids(_a),
           public.assessment_run_effective_company_ids(_b)
         );
$fn$;

REVOKE ALL ON FUNCTION public.assessment_company_ids_equal(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assessment_runs_same_company(public.assessment_runs, public.assessment_runs) FROM PUBLIC, anon, authenticated;
