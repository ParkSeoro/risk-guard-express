
-- Add new columns to work_plans
ALTER TABLE public.work_plans
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.work_plans(id),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

-- Create index for parent lookups
CREATE INDEX IF NOT EXISTS idx_work_plans_parent_id ON public.work_plans(parent_id);
