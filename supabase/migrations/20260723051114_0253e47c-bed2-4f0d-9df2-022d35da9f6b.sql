
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
SET search_path = public
AS $$
  SELECT p.id, p.name, c.id, c.name, pc.role_in_project::text
  FROM public.project_companies pc
  JOIN public.projects p ON p.id = pc.project_id
  JOIN public.companies c ON c.id = pc.company_id
  WHERE pc.is_deleted = false AND c.is_deleted = false
  ORDER BY p.name, c.name;
$$;

REVOKE ALL ON FUNCTION public.get_signup_company_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signup_company_directory() TO anon, authenticated;
