-- One live monthly usage statement per construction + month.
-- Soft-deleted rows must not block recreate. Unique used to include
-- approval_version and ignored is_deleted, so "월별 작성" INSERT failed with
-- duplicate key when August already existed (live or deleted).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'safety_cost_monthly_reports'
       AND c.contype = 'u'
       AND pg_get_constraintdef(c.oid) ILIKE '%construction_id%'
       AND pg_get_constraintdef(c.oid) ILIKE '%report_month%'
  LOOP
    EXECUTE format('ALTER TABLE public.safety_cost_monthly_reports DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DROP INDEX IF EXISTS public.safety_cost_monthly_reports_live_construction_month_uidx;

CREATE UNIQUE INDEX safety_cost_monthly_reports_live_construction_month_uidx
  ON public.safety_cost_monthly_reports (construction_id, report_month)
  WHERE COALESCE(is_deleted, false) = false;
