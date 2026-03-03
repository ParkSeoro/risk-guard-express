
-- Add exclusion fields to risk_items for "해당없음" processing
ALTER TABLE public.risk_items 
ADD COLUMN IF NOT EXISTS is_excluded boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS excluded_reason text DEFAULT '',
ADD COLUMN IF NOT EXISTS excluded_at timestamp with time zone DEFAULT NULL,
ADD COLUMN IF NOT EXISTS excluded_by uuid DEFAULT NULL;

-- Add environment/equipment tag master tables for auto-generation
CREATE TABLE IF NOT EXISTS public.environment_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'environment',
  sort_order integer DEFAULT 0,
  is_default boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.environment_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view env tags" ON public.environment_tags
FOR SELECT USING (project_id IS NULL OR is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can manage env tags" ON public.environment_tags
FOR ALL USING (is_admin(auth.uid()));
