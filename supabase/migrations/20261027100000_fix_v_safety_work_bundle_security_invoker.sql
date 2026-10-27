-- Fix Supabase Advisor Critical Security Warning:
-- View public.v_safety_work_bundle was created without security_invoker = true,
-- triggering the SECURITY DEFINER view alert.
-- Setting security_invoker = true ensures row-level security (RLS) on underlying tables
-- (work_permits, assessment_runs, tbm_sessions, work_plans) is honored for the invoking user.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'v_safety_work_bundle'
  ) THEN
    ALTER VIEW public.v_safety_work_bundle SET (security_invoker = true);
  END IF;
END $$;
