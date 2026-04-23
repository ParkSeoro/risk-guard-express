-- Industrial Safety and Health Management Cost module
-- Extends the existing project/company structure without changing existing tables.

CREATE OR REPLACE FUNCTION public.can_access_safety_cost(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid,
  _write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text;
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(_user_id, 'master'::app_role) THEN
    RETURN true;
  END IF;

  _role := public.get_project_role(_user_id, _project_id)::text;

  IF _role IN ('master', 'project_admin', 'safety_manager') THEN
    RETURN true;
  END IF;

  IF _write AND _role = 'viewer' THEN
    RETURN false;
  END IF;

  IF _company_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.user_id = _user_id
      AND pm.project_id = _project_id
      AND pm.company_id = _company_id
  );
END;
$$;

CREATE TABLE public.safety_cost_constructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  construction_name text NOT NULL DEFAULT '',
  construction_type text NOT NULL DEFAULT '',
  construction_amount numeric NOT NULL DEFAULT 0,
  safety_cost_total numeric NOT NULL DEFAULT 0,
  basis_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.safety_cost_monthly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  construction_id uuid NOT NULL REFERENCES public.safety_cost_constructions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  report_month date NOT NULL,
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  report_total numeric NOT NULL DEFAULT 0,
  submitted_by uuid,
  submitted_at timestamp with time zone,
  approved_by uuid,
  approved_at timestamp with time zone,
  rejected_reason text NOT NULL DEFAULT '',
  approval_version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (construction_id, report_month, approval_version)
);

CREATE TABLE public.safety_cost_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.safety_cost_monthly_reports(id) ON DELETE CASCADE,
  construction_id uuid NOT NULL REFERENCES public.safety_cost_constructions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  usage_date date,
  category_code text NOT NULL DEFAULT '',
  category_name text NOT NULL DEFAULT '',
  item_name text NOT NULL DEFAULT '',
  specification text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '',
  unit_price numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  classification_status text NOT NULL DEFAULT 'review',
  ai_confidence numeric,
  ai_reason text NOT NULL DEFAULT '',
  legal_basis text NOT NULL DEFAULT '',
  review_comment text NOT NULL DEFAULT '',
  source_file_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.safety_cost_evidence_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.safety_cost_monthly_reports(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.safety_cost_items(id) ON DELETE CASCADE,
  construction_id uuid NOT NULL REFERENCES public.safety_cost_constructions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evidence_kind text NOT NULL DEFAULT 'transaction',
  file_name text NOT NULL DEFAULT '',
  file_path text NOT NULL DEFAULT '',
  file_url text NOT NULL DEFAULT '',
  mime_type text NOT NULL DEFAULT '',
  file_size bigint NOT NULL DEFAULT 0,
  file_hash text NOT NULL DEFAULT '',
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.safety_cost_approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.safety_cost_monthly_reports(id) ON DELETE CASCADE,
  construction_id uuid NOT NULL REFERENCES public.safety_cost_constructions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 0,
  step_label text NOT NULL DEFAULT '',
  position text NOT NULL DEFAULT '',
  approver_id uuid,
  approver_name text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  comment text NOT NULL DEFAULT '',
  approved_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.safety_cost_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  construction_id uuid REFERENCES public.safety_cost_constructions(id) ON DELETE SET NULL,
  report_id uuid REFERENCES public.safety_cost_monthly_reports(id) ON DELETE SET NULL,
  item_id uuid REFERENCES public.safety_cost_items(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL DEFAULT '',
  target_id uuid,
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL DEFAULT '',
  user_id uuid,
  user_name text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_safety_cost_constructions_project_company ON public.safety_cost_constructions(project_id, company_id);
CREATE INDEX idx_safety_cost_reports_construction_month ON public.safety_cost_monthly_reports(construction_id, report_month);
CREATE INDEX idx_safety_cost_reports_status ON public.safety_cost_monthly_reports(project_id, company_id, status);
CREATE INDEX idx_safety_cost_items_report ON public.safety_cost_items(report_id, sort_order);
CREATE INDEX idx_safety_cost_items_category ON public.safety_cost_items(project_id, company_id, category_code);
CREATE INDEX idx_safety_cost_evidence_item ON public.safety_cost_evidence_files(item_id);
CREATE INDEX idx_safety_cost_approval_report ON public.safety_cost_approval_steps(report_id, step_order);
CREATE INDEX idx_safety_cost_audit_report ON public.safety_cost_audit_logs(report_id, created_at DESC);

CREATE TRIGGER update_safety_cost_constructions_updated_at
BEFORE UPDATE ON public.safety_cost_constructions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_safety_cost_monthly_reports_updated_at
BEFORE UPDATE ON public.safety_cost_monthly_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_safety_cost_items_updated_at
BEFORE UPDATE ON public.safety_cost_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_safety_cost_evidence_files_updated_at
BEFORE UPDATE ON public.safety_cost_evidence_files
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_safety_cost_approval_steps_updated_at
BEFORE UPDATE ON public.safety_cost_approval_steps
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.safety_cost_constructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_cost_monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_cost_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_cost_evidence_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_cost_approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_cost_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Safety cost constructions view access"
ON public.safety_cost_constructions
FOR SELECT TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

CREATE POLICY "Safety cost constructions create access"
ON public.safety_cost_constructions
FOR INSERT TO authenticated
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost constructions update access"
ON public.safety_cost_constructions
FOR UPDATE TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost constructions delete admin access"
ON public.safety_cost_constructions
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'master'::app_role) OR public.get_project_role(auth.uid(), project_id)::text = 'project_admin');

