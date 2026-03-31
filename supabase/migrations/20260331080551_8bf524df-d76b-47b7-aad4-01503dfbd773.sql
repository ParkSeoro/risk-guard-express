
-- 1. Create a minimal RPC for the project join-request flow
-- Returns only id, name, status for active projects (no sensitive fields)
CREATE OR REPLACE FUNCTION public.list_joinable_projects()
RETURNS TABLE(id uuid, name text, site_name text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.site_name, p.status
  FROM public.projects p
  WHERE p.status = '진행중'
  ORDER BY p.name;
$$;

-- 2. Tighten the projects SELECT policy to members + masters only
DROP POLICY IF EXISTS "Authenticated users can view projects" ON public.projects;
CREATE POLICY "Members can view own projects" ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    is_project_member(auth.uid(), id)
    OR has_role(auth.uid(), 'master'::app_role)
  );
