
CREATE OR REPLACE FUNCTION public.audit_data_consistency()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  legacy_dept_count int;
  legacy_assignee_count int;
  orphan_risk_dept int;
  duplicate_managers int;
  workers_no_company int;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Only master role can run consistency audit';
  END IF;

  SELECT count(*) INTO legacy_dept_count
  FROM public.master_departments md
  WHERE NOT EXISTS (SELECT 1 FROM public.company_departments cd WHERE lower(cd.name) = lower(md.name));

  SELECT count(*) INTO legacy_assignee_count
  FROM public.department_assignees da
  WHERE da.default_user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.company_managers cm
      WHERE cm.user_id = da.default_user_id AND cm.is_deleted = FALSE
    );

  SELECT count(*) INTO orphan_risk_dept
  FROM public.risk_items ri
  WHERE ri.responsible_department_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.company_departments cd WHERE cd.id = ri.responsible_department_id)
    AND NOT EXISTS (SELECT 1 FROM public.master_departments md WHERE md.id = ri.responsible_department_id);

  SELECT count(*) INTO duplicate_managers
  FROM (
    SELECT company_id, user_id
    FROM public.company_managers
    WHERE user_id IS NOT NULL AND is_deleted = FALSE
    GROUP BY company_id, user_id
    HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO workers_no_company
  FROM public.workers
  WHERE company_id IS NULL AND COALESCE(is_active, true) = true;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'legacy_departments_not_migrated', legacy_dept_count,
    'legacy_assignees_not_migrated', legacy_assignee_count,
    'orphan_risk_item_department_refs', orphan_risk_dept,
    'duplicate_company_managers', duplicate_managers,
    'workers_without_company', workers_no_company,
    'total_issues', legacy_dept_count + legacy_assignee_count + orphan_risk_dept + duplicate_managers + workers_no_company
  );
END;
$function$;

-- hazard_survey_responses: company-scope via workers
DROP POLICY IF EXISTS hsr_select_admin ON public.hazard_survey_responses;
CREATE POLICY hsr_select_admin ON public.hazard_survey_responses
FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.workers w
    WHERE w.id = hazard_survey_responses.worker_id
      AND public.can_access_company_data(auth.uid(), hazard_survey_responses.project_id, w.company_id)
  )
  -- Respondents without a linked worker record fall back to project-admin only
  OR (
    hazard_survey_responses.worker_id IS NULL
    AND public.is_project_admin(auth.uid(), hazard_survey_responses.project_id)
  )
);

-- worker_zone_events: company-scope via worker_daily_qr -> workers
DROP POLICY IF EXISTS "admins view zone events" ON public.worker_zone_events;
CREATE POLICY "admins view zone events" ON public.worker_zone_events
FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.worker_daily_qr q
    JOIN public.workers w ON w.id = q.worker_id
    WHERE q.id = worker_zone_events.worker_qr_id
      AND public.can_access_company_data(auth.uid(), worker_zone_events.project_id, w.company_id)
  )
);
