-- SafeNex: 안관비 월별 내역서 — 공사+월당 살아있는 건 1개만.
-- Paste into SQL Editor and Run once.
--
-- 증상: 월별 사용내역서 생성 시
--   duplicate key value violates unique constraint "safety_cost_monthly_reports_construction_id_report_..."
-- 원인: UNIQUE (construction_id, report_month, approval_version) 가
--   삭제된 행까지 포함해 같은 월 INSERT 를 막음.
-- 앱은 기존 건을 열거나 삭제 건을 복구함. 이 인덱스는 DB 쪽도 맞춤.

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
