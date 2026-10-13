CREATE OR REPLACE FUNCTION public.assessment_run_applies_to_companies(
  _target_company_ids uuid[],
  _user_company_ids uuid[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT
    COALESCE(array_length(_target_company_ids, 1), 0) > 0
    AND EXISTS (
      SELECT 1
        FROM unnest(_target_company_ids) t
       WHERE t = ANY (_user_company_ids)
    );
$fn$;

CREATE OR REPLACE FUNCTION public.assessment_run_effective_company_ids(_run public.assessment_runs)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN COALESCE(array_length(_run.target_company_ids, 1), 0) > 0 THEN _run.target_company_ids
    ELSE COALESCE(
      (
        SELECT ARRAY[pm.company_id]
          FROM public.project_members pm
         WHERE pm.project_id = _run.project_id
           AND pm.user_id = COALESCE(_run.author_user_id, _run.created_by)
           AND pm.company_id IS NOT NULL
         LIMIT 1
      ),
      ARRAY[]::uuid[]
    )
  END;
$fn$;
