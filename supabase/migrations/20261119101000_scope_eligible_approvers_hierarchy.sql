-- Scope get_eligible_approvers to the submitter's own company + upper hierarchy only
-- (own company -> parent company chain -> project client; never peer GCs or peer contractors).
-- Backward-compatible fallback: if a contractor/vendor has no parent_company_id yet,
-- include projects.gc_company_id (or the sole GC if the project has exactly one GC).

CREATE OR REPLACE FUNCTION public.get_eligible_approvers(_project_id uuid, _submitter_company_id uuid)
 RETURNS TABLE(out_user_id uuid, out_display_name text, out_company_id uuid, out_company_name text, out_company_type text, out_position text, out_role text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_project_member(auth.uid(), _project_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  submitter_co AS (
    SELECT c.id, lower(trim(COALESCE(c.type, ''))) AS ctype
    FROM public.companies c
    WHERE _submitter_company_id IS NOT NULL
      AND c.id = _submitter_company_id
      AND COALESCE(c.is_deleted, false) = false
  ),
  ancestors AS (
    SELECT c.id,
           COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_company_id,
           c.name, c.type, 0 AS depth
    FROM public.companies c
    LEFT JOIN public.project_companies pc
      ON pc.company_id = c.id AND pc.project_id = _project_id AND COALESCE(pc.is_deleted, false) = false
    WHERE _submitter_company_id IS NOT NULL
      AND c.id = _submitter_company_id
      AND COALESCE(c.is_deleted, false) = false
    UNION ALL
    SELECT c.id,
           COALESCE(pc.parent_company_id, c.parent_company_id),
           c.name, c.type, a.depth + 1
    FROM ancestors a
    JOIN public.companies c ON c.id = a.parent_company_id
    LEFT JOIN public.project_companies pc
      ON pc.company_id = c.id AND pc.project_id = _project_id AND COALESCE(pc.is_deleted, false) = false
    WHERE COALESCE(c.is_deleted, false) = false
      AND a.depth < 8
  ),
  project_clients AS (
    SELECT DISTINCT c.id
    FROM public.project_companies pc
    JOIN public.companies c ON c.id = pc.company_id
    WHERE pc.project_id = _project_id
      AND COALESCE(pc.is_deleted, false) = false
      AND COALESCE(c.is_deleted, false) = false
      AND lower(trim(COALESCE(c.type, ''))) IN ('client', '발주처', 'owner')
  ),
  project_gcs AS (
    SELECT DISTINCT c.id
    FROM public.project_companies pc
    JOIN public.companies c ON c.id = pc.company_id
    WHERE pc.project_id = _project_id
      AND COALESCE(pc.is_deleted, false) = false
      AND COALESCE(c.is_deleted, false) = false
      AND lower(trim(COALESCE(c.type, ''))) IN ('gc', '시공사', '원도급', '원청', 'general_contractor')
  ),
  -- Only when submitter is a partner (not client/gc) and has no GC in its ancestor chain
  fallback_gc AS (
    SELECT g.id
    FROM project_gcs g
    WHERE _submitter_company_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM submitter_co sc
        WHERE sc.ctype NOT IN ('client', '발주처', 'owner', 'gc', '시공사', '원도급', '원청', 'general_contractor')
      )
      AND NOT EXISTS (
        SELECT 1 FROM ancestors a
        WHERE lower(trim(COALESCE(a.type, ''))) IN ('gc', '시공사', '원도급', '원청', 'general_contractor')
      )
      AND (
        g.id = (SELECT p.gc_company_id FROM public.projects p WHERE p.id = _project_id)
        OR (SELECT COUNT(*) FROM project_gcs) = 1
      )
  ),
  eligible_cos AS (
    SELECT id FROM ancestors
    UNION
    SELECT id FROM project_clients
    UNION
    SELECT id FROM fallback_gc
    UNION
    SELECT c.id
    FROM public.project_companies pc
    JOIN public.companies c ON c.id = pc.company_id
    WHERE _submitter_company_id IS NULL
      AND pc.project_id = _project_id
      AND COALESCE(pc.is_deleted, false) = false
      AND COALESCE(c.is_deleted, false) = false
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
    AND COALESCE(pr.account_status, 'active') = 'active'
    AND (
      pm.role_new::text IN (
        'project_admin', 'safety_manager', 'site_manager',
        'supervisor', 'site_supervisor', 'contractor'
      )
      OR pm.position_new IS NOT NULL
    );
END;
$function$;
