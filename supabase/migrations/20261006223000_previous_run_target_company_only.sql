-- #529 treated the author's company as the same chain even when the
-- target-company tags differed. Same company is overlapping effective
-- target-company ids only. A blank tag is still the author's company.
-- Another company's document does not attach.

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
         );
$fn$;

REVOKE ALL ON FUNCTION public.assessment_runs_same_company(public.assessment_runs, public.assessment_runs) FROM PUBLIC, anon, authenticated;
