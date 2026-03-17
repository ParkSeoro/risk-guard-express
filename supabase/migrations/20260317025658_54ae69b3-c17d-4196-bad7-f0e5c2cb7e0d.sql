
-- Add start_date and end_date to assessment_runs for per-run period
ALTER TABLE public.assessment_runs ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.assessment_runs ADD COLUMN IF NOT EXISTS end_date date;

-- Add position to project_members for company+position based roles
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS position text DEFAULT '';
