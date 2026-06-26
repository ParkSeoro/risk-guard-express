CREATE OR REPLACE FUNCTION public.sync_company_manager_to_project_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_project_id uuid;
  v_role public.project_role;
  v_position public.project_position;
BEGIN
  IF NEW.user_id IS NULL OR NEW.is_deleted THEN
    RETURN NEW;
  END IF;

  SELECT project_id INTO v_project_id FROM public.companies WHERE id = NEW.company_id;
  IF v_project_id IS NULL THEN RETURN NEW; END IF;

  v_role := CASE lower(NEW.position)
    WHEN 'safety_manager' THEN 'safety_manager'::public.project_role
    WHEN 'site_manager' THEN 'site_manager'::public.project_role
    WHEN 'project_admin' THEN 'project_admin'::public.project_role
    WHEN 'supervisor' THEN 'supervisor'::public.project_role
    WHEN 'worker' THEN 'worker'::public.project_role
    ELSE 'viewer'::public.project_role
  END;

  BEGIN
    v_position := NEW.position::public.project_position;
  EXCEPTION WHEN others THEN
    v_position := NULL;
  END;

  INSERT INTO public.project_members (project_id, user_id, company_id, role_new, position_new)
  VALUES (v_project_id, NEW.user_id, NEW.company_id, v_role, v_position)
  ON CONFLICT (project_id, user_id) DO UPDATE SET
    company_id = EXCLUDED.company_id,
    role_new = CASE
      WHEN public.project_members.role_new IN ('project_admin', 'safety_manager') THEN public.project_members.role_new
      ELSE EXCLUDED.role_new
    END,
    position_new = COALESCE(EXCLUDED.position_new, public.project_members.position_new);

  RETURN NEW;
END;
$function$;