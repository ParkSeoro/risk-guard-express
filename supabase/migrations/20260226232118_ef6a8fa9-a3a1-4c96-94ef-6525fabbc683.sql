
-- ============================================
-- 1. UTILITY FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ============================================
-- 2. PROFILES
-- ============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT DEFAULT '',
  company TEXT DEFAULT '',
  position TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 3. ROLES (RBAC)
-- ============================================
CREATE TYPE public.app_role AS ENUM ('master', 'project_admin', 'safety_manager', 'contractor', 'viewer');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('master', 'project_admin'))
$$;

CREATE POLICY "Anyone can read roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Masters can manage roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'master'));
CREATE POLICY "Masters can update roles" ON public.user_roles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'master'));
CREATE POLICY "Masters can delete roles" ON public.user_roles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'master'));

-- ============================================
-- 4. PROJECTS
-- ============================================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  site_name TEXT NOT NULL DEFAULT '',
  period_start DATE,
  period_end DATE,
  client TEXT DEFAULT '',
  contractor TEXT DEFAULT '',
  subcontractors TEXT[] DEFAULT ARRAY[]::TEXT[],
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT '진행중',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 5. PROJECT MEMBERS
-- ============================================
CREATE TABLE public.project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'viewer',
  company TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_project_member(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.project_members WHERE user_id = _user_id AND project_id = _project_id)
  OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'master')
$$;

CREATE OR REPLACE FUNCTION public.get_project_role(_user_id UUID, _project_id UUID)
RETURNS app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role FROM public.project_members WHERE user_id = _user_id AND project_id = _project_id LIMIT 1),
    (SELECT CASE WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'master') THEN 'master'::app_role ELSE 'viewer'::app_role END)
  )
$$;

CREATE POLICY "Members can view projects" ON public.projects FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), id) OR public.has_role(auth.uid(), 'master'));
CREATE POLICY "Admins can create projects" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'master'));
CREATE POLICY "Admins can update projects" ON public.projects FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_project_member(auth.uid(), id));
CREATE POLICY "Masters can delete projects" ON public.projects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Members can view project members" ON public.project_members FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can insert project members" ON public.project_members FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update project members" ON public.project_members FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete project members" ON public.project_members FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- ============================================
-- 6. MASTER DATA TABLES
-- ============================================
CREATE TABLE public.master_processes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.master_processes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view processes" ON public.master_processes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert processes" ON public.master_processes FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update processes" ON public.master_processes FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete processes" ON public.master_processes FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE public.master_ppe (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.master_ppe ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view PPE" ON public.master_ppe FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert PPE" ON public.master_ppe FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update PPE" ON public.master_ppe FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete PPE" ON public.master_ppe FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE public.master_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.master_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view departments" ON public.master_departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert departments" ON public.master_departments FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update departments" ON public.master_departments FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete departments" ON public.master_departments FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE TABLE public.master_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES public.master_departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  position TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.master_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view assignees" ON public.master_assignees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert assignees" ON public.master_assignees FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update assignees" ON public.master_assignees FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete assignees" ON public.master_assignees FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- ============================================
-- 7. LEGAL REFERENCES
-- ============================================
CREATE TABLE public.legal_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  law_name TEXT NOT NULL,
  article TEXT NOT NULL,
  description TEXT DEFAULT '',
  keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  process_mappings TEXT[] DEFAULT ARRAY[]::TEXT[],
  link TEXT DEFAULT '',
  revision_date DATE,
  needs_review BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.legal_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view legal refs" ON public.legal_references FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert legal refs" ON public.legal_references FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update legal refs" ON public.legal_references FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete legal refs" ON public.legal_references FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER update_legal_refs_updated_at BEFORE UPDATE ON public.legal_references FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 8. RISK TEMPLATES
-- ============================================
CREATE TABLE public.risk_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_keyword TEXT NOT NULL,
  sub_task TEXT NOT NULL,
  hazard TEXT NOT NULL,
  hazard_situation TEXT NOT NULL,
  existing_measure TEXT DEFAULT '',
  improvement_measure TEXT DEFAULT '',
  frequency INT NOT NULL DEFAULT 3,
  severity INT NOT NULL DEFAULT 3,
  improved_frequency INT NOT NULL DEFAULT 2,
  improved_severity INT NOT NULL DEFAULT 3,
  ppe TEXT[] DEFAULT ARRAY[]::TEXT[],
  legal_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  department TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.risk_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view templates" ON public.risk_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert templates" ON public.risk_templates FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Admins can update templates" ON public.risk_templates FOR UPDATE TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can delete templates" ON public.risk_templates FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));
CREATE TRIGGER update_risk_templates_updated_at BEFORE UPDATE ON public.risk_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 9. RISK ITEMS
-- ============================================
CREATE TABLE public.risk_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  process TEXT NOT NULL,
  sub_task TEXT DEFAULT '',
  hazard TEXT DEFAULT '',
  hazard_situation TEXT DEFAULT '',
  existing_measure TEXT DEFAULT '',
  improvement_measure TEXT DEFAULT '',
  frequency INT NOT NULL DEFAULT 1,
  severity INT NOT NULL DEFAULT 1,
  risk INT GENERATED ALWAYS AS (frequency * severity) STORED,
  improved_frequency INT NOT NULL DEFAULT 1,
  improved_severity INT NOT NULL DEFAULT 1,
  improved_risk INT GENERATED ALWAYS AS (improved_frequency * improved_severity) STORED,
  status TEXT NOT NULL DEFAULT '미착수',
  ppe TEXT[] DEFAULT ARRAY[]::TEXT[],
  legal_basis TEXT[] DEFAULT ARRAY[]::TEXT[],
  department TEXT DEFAULT '',
  assignee TEXT DEFAULT '',
  note TEXT DEFAULT '',
  sort_order INT DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.risk_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_risk_items_project ON public.risk_items(project_id);
CREATE TRIGGER update_risk_items_updated_at BEFORE UPDATE ON public.risk_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Members can view risk items" ON public.risk_items FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Non-viewers can insert risk items" ON public.risk_items FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Non-viewers can update risk items" ON public.risk_items FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete risk items" ON public.risk_items FOR DELETE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

-- ============================================
-- 10. APPROVALS
-- ============================================
CREATE TABLE public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  risk_item_id UUID REFERENCES public.risk_items(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '대기',
  approver_id UUID REFERENCES auth.users(id),
  approver_name TEXT DEFAULT '',
  comment TEXT DEFAULT '',
  version INT DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_approvals_updated_at BEFORE UPDATE ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Members can view approvals" ON public.approvals FOR SELECT TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert approvals" ON public.approvals FOR INSERT TO authenticated
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update approvals" ON public.approvals FOR UPDATE TO authenticated
  USING (public.is_project_member(auth.uid(), project_id));

-- ============================================
-- 11. AUDIT LOGS
-- ============================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT DEFAULT '',
  target_id TEXT DEFAULT '',
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "System can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================
-- 12. ATTACHMENTS STORAGE
-- ============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false);

CREATE POLICY "Authenticated can upload attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attachments');
CREATE POLICY "Authenticated can view attachments" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attachments');
CREATE POLICY "Owner can delete attachments" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);
