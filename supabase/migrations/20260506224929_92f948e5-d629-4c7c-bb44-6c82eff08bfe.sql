
CREATE TABLE public.safety_inspections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  company_id UUID,
  inspection_type TEXT NOT NULL DEFAULT 'pre_work',
  process_category TEXT NOT NULL DEFAULT '',
  inspector_id UUID,
  inspector_name TEXT NOT NULL DEFAULT '',
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  location TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.safety_inspection_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id UUID NOT NULL REFERENCES public.safety_inspections(id) ON DELETE CASCADE,
  checklist_code TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  legal_basis TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'pass',
  note TEXT NOT NULL DEFAULT '',
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.safety_inspection_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id UUID NOT NULL REFERENCES public.safety_inspections(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.safety_inspection_items(id) ON DELETE SET NULL,
  project_id UUID NOT NULL,
  issue TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'medium',
  assignee_id UUID,
  assignee_name TEXT NOT NULL DEFAULT '',
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'pending',
  evidence_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  completed_by UUID,
  completion_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_safety_inspections_project ON public.safety_inspections(project_id, inspected_at DESC);
CREATE INDEX idx_safety_inspection_items_insp ON public.safety_inspection_items(inspection_id);
CREATE INDEX idx_safety_inspection_actions_project ON public.safety_inspection_actions(project_id, status);

ALTER TABLE public.safety_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_inspection_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view inspections" ON public.safety_inspections FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert inspections" ON public.safety_inspections FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update inspections" ON public.safety_inspections FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete inspections" ON public.safety_inspections FOR DELETE TO authenticated USING (is_admin(auth.uid()));

CREATE POLICY "Members can view insp items" ON public.safety_inspection_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.safety_inspections s WHERE s.id = inspection_id AND is_project_member(auth.uid(), s.project_id)));
CREATE POLICY "Members can insert insp items" ON public.safety_inspection_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.safety_inspections s WHERE s.id = inspection_id AND is_project_member(auth.uid(), s.project_id)));
CREATE POLICY "Members can update insp items" ON public.safety_inspection_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.safety_inspections s WHERE s.id = inspection_id AND is_project_member(auth.uid(), s.project_id)));
CREATE POLICY "Members can delete insp items" ON public.safety_inspection_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.safety_inspections s WHERE s.id = inspection_id AND is_project_member(auth.uid(), s.project_id)));

CREATE POLICY "Members can view insp actions" ON public.safety_inspection_actions FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert insp actions" ON public.safety_inspection_actions FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update insp actions" ON public.safety_inspection_actions FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete insp actions" ON public.safety_inspection_actions FOR DELETE TO authenticated USING (is_admin(auth.uid()));

CREATE TRIGGER trg_safety_inspections_updated BEFORE UPDATE ON public.safety_inspections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_safety_inspection_actions_updated BEFORE UPDATE ON public.safety_inspection_actions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
