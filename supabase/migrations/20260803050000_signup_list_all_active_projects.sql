-- Signup: show all active (non-deleted) projects, not only those with company links.
-- Also fix company_type to use companies.type (was role_in_project).

CREATE OR REPLACE FUNCTION public.get_signup_projects()
RETURNS TABLE (
  id uuid,
  name text,
  site_name text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.name, p.site_name, p.status
  FROM public.projects p
  WHERE COALESCE(p.is_deleted, false) = false
    AND COALESCE(NULLIF(btrim(p.status), ''), '진행중') NOT IN ('완료', '폐기', '삭제')
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION public.get_signup_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signup_projects() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_signup_projects() IS
  'Public signup project picker — active non-deleted projects (anon OK).';

-- Align joinable RPC with soft-delete + anon signup paths
CREATE OR REPLACE FUNCTION public.list_joinable_projects()
RETURNS TABLE(id uuid, name text, site_name text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.name, p.site_name, p.status
  FROM public.projects p
  WHERE COALESCE(p.is_deleted, false) = false
    AND COALESCE(NULLIF(btrim(p.status), ''), '진행중') NOT IN ('완료', '폐기', '삭제')
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION public.list_joinable_projects() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_joinable_projects() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_signup_company_directory()
RETURNS TABLE (
  project_id uuid,
  project_name text,
  company_id uuid,
  company_name text,
  company_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id,
    p.name,
    c.id,
    c.name,
    COALESCE(NULLIF(btrim(c.type), ''), pc.role_in_project::text) AS company_type
  FROM public.project_companies pc
  JOIN public.projects p ON p.id = pc.project_id
  JOIN public.companies c ON c.id = pc.company_id
  WHERE pc.is_deleted = false
    AND c.is_deleted = false
    AND COALESCE(p.is_deleted, false) = false
    AND COALESCE(NULLIF(btrim(p.status), ''), '진행중') NOT IN ('완료', '폐기', '삭제')
  ORDER BY p.name, c.name;
$$;

REVOKE ALL ON FUNCTION public.get_signup_company_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signup_company_directory() TO anon, authenticated, service_role;
