CREATE OR REPLACE FUNCTION public.get_eligible_approvers(
  _project_id uuid,
  _submitter_company_id uuid
)
RETURNS TABLE (
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
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_project_member(auth.uid(), _project_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH RECURSIVE ancestors AS (
    SELECT c.id, c.parent_company_id, c.name, c.type, 0 AS depth
    FROM public.companies c
    WHERE _submitter_company_id IS NOT NULL
      AND c.id = _submitter_company_id
      AND c.is_deleted = false
    UNION ALL
    SELECT c.id, c.parent_company_id, c.name, c.type, a.depth + 1
    FROM public.companies c
    JOIN ancestors a ON c.id = a.parent_company_id
    WHERE c.is_deleted = false AND a.depth < 5
  ),
  pm_users AS (
    SELECT
      pm.user_id AS out_user_id,
      COALESCE(pr.display_name, '') AS out_display_name,
      pm.company_id AS out_company_id,
      COALESCE(co.name, '') AS out_company_name,
      COALESCE(co.type, '') AS out_company_type,
      COALESCE(pm.position_new::text, '') AS out_position,
      pm.role_new::text AS out_role
    FROM public.project_members pm
    LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
    LEFT JOIN public.companies co ON co.id = pm.company_id
    WHERE pm.project_id = _project_id
      AND pm.role_new::text IN ('project_admin','safety_manager','site_manager','supervisor','contractor')
      AND (
        _submitter_company_id IS NULL
        OR pm.company_id IN (SELECT id FROM ancestors)
        OR pm.company_id IS NULL
        OR pm.role_new::text IN ('project_admin','safety_manager')
      )
  ),
  master_users AS (
    SELECT
      ur.user_id AS out_user_id,
      COALESCE(pr.display_name, '') AS out_display_name,
      NULL::uuid AS out_company_id,
      '마스터'::text AS out_company_name,
      'master'::text AS out_company_type,
      'master'::text AS out_position,
      'master'::text AS out_role
    FROM public.user_roles ur
    LEFT JOIN public.profiles pr ON pr.user_id = ur.user_id
    WHERE ur.role = 'master'
  )
  SELECT * FROM pm_users
  UNION
  SELECT * FROM master_users;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_eligible_approvers(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_eligible_approvers(uuid, uuid) TO authenticated;

UPDATE public.work_plans wp
SET company_id = pm.company_id
FROM public.project_members pm
WHERE wp.company_id IS NULL
  AND wp.created_by = pm.user_id
  AND wp.project_id = pm.project_id
  AND pm.company_id IS NOT NULL;