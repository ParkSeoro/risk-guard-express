CREATE OR REPLACE FUNCTION public.is_project_admin(_user_id uuid, _project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_project_role(_user_id, _project_id, ARRAY['project_admin','safety_manager']::public.project_role[])
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='master')
$$;