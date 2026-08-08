-- Align can_access_safety_cost with companyDocScope / can_access_company_data:
-- - master: all
-- - 발주처 PA/SM(/site_manager…): all (via can_access_company_data)
-- - 시공사: own + descendant tree
-- - 협력사/공급사: own only
-- Write: viewer blocked.

CREATE OR REPLACE FUNCTION public.can_access_safety_cost(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid,
  _write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.project_role;
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  SELECT role_new INTO _role
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;

  IF _write AND _role = 'viewer' THEN
    RETURN false;
  END IF;

  -- Orphan / project-scoped rows: only client-wide admins (PA/SM/site_mgr on client)
  -- or master (handled above). Use NULL company probe via can_access_company_data
  -- which returns false for non-client when company_id is null — so allow
  -- project_admin on any type for orphan cleanup only when company matches tree
  -- is not possible. Match prior tighten: orphan → false for non-PA was too
  -- strict for client SM. Prefer can_access_company_data for real company rows.
  IF _company_id IS NULL THEN
    RETURN public.can_access_company_data(_user_id, _project_id, _company_id);
  END IF;

  RETURN public.can_access_company_data(_user_id, _project_id, _company_id);
END;
$function$;

COMMENT ON FUNCTION public.can_access_safety_cost(uuid, uuid, uuid, boolean) IS
  'Safety cost ACL: same company tree as can_access_company_data; viewer cannot write.';
