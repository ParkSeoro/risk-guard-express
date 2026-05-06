
ALTER TABLE public.work_permits
  ADD COLUMN IF NOT EXISTS permit_type TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS signatures JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS work_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS personnel_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extension_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contractor_company TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS dig_company TEXT NOT NULL DEFAULT 'DIG 에어가스(주)';

CREATE TABLE IF NOT EXISTS public.inspection_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
  inspector_org TEXT NOT NULL DEFAULT '',
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  pdf_url TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.inspection_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view inspection_responses" ON public.inspection_responses FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert inspection_responses" ON public.inspection_responses FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update inspection_responses" ON public.inspection_responses FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete inspection_responses" ON public.inspection_responses FOR DELETE TO authenticated USING (is_admin(auth.uid()));
CREATE TRIGGER update_inspection_responses_updated_at BEFORE UPDATE ON public.inspection_responses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
