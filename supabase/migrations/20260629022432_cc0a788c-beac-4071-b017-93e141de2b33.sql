
-- 1) PII: hazard_survey_responses
DROP POLICY IF EXISTS hsr_select ON public.hazard_survey_responses;
CREATE POLICY hsr_select_admin
  ON public.hazard_survey_responses
  FOR SELECT
  TO authenticated
  USING (public.is_project_admin(auth.uid(), project_id));

-- 2) PII: worker_zone_events
DROP POLICY IF EXISTS "members view events" ON public.worker_zone_events;
CREATE POLICY "admins view zone events"
  ON public.worker_zone_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_admin(auth.uid(), project_id)
  );

-- 3) Legacy markers
COMMENT ON TABLE public.master_departments
  IS 'LEGACY (read-only). SSOT = public.company_departments.';
COMMENT ON TABLE public.master_assignees
  IS 'LEGACY (read-only). SSOT = public.company_managers.';
COMMENT ON TABLE public.department_assignees
  IS 'LEGACY (read-only). SSOT = public.company_managers (assignee_user_id via default_user_id).';

-- 4) Unified assignee pool view
DROP VIEW IF EXISTS public.v_project_assignee_pool;
CREATE VIEW public.v_project_assignee_pool
WITH (security_invoker = on) AS
SELECT
  cm.id                       AS source_id,
  'company_manager'::text     AS source,
  c.project_id                AS project_id,
  cm.company_id               AS company_id,
  c.name                      AS company_name,
  cm.department_id            AS department_id,
  cd.name                     AS department_name,
  cm.user_id                  AS user_id,
  cm.name                     AS display_name,
  cm.position                 AS position,
  cm.phone                    AS phone,
  cm.email                    AS email,
  TRUE                        AS is_ssot
FROM public.company_managers cm
JOIN public.companies c ON c.id = cm.company_id
LEFT JOIN public.company_departments cd ON cd.id = cm.department_id
WHERE cm.is_deleted = FALSE
UNION ALL
SELECT
  da.id, 'legacy_dept_assignee', da.project_id,
  NULL::uuid, NULL::text,
  da.department_id,
  cd2.name,
  da.default_user_id,
  COALESCE(p.display_name, 'Unknown'),
  NULL::text, p.phone, NULL::text,
  FALSE
FROM public.department_assignees da
LEFT JOIN public.company_departments cd2 ON cd2.id = da.department_id
LEFT JOIN public.profiles p ON p.user_id = da.default_user_id
WHERE da.default_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.company_managers cm2
    WHERE cm2.user_id = da.default_user_id AND cm2.is_deleted = FALSE
  );

GRANT SELECT ON public.v_project_assignee_pool TO authenticated;

-- 5) audit_data_consistency
CREATE OR REPLACE FUNCTION public.audit_data_consistency()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  WHERE NOT EXISTS (
    SELECT 1 FROM public.company_departments cd WHERE lower(cd.name) = lower(md.name)
  );

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
    SELECT company_id, user_id, count(*) c
    FROM public.company_managers
    WHERE user_id IS NOT NULL AND is_deleted = FALSE
    GROUP BY company_id, user_id
    HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO workers_no_company
  FROM public.workers
  WHERE company_id IS NULL AND COALESCE(is_deleted, false) = false;

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
$$;

REVOKE ALL ON FUNCTION public.audit_data_consistency() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_data_consistency() TO authenticated;

-- 6) migrate_legacy_to_ssot
CREATE OR REPLACE FUNCTION public.migrate_legacy_to_ssot(_project_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  migrated_depts int := 0;
  migrated_managers int := 0;
  default_company_id uuid;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'Only master role can run migration';
  END IF;

  SELECT id INTO default_company_id
  FROM public.companies
  WHERE (_project_id IS NULL OR project_id = _project_id)
  ORDER BY created_at ASC
  LIMIT 1;

  IF default_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No company available for migration target');
  END IF;

  INSERT INTO public.company_departments (company_id, name)
  SELECT default_company_id, md.name
  FROM public.master_departments md
  WHERE (_project_id IS NULL OR md.project_id = _project_id OR md.project_id IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.company_departments cd
      WHERE cd.company_id = default_company_id AND lower(cd.name) = lower(md.name)
    );
  GET DIAGNOSTICS migrated_depts = ROW_COUNT;

  INSERT INTO public.company_managers (company_id, user_id, name, department_id)
  SELECT
    default_company_id,
    da.default_user_id,
    COALESCE(p.display_name, 'Unknown'),
    da.department_id
  FROM public.department_assignees da
  LEFT JOIN public.profiles p ON p.user_id = da.default_user_id
  WHERE da.default_user_id IS NOT NULL
    AND (_project_id IS NULL OR da.project_id = _project_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.company_managers cm
      WHERE cm.company_id = default_company_id AND cm.user_id = da.default_user_id AND cm.is_deleted = FALSE
    );
  GET DIAGNOSTICS migrated_managers = ROW_COUNT;

  RETURN jsonb_build_object(
    'migrated_departments', migrated_depts,
    'migrated_managers', migrated_managers,
    'target_company_id', default_company_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.migrate_legacy_to_ssot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.migrate_legacy_to_ssot(uuid) TO authenticated;
