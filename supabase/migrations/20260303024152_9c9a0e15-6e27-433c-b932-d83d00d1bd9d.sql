
-- Create approval_route_templates table for pre-configured approval lines
CREATE TABLE public.approval_route_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '기본 결재라인',
  assessment_type TEXT NOT NULL DEFAULT '정기',
  is_default BOOLEAN NOT NULL DEFAULT false,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.approval_route_templates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Project members can view templates"
  ON public.approval_route_templates FOR SELECT
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can insert templates"
  ON public.approval_route_templates FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'master'::app_role) OR get_project_role(auth.uid(), project_id) = 'project_admin'::app_role);

CREATE POLICY "Admins can update templates"
  ON public.approval_route_templates FOR UPDATE
  USING (has_role(auth.uid(), 'master'::app_role) OR get_project_role(auth.uid(), project_id) = 'project_admin'::app_role);

CREATE POLICY "Admins can delete templates"
  ON public.approval_route_templates FOR DELETE
  USING (has_role(auth.uid(), 'master'::app_role) OR get_project_role(auth.uid(), project_id) = 'project_admin'::app_role);

-- Add version tracking to approvals for resubmission tracking
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS approval_version INTEGER DEFAULT 1;
