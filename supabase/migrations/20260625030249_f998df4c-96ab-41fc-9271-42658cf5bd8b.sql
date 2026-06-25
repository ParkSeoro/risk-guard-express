CREATE OR REPLACE FUNCTION public.trg_project_members_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role_new IS DISTINCT FROM NEW.role_new THEN
    INSERT INTO public.audit_logs (user_id, action, target_type, target_id, project_id, details)
    VALUES (auth.uid(), 'role_change', 'project_members', NEW.id::text, NEW.project_id,
            jsonb_build_object('user_id', NEW.user_id, 'project_id', NEW.project_id,
                               'from', OLD.role_new, 'to', NEW.role_new));
    IF NEW.user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, related_type, related_id, project_id)
      VALUES (NEW.user_id, 'role_changed',
              '프로젝트 권한 변경',
              '새 역할: ' || COALESCE(NEW.role_new::text, ''),
              'project_members',
              NEW.id::text,
              NEW.project_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;