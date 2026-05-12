-- Fix is_master to use new global_role (app_role was dropped)
CREATE OR REPLACE FUNCTION public.is_master(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'master'::public.global_role
  )
$function$;

-- Also fix master protection triggers to avoid referencing app_role
CREATE OR REPLACE FUNCTION public.prevent_last_master_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE master_count INT;
BEGIN
  IF OLD.role::text = 'master' AND NEW.role::text != 'master' THEN
    SELECT COUNT(*) INTO master_count FROM public.user_roles
      WHERE role::text = 'master' AND id != OLD.id;
    IF master_count = 0 THEN
      RAISE EXCEPTION 'Cannot change the last master role. At least one master must exist.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_last_master_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE master_count INT;
BEGIN
  IF OLD.role::text = 'master' THEN
    SELECT COUNT(*) INTO master_count FROM public.user_roles
      WHERE role::text = 'master' AND id != OLD.id;
    IF master_count = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last master role. At least one master must exist.';
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;