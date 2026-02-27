
-- Add account_status to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'pending';

-- Create assessment_runs table
CREATE TABLE public.assessment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT '정기',
  period_label text NOT NULL DEFAULT '',
  target_processes text[] DEFAULT ARRAY[]::text[],
  target_contractors text[] DEFAULT ARRAY[]::text[],
  notes text DEFAULT '',
  status text NOT NULL DEFAULT '작성중',
  validation_score integer,
  validation_verdict text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assessment_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view runs" ON public.assessment_runs FOR SELECT USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert runs" ON public.assessment_runs FOR INSERT WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update runs" ON public.assessment_runs FOR UPDATE USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete runs" ON public.assessment_runs FOR DELETE USING (is_admin(auth.uid()));

CREATE TRIGGER update_assessment_runs_updated_at
  BEFORE UPDATE ON public.assessment_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create assessment_run_participants table
CREATE TABLE public.assessment_run_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT '',
  user_name text DEFAULT '',
  company text DEFAULT '',
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.assessment_run_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view participants" ON public.assessment_run_participants FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.assessment_runs ar WHERE ar.id = run_id AND is_project_member(auth.uid(), ar.project_id))
);
CREATE POLICY "Members can insert participants" ON public.assessment_run_participants FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.assessment_runs ar WHERE ar.id = run_id AND is_project_member(auth.uid(), ar.project_id))
);
CREATE POLICY "Members can update participants" ON public.assessment_run_participants FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.assessment_runs ar WHERE ar.id = run_id AND is_project_member(auth.uid(), ar.project_id))
);
CREATE POLICY "Members can delete participants" ON public.assessment_run_participants FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.assessment_runs ar WHERE ar.id = run_id AND is_project_member(auth.uid(), ar.project_id))
);

-- Add run_id to risk_items
ALTER TABLE public.risk_items ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.assessment_runs(id) ON DELETE SET NULL;

-- Add run_id to approvals
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.assessment_runs(id) ON DELETE SET NULL;

-- Add run_id to validation_results
ALTER TABLE public.validation_results ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.assessment_runs(id) ON DELETE SET NULL;

-- Update existing profiles to active
UPDATE public.profiles SET account_status = 'active' WHERE account_status = 'pending';
