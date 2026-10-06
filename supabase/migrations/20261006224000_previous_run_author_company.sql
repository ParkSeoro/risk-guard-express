-- Previous rounds follow the writing company's membership.
-- Several people at that company share one list.
-- Target-company tags do not join or split it.

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
  SELECT public.assessment_run_author_company_id(_a) IS NOT NULL
     AND public.assessment_run_author_company_id(_a)
         = public.assessment_run_author_company_id(_b);
$fn$;

REVOKE ALL ON FUNCTION public.assessment_run_author_company_id(public.assessment_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assessment_runs_same_company(public.assessment_runs, public.assessment_runs) FROM PUBLIC, anon, authenticated;
