-- Split project_role: supervisor(감리) vs site_supervisor(관리감독자)
-- Enum ADD VALUE only — cannot use new label in same transaction.

DO $$ BEGIN
  ALTER TYPE public.project_role ADD VALUE IF NOT EXISTS 'site_supervisor';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
