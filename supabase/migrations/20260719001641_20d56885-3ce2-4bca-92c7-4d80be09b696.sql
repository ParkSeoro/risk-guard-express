
-- Add AI analysis + signature slots to permit_form_templates
ALTER TABLE public.permit_form_templates
  ADD COLUMN IF NOT EXISTS ai_analysis_json jsonb,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signature_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suggested_approval_steps int;
