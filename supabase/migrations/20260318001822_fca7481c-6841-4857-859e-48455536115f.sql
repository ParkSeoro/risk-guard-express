
CREATE TABLE public.approval_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 0,
  step_label text NOT NULL DEFAULT '',
  position text NOT NULL DEFAULT '',
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  user_id uuid,
  user_name text DEFAULT '',
  company_name text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.approval_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view approval lines"
  ON public.approval_lines FOR SELECT
  TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can insert approval lines"
  ON public.approval_lines FOR INSERT
  TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can update approval lines"
  ON public.approval_lines FOR UPDATE
  TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can delete approval lines"
  ON public.approval_lines FOR DELETE
  TO authenticated
  USING (is_project_member(auth.uid(), project_id));
