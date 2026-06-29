
ALTER TABLE public.approval_route_templates
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'assessment_run',
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_approval_templates_entity
  ON public.approval_route_templates(project_id, entity_type, company_id)
  WHERE is_deleted = false;

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
    WHERE c.id = _submitter_company_id AND c.is_deleted = false
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
      ac.name AS out_company_name,
      ac.type AS out_company_type,
      COALESCE(pm.position_new::text, '') AS out_position,
      pm.role_new::text AS out_role
    FROM public.project_members pm
    JOIN ancestors ac ON ac.id = pm.company_id
    LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
    WHERE pm.project_id = _project_id
      AND pm.role_new::text IN ('project_admin','safety_manager','site_manager','supervisor','contractor')
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

CREATE OR REPLACE FUNCTION public.submit_approval(
  _entity_type text,
  _entity_id uuid,
  _project_id uuid,
  _company_id uuid,
  _steps jsonb,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_step jsonb;
  v_order integer := 1;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF jsonb_array_length(COALESCE(_steps, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'empty_steps';
  END IF;

  UPDATE public.approvals
  SET status = '취소',
      comment = COALESCE(comment,'') || CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
      updated_at = now()
  WHERE entity_type = _entity_type
    AND entity_id = _entity_id
    AND status = '대기';

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
  FROM public.approvals
  WHERE entity_type = _entity_type AND entity_id = _entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps)
  LOOP
    INSERT INTO public.approvals(
      project_id, entity_type, entity_id, run_id,
      step, step_order, status, approval_version,
      approver_id, approver_name, position,
      company_id, company_name
    )
    VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type = 'assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label', '결재'),
      v_order,
      '대기',
      v_next_version,
      NULLIF(v_step->>'user_id','')::uuid,
      COALESCE(v_step->>'user_name',''),
      COALESCE(v_step->>'position',''),
      NULLIF(v_step->>'company_id','')::uuid,
      COALESCE(v_step->>'company_name','')
    );
    v_order := v_order + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  INSERT INTO public.notifications (user_id, type, title, message, project_id, related_entity_type, related_entity_id)
  SELECT a.approver_id, 'approval_request', '결재 요청',
         '['||_entity_type||'] 결재가 상신되었습니다.',
         _project_id, _entity_type, _entity_id
  FROM public.approvals a
  WHERE a.entity_type = _entity_type
    AND a.entity_id = _entity_id
    AND a.approval_version = v_next_version
    AND a.step_order = 1
    AND a.approver_id IS NOT NULL;

  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_approval(text, uuid, uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_approval(text, uuid, uuid, uuid, jsonb, text) TO authenticated;
