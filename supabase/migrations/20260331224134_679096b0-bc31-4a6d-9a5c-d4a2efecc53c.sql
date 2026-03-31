
-- 1. Equipment master table (company-level equipment DB)
CREATE TABLE public.equipment_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  rated_capacity numeric,
  manufacturer text DEFAULT '',
  model_name text DEFAULT '',
  is_default boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_equipment_master_project ON public.equipment_master(project_id);
CREATE INDEX idx_equipment_master_company ON public.equipment_master(company_id);

ALTER TABLE public.equipment_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view equipment" ON public.equipment_master
  FOR SELECT TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Members can insert equipment" ON public.equipment_master
  FOR INSERT TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));

CREATE POLICY "Members can update equipment" ON public.equipment_master
  FOR UPDATE TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can delete equipment" ON public.equipment_master
  FOR DELETE TO authenticated
  USING (is_project_member(auth.uid(), project_id));

-- 2. Seed default equipment data (is_default = true, project_id will be set per-project)
-- We'll handle defaults in application code instead since they need project_id
