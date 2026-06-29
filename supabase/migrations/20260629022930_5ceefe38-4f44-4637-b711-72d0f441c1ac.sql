
-- Track 2: Unified permission matrix (SSOT) for RLS + UI parity.
-- Mirrors src/hooks/useProjectAccess.ts PERMISSION_MATRIX exactly.

CREATE OR REPLACE FUNCTION public.get_project_role(_user_id uuid, _project_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_master(_user_id) THEN 'master'
    ELSE COALESCE(
      (SELECT lower(pm.role_new::text)
         FROM public.project_members pm
        WHERE pm.user_id = _user_id
          AND pm.project_id = _project_id
        LIMIT 1),
      'viewer'
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_project_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_project_role(uuid, uuid) TO authenticated, service_role;

-- has_permission: single source of truth used by RLS and (optionally) by the UI.
-- _feature in: risk_assessment, work_plan, work_permit, safety_inspection, tbm,
--              incident, safety_cost, legal_duty, todo, approval, company,
--              member, master_data, audit_log
-- _action  in: view, create, edit, delete, approve
CREATE OR REPLACE FUNCTION public.has_permission(
  _user_id uuid,
  _project_id uuid,
  _feature text,
  _action text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_feature text := lower(coalesce(_feature, ''));
  v_action  text := lower(coalesce(_action, 'view'));
  -- legacy role coercion
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;

  v_role := public.get_project_role(_user_id, _project_id);

  -- Legacy mapping: contractor / user → worker
  IF v_role IN ('contractor','user') THEN
    v_role := 'worker';
  END IF;

  -- master & project_admin: full access (approve excluded from delete-set is fine; matrix grants all)
  IF v_role IN ('master','project_admin','safety_manager') THEN
    -- safety_manager has all except master-only globals (handled elsewhere)
    IF v_action IN ('view','create','edit','delete','approve') THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  -- site_manager
  IF v_role = 'site_manager' THEN
    IF v_action = 'view' THEN RETURN true; END IF;
    IF v_feature IN ('risk_assessment','work_plan','work_permit') THEN
      RETURN v_action IN ('create','edit','approve');
    END IF;
    IF v_feature IN ('safety_inspection','tbm','incident','todo') THEN
      RETURN v_action IN ('create','edit','delete');
    END IF;
    IF v_feature = 'approval' THEN RETURN v_action = 'approve'; END IF;
    RETURN false;
  END IF;

  -- supervisor
  IF v_role = 'supervisor' THEN
    IF v_action = 'view' THEN RETURN true; END IF;
    IF v_feature = 'work_permit' AND v_action = 'approve' THEN RETURN true; END IF;
    IF v_feature IN ('safety_inspection','incident','todo') THEN
      RETURN v_action IN ('create','edit');
    END IF;
    IF v_feature = 'approval' AND v_action = 'approve' THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- worker
  IF v_role = 'worker' THEN
    IF v_action = 'view' THEN RETURN true; END IF;
    IF v_feature IN ('risk_assessment','work_plan','incident','todo') THEN
      RETURN v_action IN ('create','edit');
    END IF;
    IF v_feature = 'approval' AND v_action = 'create' THEN RETURN true; END IF;
    RETURN false;
  END IF;

  -- viewer & default: read-only
  RETURN v_action = 'view';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_permission(uuid, uuid, text, text)
  IS 'SSOT permission matrix mirroring src/hooks/useProjectAccess.ts. Use from RLS as public.has_permission(auth.uid(), project_id, feature, action).';
