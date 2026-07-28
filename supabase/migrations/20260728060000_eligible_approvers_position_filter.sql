-- Expand get_eligible_approvers so SITE_SUPERVISOR / site_supervisor members appear.
-- Also include all project members in the ancestor chain (position filter is client-side).

CREATE OR REPLACE FUNCTION public.get_eligible_approvers(
  _project_id uuid,
  _submitter_company_id uuid
)
RETURNS TABLE(
  out_user_id uuid,
  out_display_name text,
  out_company_id uuid,
  out_company_name text,
  out_company_type text,
  out_position text,
  out_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_project_member(auth.uid(), _project_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  ancestors AS (
    SELECT c.id, COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_company_id,
           c.name, c.type, 0 AS depth
    FROM public.companies c
    LEFT JOIN public.project_companies pc
      ON pc.company_id = c.id AND pc.project_id = _project_id AND pc.is_deleted = false
    WHERE _submitter_company_id IS NOT NULL
      AND c.id = _submitter_company_id
      AND c.is_deleted = false
    UNION ALL
    SELECT c.id, COALESCE(pc.parent_company_id, c.parent_company_id),
           c.name, c.type, a.depth + 1
    FROM ancestors a
    JOIN public.companies c ON c.id = a.parent_company_id
    LEFT JOIN public.project_companies pc
      ON pc.company_id = c.id AND pc.project_id = _project_id AND pc.is_deleted = false
    WHERE c.is_deleted = false AND a.depth < 5
  ),
  -- Also pull every GC / client on the project so owner/gc steps are populated
  project_cos AS (
    SELECT DISTINCT c.id, c.name, c.type
    FROM public.project_companies pc
    JOIN public.companies c ON c.id = pc.company_id
    WHERE pc.project_id = _project_id
      AND pc.is_deleted = false
      AND c.is_deleted = false
      AND lower(COALESCE(c.type, '')) IN ('client', 'gc', 'contractor', 'vendor', '발주처', '시공사', '협력사')
  ),
  eligible_cos AS (
    SELECT id FROM ancestors
    UNION
    SELECT id FROM project_cos
     WHERE lower(COALESCE(type, '')) IN ('client', 'gc', '발주처', '시공사')
  )
  SELECT
    pm.user_id AS out_user_id,
    COALESCE(pr.display_name, '') AS out_display_name,
    pm.company_id AS out_company_id,
    COALESCE(co.name, '') AS out_company_name,
    COALESCE(co.type, '') AS out_company_type,
    COALESCE(pm.position_new::text, '') AS out_position,
    COALESCE(pm.role_new::text, '') AS out_role
  FROM public.project_members pm
  LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
  LEFT JOIN public.companies co ON co.id = pm.company_id
  WHERE pm.project_id = _project_id
    AND pm.company_id IN (SELECT id FROM eligible_cos)
    AND (
      pm.role_new::text IN (
        'project_admin', 'safety_manager', 'site_manager',
        'supervisor', 'site_supervisor', 'contractor', 'worker'
      )
      OR pm.position_new IS NOT NULL
    );
END;
$$;