CREATE POLICY "Safety cost monthly reports view access"
ON public.safety_cost_monthly_reports
FOR SELECT TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

CREATE POLICY "Safety cost monthly reports create access"
ON public.safety_cost_monthly_reports
FOR INSERT TO authenticated
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost monthly reports update access"
ON public.safety_cost_monthly_reports
FOR UPDATE TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost monthly reports delete admin access"
ON public.safety_cost_monthly_reports
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'master'::app_role) OR public.get_project_role(auth.uid(), project_id)::text = 'project_admin');

CREATE POLICY "Safety cost items view access"
ON public.safety_cost_items
FOR SELECT TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

CREATE POLICY "Safety cost items create access"
ON public.safety_cost_items
FOR INSERT TO authenticated
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost items update access"
ON public.safety_cost_items
FOR UPDATE TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost items delete access"
ON public.safety_cost_items
FOR DELETE TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost evidence files view access"
ON public.safety_cost_evidence_files
FOR SELECT TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

CREATE POLICY "Safety cost evidence files create access"
ON public.safety_cost_evidence_files
FOR INSERT TO authenticated
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost evidence files update access"
ON public.safety_cost_evidence_files
FOR UPDATE TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true))
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost evidence files delete access"
ON public.safety_cost_evidence_files
FOR DELETE TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost approval steps view access"
ON public.safety_cost_approval_steps
FOR SELECT TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

CREATE POLICY "Safety cost approval steps create access"
ON public.safety_cost_approval_steps
FOR INSERT TO authenticated
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));

CREATE POLICY "Safety cost approval steps update approver access"
ON public.safety_cost_approval_steps
FOR UPDATE TO authenticated
USING (
  approver_id = auth.uid()
  OR public.has_role(auth.uid(), 'master'::app_role)
  OR public.get_project_role(auth.uid(), project_id)::text IN ('project_admin', 'safety_manager')
)
WITH CHECK (
  approver_id = auth.uid()
  OR public.has_role(auth.uid(), 'master'::app_role)
  OR public.get_project_role(auth.uid(), project_id)::text IN ('project_admin', 'safety_manager')
);

CREATE POLICY "Safety cost approval steps delete admin access"
ON public.safety_cost_approval_steps
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'master'::app_role) OR public.get_project_role(auth.uid(), project_id)::text = 'project_admin');

CREATE POLICY "Safety cost audit logs view access"
ON public.safety_cost_audit_logs
FOR SELECT TO authenticated
USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));

CREATE POLICY "Safety cost audit logs create access"
ON public.safety_cost_audit_logs
FOR INSERT TO authenticated
WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));