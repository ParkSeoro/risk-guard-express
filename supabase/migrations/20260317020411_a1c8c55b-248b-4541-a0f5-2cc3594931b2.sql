
-- Create risk_item_feedback table
CREATE TABLE public.risk_item_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  assessment_run_id UUID NOT NULL REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  risk_item_id UUID REFERENCES public.risk_items(id) ON DELETE SET NULL,
  feedback_type TEXT NOT NULL DEFAULT '보완' CHECK (feedback_type IN ('보완', '지적', '개선')),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '미조치' CHECK (status IN ('미조치', '진행중', '완료')),
  before_image_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  after_image_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_by UUID,
  assignee_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.risk_item_feedback ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Members can view feedback"
  ON public.risk_item_feedback FOR SELECT
  TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Members can insert feedback"
  ON public.risk_item_feedback FOR INSERT
  TO authenticated
  WITH CHECK (is_project_member(auth.uid(), project_id));

CREATE POLICY "Members can update feedback"
  ON public.risk_item_feedback FOR UPDATE
  TO authenticated
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can delete feedback"
  ON public.risk_item_feedback FOR DELETE
  TO authenticated
  USING (is_project_member(auth.uid(), project_id));

-- Update trigger
CREATE TRIGGER update_risk_item_feedback_updated_at
  BEFORE UPDATE ON public.risk_item_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
