
ALTER TABLE public.approvals 
  ADD COLUMN IF NOT EXISTS position text DEFAULT '',
  ADD COLUMN IF NOT EXISTS company_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS company_name text DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone DEFAULT NULL;
