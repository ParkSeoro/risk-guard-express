
-- Add soft-delete columns to assessment_runs
ALTER TABLE public.assessment_runs
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_reason text DEFAULT '',
  ADD COLUMN IF NOT EXISTS deleted_by uuid;
