
CREATE TABLE public.dismissed_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  gap_key text NOT NULL,
  dismissed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, run_id, gap_key)
);

ALTER TABLE public.dismissed_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view dismissed" ON public.dismissed_recommendations
  FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Members can insert dismissed" ON public.dismissed_recommendations
  FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));

CREATE POLICY "Members can delete dismissed" ON public.dismissed_recommendations
  FOR DELETE TO authenticated USING (is_project_member(auth.uid(), project_id));
