
-- 1. profiles: restrict SELECT to self, masters, or users sharing a project
CREATE OR REPLACE FUNCTION public.shares_project_with(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_members pm1
    JOIN public.project_members pm2 ON pm1.project_id = pm2.project_id
    WHERE pm1.user_id = _viewer AND pm2.user_id = _target
  )
$$;

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view permitted profiles"
ON public.profiles FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR has_role(auth.uid(), 'master'::app_role)
  OR public.shares_project_with(auth.uid(), user_id)
);

-- 2. user_roles: restrict SELECT to self or masters
DROP POLICY IF EXISTS "Anyone can read roles" ON public.user_roles;
CREATE POLICY "Users can view own roles or masters all"
ON public.user_roles FOR SELECT TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'master'::app_role));

-- 3. master_departments: restrict SELECT to project members
DROP POLICY IF EXISTS "Anyone can view departments" ON public.master_departments;
CREATE POLICY "Project members can view departments"
ON public.master_departments FOR SELECT TO authenticated
USING (project_id IS NULL OR is_project_member(auth.uid(), project_id));

-- 4. audit_logs: enforce user_id = auth.uid() on insert
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert own audit logs"
ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 5. tbm_participations: restrict phone visibility to admins/safety_managers
DROP POLICY IF EXISTS "Members can view tbm_participations" ON public.tbm_participations;
CREATE POLICY "Admins can view tbm_participations"
ON public.tbm_participations FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tbm_sessions s
    WHERE s.id = tbm_participations.tbm_session_id
      AND is_project_member(auth.uid(), s.project_id)
      AND (
        is_admin(auth.uid())
        OR get_project_role(auth.uid(), s.project_id) IN ('master','project_admin','safety_manager')
      )
  )
);

-- 6. Storage: drop overly-permissive attachment policies
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own" ON storage.objects;
