-- Fix: soft-deleted entities reappearing in pending approvals,
-- and owner-side roles on contractor companies being over-scoped by is_contractor_user.

-- 1) is_contractor_user: company type alone is too blunt.
--    project_admin / safety_manager / site_manager / supervisor must keep owner-side scope
--    even if their project_members.company_id points at a contractor company row.
CREATE OR REPLACE FUNCTION public.is_contractor_user(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm
    JOIN public.companies c ON c.id = pm.company_id
    WHERE pm.user_id = _user_id
      AND pm.project_id = _project_id
      AND c.type = 'contractor'
      AND COALESCE(pm.role_new::text, '') NOT IN (
        'project_admin', 'safety_manager', 'site_manager', 'supervisor'
      )
      AND NOT public.is_master(_user_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_contractor_user(uuid, uuid) TO authenticated, service_role;

-- 2) Pending entity approvals: hide soft-deleted / archived targets
CREATE OR REPLACE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid, entity_type text, entity_id uuid, project_id uuid,
  step text, step_order integer, step_position text,
  created_at timestamp with time zone, entity_title text, entity_date date
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.title
           WHEN a.entity_type='work_permit'    THEN per.work_description
           WHEN a.entity_type='assessment_run' THEN ar.period_label
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.start_date
           WHEN a.entity_type='work_permit'    THEN per.permit_date
           WHEN a.entity_type='assessment_run' THEN ar.start_date
           ELSE NULL END AS entity_date
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type='assessment_run' AND ar.id  = a.entity_id
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
     AND (
       (a.entity_type = 'work_plan' AND wp.id IS NOT NULL AND COALESCE(wp.is_deleted, false) = false)
       OR (a.entity_type = 'work_permit' AND per.id IS NOT NULL AND COALESCE(per.is_deleted, false) = false)
       OR (a.entity_type = 'assessment_run' AND ar.id IS NOT NULL
           AND COALESCE(ar.is_deleted, false) = false AND COALESCE(ar.status, '') <> '폐기')
       OR (a.entity_type NOT IN ('work_plan', 'work_permit', 'assessment_run'))
     )
   ORDER BY a.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated, service_role;
