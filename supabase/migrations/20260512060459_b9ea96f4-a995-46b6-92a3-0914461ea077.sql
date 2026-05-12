
-- ============================================================
-- Phase 1: Permission Structure Redesign — Non-destructive additions
-- (enums / functions / nullable columns only; no drops yet)
-- ============================================================

-- 1) New enums (separate global vs project, formalize positions)
DO $$ BEGIN
  CREATE TYPE public.global_role AS ENUM ('master');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_role AS ENUM (
    'project_admin',
    'safety_manager',
    'site_manager',
    'supervisor',
    'worker',
    'viewer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_position AS ENUM (
    'CEO',
    'EXECUTIVE',
    'SITE_MANAGER',
    'HSE_MANAGER',
    'CONSTRUCTION_MGR',
    'FIELD_ENGINEER',
    'FOREMAN',
    'WORKER',
    'OWNER_PM',
    'OWNER_HSE',
    'SUPERVISOR'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Add new columns (nullable so we can backfill safely)
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS role_new public.project_role,
  ADD COLUMN IF NOT EXISTS position_new public.project_position;

-- 3) Helper functions (all SECURITY DEFINER, search_path = public)

-- is_master: global role check (replaces has_role(uid,'master'))
CREATE OR REPLACE FUNCTION public.is_master(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'master'::app_role
  )
$$;

-- get_project_role_new: returns new project_role enum
CREATE OR REPLACE FUNCTION public.get_project_role_new(_user_id uuid, _project_id uuid)
RETURNS public.project_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role_new
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1
$$;

-- has_project_role: check whether user has any of the given roles in a project
CREATE OR REPLACE FUNCTION public.has_project_role(
  _user_id uuid,
  _project_id uuid,
  _roles public.project_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.project_members
      WHERE user_id = _user_id
        AND project_id = _project_id
        AND role_new = ANY(_roles)
    )
$$;

-- get_user_company_id: caller's company in a project
CREATE OR REPLACE FUNCTION public.get_user_company_id(_user_id uuid, _project_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1
$$;

-- can_access_company_data: per agreed rule
--   master / project_admin / safety_manager           → all companies in project
--   site_manager / supervisor                          → own company + descendants via parent_company_id
--   worker / viewer                                    → own company only
CREATE OR REPLACE FUNCTION public.can_access_company_data(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.project_role;
  _own_company uuid;
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  SELECT role_new, company_id
    INTO _role, _own_company
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;

  -- Full access roles
  IF _role IN ('project_admin','safety_manager') THEN
    RETURN true;
  END IF;

  -- No company filter target means deny for restricted roles
  IF _company_id IS NULL OR _own_company IS NULL THEN
    RETURN false;
  END IF;

  -- Own company always allowed
  IF _company_id = _own_company THEN
    RETURN true;
  END IF;

  -- site_manager / supervisor: include descendants via parent_company_id tree
  IF _role IN ('site_manager','supervisor') THEN
    RETURN EXISTS (
      WITH RECURSIVE tree AS (
        SELECT id, parent_company_id
          FROM public.companies
         WHERE id = _own_company
        UNION ALL
        SELECT c.id, c.parent_company_id
          FROM public.companies c
          JOIN tree t ON c.parent_company_id = t.id
      )
      SELECT 1 FROM tree WHERE id = _company_id
    );
  END IF;

  -- worker / viewer: own company only (already returned above)
  RETURN false;
END;
$$;

-- get_user_position: enum-typed position lookup
CREATE OR REPLACE FUNCTION public.get_user_position(_user_id uuid, _project_id uuid)
RETURNS public.project_position
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT position_new
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1
$$;

-- 4) Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_pm_role_new ON public.project_members(project_id, role_new);
CREATE INDEX IF NOT EXISTS idx_pm_company_role ON public.project_members(project_id, company_id, role_new);

-- 5) Staging table for unmapped members during migration
CREATE TABLE IF NOT EXISTS public.migration_unmapped_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_member_id uuid REFERENCES public.project_members(id) ON DELETE CASCADE,
  user_id uuid,
  project_id uuid,
  raw_company_text text,
  raw_role text,
  raw_position text,
  reason text,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.migration_unmapped_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Masters can manage unmapped" ON public.migration_unmapped_members;
CREATE POLICY "Masters can manage unmapped"
  ON public.migration_unmapped_members
  FOR ALL
  TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));
