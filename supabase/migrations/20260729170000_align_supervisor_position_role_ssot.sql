-- Align 관리감독자 / 감리 role ↔ position SSOT across all project_members.
-- SITE_SUPERVISOR ↔ site_supervisor
-- SUPERVISOR (감리) ↔ supervisor
--
-- Historical drift: role_new = site_supervisor but position_new left as
-- CONSTRUCTION_MGR / FIELD_ENGINEER etc. broke work-permit step-1 filters
-- that require SITE_SUPERVISOR.

-- 1) role says 관리감독자 → force canonical position
UPDATE public.project_members
SET position_new = 'SITE_SUPERVISOR'::public.project_position
WHERE role_new::text = 'site_supervisor'
  AND position_new IS DISTINCT FROM 'SITE_SUPERVISOR'::public.project_position;

-- 2) position says 관리감독자 → force canonical role
UPDATE public.project_members
SET role_new = 'site_supervisor'::public.project_role
WHERE position_new::text = 'SITE_SUPERVISOR'
  AND role_new IS DISTINCT FROM 'site_supervisor'::public.project_role;

-- 3) role says 감리 → force canonical position
UPDATE public.project_members
SET position_new = 'SUPERVISOR'::public.project_position
WHERE role_new::text = 'supervisor'
  AND position_new IS DISTINCT FROM 'SUPERVISOR'::public.project_position;

-- 4) position says 감리 → force canonical role
UPDATE public.project_members
SET role_new = 'supervisor'::public.project_role
WHERE position_new::text = 'SUPERVISOR'
  AND role_new IS DISTINCT FROM 'supervisor'::public.project_role;

-- Signup mapper: recognize SITE_SUPERVISOR / site_supervisor aliases
CREATE OR REPLACE FUNCTION public.map_signup_position(_raw text)
RETURNS public.project_position
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(_raw, ''))
    WHEN 'site_manager' THEN 'SITE_MANAGER'::public.project_position
    WHEN 'safety_manager' THEN 'HSE_MANAGER'::public.project_position
    WHEN 'site_supervisor' THEN 'SITE_SUPERVISOR'::public.project_position
    WHEN '관리감독자' THEN 'SITE_SUPERVISOR'::public.project_position
    WHEN 'supervisor' THEN 'SUPERVISOR'::public.project_position
    WHEN '감리' THEN 'SUPERVISOR'::public.project_position
    WHEN 'foreman' THEN 'FOREMAN'::public.project_position
    WHEN 'worker' THEN 'WORKER'::public.project_position
    WHEN 'inspector' THEN 'SUPERVISOR'::public.project_position
    WHEN 'other' THEN 'WORKER'::public.project_position
    ELSE
      CASE
        WHEN upper(_raw) IN (
          'SITE_MANAGER','HSE_MANAGER','CONSTRUCTION_MGR','FIELD_ENGINEER',
          'FOREMAN','WORKER','OWNER_PM','OWNER_CM','OWNER_SM','OWNER_HSE',
          'SUPERVISOR','SITE_SUPERVISOR','CEO','EXECUTIVE'
        ) THEN upper(_raw)::public.project_position
        ELSE 'WORKER'::public.project_position
      END
  END;
$$;
