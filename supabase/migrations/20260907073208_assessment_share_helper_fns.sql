CREATE OR REPLACE FUNCTION public.user_company_ids_for_project(_user_id uuid, _project_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT cid), ARRAY[]::uuid[])
  FROM (
    SELECT pm.company_id AS cid
      FROM public.project_members pm
     WHERE pm.user_id = _user_id
       AND pm.project_id = _project_id
       AND pm.company_id IS NOT NULL
    UNION
    SELECT w.company_id
      FROM public.workers w
      JOIN public.profiles p ON p.user_id = _user_id
     WHERE w.project_id = _project_id
       AND COALESCE(w.is_active, true) = true
       AND w.company_id IS NOT NULL
       AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
       AND public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(COALESCE(p.phone, ''))
  ) s;
$fn$;

REVOKE ALL ON FUNCTION public.user_company_ids_for_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_company_ids_for_project(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assessment_run_applies_to_companies(
  _target_company_ids uuid[],
  _user_company_ids uuid[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT
    COALESCE(array_length(_target_company_ids, 1), 0) = 0
    OR EXISTS (
      SELECT 1
        FROM unnest(_target_company_ids) t
       WHERE t = ANY (_user_company_ids)
    );
$fn$;

CREATE OR REPLACE FUNCTION public.assessment_share_summary(_run_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _out text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY n)
    INTO _out
    FROM (
      SELECT n,
             format(
               '%s. [%s] %s%s',
               n,
               COALESCE(NULLIF(process, ''), '-'),
               COALESCE(NULLIF(hazard, ''), NULLIF(hazard_situation, ''), '위험'),
               CASE
                 WHEN NULLIF(improvement_measure, '') IS NOT NULL THEN ' → ' || improvement_measure
                 ELSE ''
               END
             ) AS line
        FROM (
          SELECT
            row_number() OVER (
              ORDER BY
                CASE
                  WHEN COALESCE(ri.risk_grade, '') IN ('상', 'high', 'H', '3') THEN 0
                  WHEN COALESCE(ri.risk_grade, '') IN ('중', 'medium', 'M', '2') THEN 1
                  ELSE 2
                END,
                ri.sort_order NULLS LAST
            ) AS n,
            ri.process,
            ri.hazard,
            ri.hazard_situation,
            ri.improvement_measure
          FROM public.risk_items ri
         WHERE ri.run_id = _run_id
           AND COALESCE(ri.is_deleted, false) = false
           AND COALESCE(ri.is_excluded, false) = false
        ) ranked
       WHERE n <= 8
    ) s;
  RETURN COALESCE(NULLIF(btrim(_out), ''), '승인된 위험성평가 요지를 확인해 주세요.');
END;
$fn$;
