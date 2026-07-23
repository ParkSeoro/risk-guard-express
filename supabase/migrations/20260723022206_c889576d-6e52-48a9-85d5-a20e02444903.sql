
DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'approval_lines','approval_route_templates','approvals','chemical_usage_plans','chemicals',
    'company_construction_info','company_daily_qr','company_departments','company_managers','company_members',
    'confined_space_permits','emergency_drills','equipment_master','hazard_surveys','health_checkups',
    'health_education_logs','incident_reports','legal_duties','musculoskeletal_surveys',
    'project_invites','project_members','safety_appointments','safety_cost_approval_steps',
    'safety_cost_audit_logs','safety_cost_constructions','safety_cost_evidence_files','safety_cost_items',
    'safety_cost_monthly_reports','safety_cost_violations','safety_education_materials','safety_inspections',
    'special_health_targets','tbm_sessions','todo_items','work_env_measurements','work_permits',
    'work_plan_attachments','work_plans','worker_education_records','workers'
  ];
BEGIN
  CREATE TEMP TABLE _company_map ON COMMIT DROP AS
  WITH ranked AS (
    SELECT c.id, c.created_at,
      lower(regexp_replace(coalesce(c.name,''), '\s+', '', 'g')) AS norm,
      ROW_NUMBER() OVER (
        PARTITION BY lower(regexp_replace(coalesce(c.name,''), '\s+', '', 'g'))
        ORDER BY c.created_at ASC, c.id ASC
      ) AS rn
    FROM public.companies c
    WHERE c.is_deleted = false AND coalesce(c.name,'') <> ''
  ),
  canon AS (SELECT norm, id AS canonical_id FROM ranked WHERE rn = 1)
  SELECT rk.id AS dup_id, cn.canonical_id
  FROM ranked rk
  JOIN canon cn ON cn.norm = rk.norm
  WHERE rk.id <> cn.canonical_id;

  -- Pre-collapse rows that would collide on unique (company_id, X) constraints.
  -- Rule: if canonical already has a row with the same key, drop the duplicate's row.
  DELETE FROM public.company_departments d
  USING _company_map m
  WHERE d.company_id = m.dup_id
    AND EXISTS (
      SELECT 1 FROM public.company_departments d2
      WHERE d2.company_id = m.canonical_id AND d2.name = d.name
    );

  DELETE FROM public.company_construction_info ci
  USING _company_map m
  WHERE ci.company_id = m.dup_id
    AND EXISTS (
      SELECT 1 FROM public.company_construction_info ci2
      WHERE ci2.company_id = m.canonical_id AND ci2.project_id = ci.project_id
    );

  DELETE FROM public.company_daily_qr q
  USING _company_map m
  WHERE q.company_id = m.dup_id
    AND EXISTS (
      SELECT 1 FROM public.company_daily_qr q2
      WHERE q2.company_id = m.canonical_id AND q2.work_date = q.work_date
    );

  DELETE FROM public.company_members cm
  USING _company_map m
  WHERE cm.company_id = m.dup_id
    AND EXISTS (
      SELECT 1 FROM public.company_members cm2
      WHERE cm2.company_id = m.canonical_id AND cm2.user_id = cm.user_id
    );

  -- Rewire remaining rows in all listed tables
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format(
      'UPDATE public.%I t SET company_id = m.canonical_id FROM _company_map m WHERE t.company_id = m.dup_id',
      tbl
    );
  END LOOP;

  UPDATE public.projects p SET gc_company_id = m.canonical_id
    FROM _company_map m WHERE p.gc_company_id = m.dup_id;
  UPDATE public.companies c SET parent_company_id = m.canonical_id
    FROM _company_map m WHERE c.parent_company_id = m.dup_id;

  UPDATE public.project_companies pc SET company_id = m.canonical_id
    FROM _company_map m WHERE pc.company_id = m.dup_id;

  DELETE FROM public.project_companies pc
  USING (
    SELECT project_id, company_id, MIN(ctid) AS keep_ctid
    FROM public.project_companies
    GROUP BY project_id, company_id
    HAVING COUNT(*) > 1
  ) d
  WHERE pc.project_id = d.project_id AND pc.company_id = d.company_id AND pc.ctid <> d.keep_ctid;

  UPDATE public.companies c
    SET is_deleted = true, updated_at = now()
    FROM _company_map m
    WHERE c.id = m.dup_id;

  INSERT INTO public.project_companies (project_id, company_id, role_in_project, is_deleted)
  SELECT c.project_id, c.id,
    CASE c.type WHEN 'contractor' THEN 'contractor' WHEN 'vendor' THEN 'vendor' WHEN 'client' THEN 'client' ELSE 'gc' END,
    false
  FROM public.companies c
  WHERE c.is_deleted = false AND c.project_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.project_companies pc
      WHERE pc.project_id = c.project_id AND pc.company_id = c.id
    );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS companies_norm_name_uidx
  ON public.companies ((lower(regexp_replace(coalesce(name,''), '\s+', '', 'g'))))
  WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS project_companies_pc_uidx
  ON public.project_companies (project_id, company_id)
  WHERE is_deleted = false;
