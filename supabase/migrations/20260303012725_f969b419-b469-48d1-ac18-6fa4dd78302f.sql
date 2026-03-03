
-- =============================================
-- 1. project_join_requests: 프로젝트 가입요청
-- =============================================
CREATE TABLE public.project_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  requested_role app_role NOT NULL DEFAULT 'viewer',
  company_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, user_id)
);

ALTER TABLE public.project_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own join requests"
ON public.project_join_requests FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Project admins can view join requests"
ON public.project_join_requests FOR SELECT
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Authenticated users can create join requests"
ON public.project_join_requests FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Project admins can update join requests"
ON public.project_join_requests FOR UPDATE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can delete join requests"
ON public.project_join_requests FOR DELETE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

-- =============================================
-- 2. project_invites: 프로젝트 초대코드
-- =============================================
CREATE TABLE public.project_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  default_role app_role NOT NULL DEFAULT 'viewer',
  expires_at TIMESTAMPTZ,
  max_uses INT DEFAULT 0,
  use_count INT DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view invites"
ON public.project_invites FOR SELECT
USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Anyone can lookup invite by code"
ON public.project_invites FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Project admins can create invites"
ON public.project_invites FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can update invites"
ON public.project_invites FOR UPDATE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can delete invites"
ON public.project_invites FOR DELETE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

-- =============================================
-- 3. companies: 프로젝트별 업체 관리
-- =============================================
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'contractor',
  name TEXT NOT NULL,
  business_no TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  address TEXT DEFAULT '',
  scope TEXT DEFAULT '',
  period TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view companies"
ON public.companies FOR SELECT
USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Project admins can insert companies"
ON public.companies FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can update companies"
ON public.companies FOR UPDATE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can delete companies"
ON public.companies FOR DELETE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE TRIGGER update_companies_updated_at
BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 4. company_members: 업체별 멤버 매핑
-- =============================================
CREATE TABLE public.company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role_in_company TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, user_id)
);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Helper function for company-project membership check
CREATE OR REPLACE FUNCTION public.is_company_project_member(_user_id uuid, _company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = _company_id
    AND is_project_member(_user_id, c.project_id)
  )
$$;

CREATE POLICY "Project members can view company members"
ON public.company_members FOR SELECT
USING (is_company_project_member(auth.uid(), company_id));

CREATE POLICY "Project admins can insert company members"
ON public.company_members FOR INSERT
WITH CHECK (is_company_project_member(auth.uid(), company_id));

CREATE POLICY "Project admins can update company members"
ON public.company_members FOR UPDATE
USING (is_company_project_member(auth.uid(), company_id));

CREATE POLICY "Project admins can delete company members"
ON public.company_members FOR DELETE
USING (is_company_project_member(auth.uid(), company_id));

-- =============================================
-- 5. department_assignees: 부서-담당자 매핑
-- =============================================
CREATE TABLE public.department_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.master_departments(id) ON DELETE CASCADE,
  default_user_id UUID,
  backup_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, department_id)
);

ALTER TABLE public.department_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view dept assignees"
ON public.department_assignees FOR SELECT
USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Project admins can insert dept assignees"
ON public.department_assignees FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can update dept assignees"
ON public.department_assignees FOR UPDATE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE POLICY "Project admins can delete dept assignees"
ON public.department_assignees FOR DELETE
USING (
  has_role(auth.uid(), 'master'::app_role)
  OR get_project_role(project_id, auth.uid()) = 'project_admin'::app_role
);

CREATE TRIGGER update_dept_assignees_updated_at
BEFORE UPDATE ON public.department_assignees
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 6. Update projects SELECT: allow all authenticated users to see projects (for join flow)
-- =============================================
DROP POLICY IF EXISTS "Members can view projects" ON public.projects;
CREATE POLICY "Authenticated users can view projects"
ON public.projects FOR SELECT
USING (auth.uid() IS NOT NULL);
