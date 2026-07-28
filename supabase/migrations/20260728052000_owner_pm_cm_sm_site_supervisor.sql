-- Expand project_position enum values only.
-- NOTE: Newly added enum labels cannot be used in the SAME transaction
-- (PostgreSQL). Data backfill + function updates are in the next migration.

DO $$ BEGIN
  ALTER TYPE public.project_position ADD VALUE IF NOT EXISTS 'OWNER_CM';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.project_position ADD VALUE IF NOT EXISTS 'OWNER_SM';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.project_position ADD VALUE IF NOT EXISTS 'SITE_SUPERVISOR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
