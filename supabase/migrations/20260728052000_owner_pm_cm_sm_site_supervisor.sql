-- Expand project_position for 발주처 PM/CM/SM and split 감리 vs 관리감독자.

DO $$ BEGIN
  ALTER TYPE public.project_position ADD VALUE IF NOT EXISTS 'OWNER_CM';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.project_position ADD VALUE IF NOT EXISTS 'OWNER_SM';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.project_position ADD VALUE IF NOT EXISTS 'SITE_SUPERVISOR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- OWNER_HSE (legacy «발주처 안전») → OWNER_SM
UPDATE public.project_members
SET position_new = 'OWNER_SM'::public.project_position
WHERE position_new = 'OWNER_HSE'::public.project_position;

-- Signup position mapper: accept new codes
CREATE OR REPLACE FUNCTION public.map_signup_position(_raw text)
RETURNS public.project_position
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF _raw IS NULL OR btrim(_raw) = '' THEN
    RETURN 'WORKER'::public.project_position;
  END IF;
  RETURN CASE lower(btrim(_raw))
    WHEN 'site_manager' THEN 'SITE_MANAGER'::public.project_position
    WHEN 'safety_manager' THEN 'HSE_MANAGER'::public.project_position
    WHEN 'supervisor' THEN 'SUPERVISOR'::public.project_position
    WHEN 'site_supervisor' THEN 'SITE_SUPERVISOR'::public.project_position
    WHEN 'foreman' THEN 'FOREMAN'::public.project_position
    WHEN 'worker' THEN 'WORKER'::public.project_position
    WHEN 'inspector' THEN 'SUPERVISOR'::public.project_position
    WHEN 'owner_pm' THEN 'OWNER_PM'::public.project_position
    WHEN 'owner_cm' THEN 'OWNER_CM'::public.project_position
    WHEN 'owner_sm' THEN 'OWNER_SM'::public.project_position
    WHEN 'owner_hse' THEN 'OWNER_SM'::public.project_position
    WHEN 'other' THEN 'WORKER'::public.project_position
    ELSE
      CASE
        WHEN upper(_raw) IN (
          'SITE_MANAGER','HSE_MANAGER','CONSTRUCTION_MGR','FIELD_ENGINEER',
          'FOREMAN','WORKER','OWNER_PM','OWNER_CM','OWNER_SM','OWNER_HSE',
          'SUPERVISOR','SITE_SUPERVISOR','CEO','EXECUTIVE'
        ) THEN
          CASE upper(_raw)
            WHEN 'OWNER_HSE' THEN 'OWNER_SM'::public.project_position
            ELSE upper(_raw)::public.project_position
          END
        ELSE 'WORKER'::public.project_position
      END
  END;
END;
$$;
