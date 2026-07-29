-- ============================================================
-- Safety work bundle: FK integrity Assessment ↔ Permit ↔ TBM
-- ============================================================

-- 1) Orphan cleanup (SET NULL) so FKs can be added safely
UPDATE public.work_permits wp
   SET assessment_run_id = NULL
 WHERE assessment_run_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.assessment_runs ar WHERE ar.id = wp.assessment_run_id);

UPDATE public.work_permits wp
   SET work_plan_id = NULL
 WHERE work_plan_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_plans p WHERE p.id = wp.work_plan_id);

UPDATE public.work_permits wp
   SET tbm_session_id = NULL
 WHERE tbm_session_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.tbm_sessions t WHERE t.id = wp.tbm_session_id);

UPDATE public.tbm_sessions t
   SET run_id = NULL
 WHERE run_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.assessment_runs ar WHERE ar.id = t.run_id);

UPDATE public.tbm_sessions t
   SET work_plan_id = NULL
 WHERE work_plan_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_plans p WHERE p.id = t.work_plan_id);

-- 2) Foreign keys (ON DELETE SET NULL — preserve child rows)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_permits_assessment_run_id_fkey'
  ) THEN
    ALTER TABLE public.work_permits
      ADD CONSTRAINT work_permits_assessment_run_id_fkey
      FOREIGN KEY (assessment_run_id) REFERENCES public.assessment_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_permits_work_plan_id_fkey'
  ) THEN
    ALTER TABLE public.work_permits
      ADD CONSTRAINT work_permits_work_plan_id_fkey
      FOREIGN KEY (work_plan_id) REFERENCES public.work_plans(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_permits_tbm_session_id_fkey'
  ) THEN
    ALTER TABLE public.work_permits
      ADD CONSTRAINT work_permits_tbm_session_id_fkey
      FOREIGN KEY (tbm_session_id) REFERENCES public.tbm_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tbm_sessions_run_id_fkey'
  ) THEN
    ALTER TABLE public.tbm_sessions
      ADD CONSTRAINT tbm_sessions_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES public.assessment_runs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tbm_sessions_work_plan_id_fkey'
  ) THEN
    ALTER TABLE public.tbm_sessions
      ADD CONSTRAINT tbm_sessions_work_plan_id_fkey
      FOREIGN KEY (work_plan_id) REFERENCES public.work_plans(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3) Junction for multi-run links (replaces soft uuid[] as relational SSOT)
CREATE TABLE IF NOT EXISTS public.work_permit_assessment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id uuid NOT NULL REFERENCES public.work_permits(id) ON DELETE CASCADE,
  assessment_run_id uuid NOT NULL REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_permit_id, assessment_run_id)
);

CREATE INDEX IF NOT EXISTS idx_wpal_permit ON public.work_permit_assessment_links(work_permit_id);
CREATE INDEX IF NOT EXISTS idx_wpal_run ON public.work_permit_assessment_links(assessment_run_id);

ALTER TABLE public.work_permit_assessment_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'work_permit_assessment_links' AND policyname = 'wpal_select'
  ) THEN
    CREATE POLICY wpal_select ON public.work_permit_assessment_links
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'work_permit_assessment_links' AND policyname = 'wpal_write'
  ) THEN
    CREATE POLICY wpal_write ON public.work_permit_assessment_links
      FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Backfill from linked_assessment_run_ids + assessment_run_id
INSERT INTO public.work_permit_assessment_links (work_permit_id, assessment_run_id, is_primary)
SELECT wp.id, x.run_id, (wp.assessment_run_id IS NOT NULL AND x.run_id = wp.assessment_run_id)
FROM public.work_permits wp
CROSS JOIN LATERAL (
  SELECT DISTINCT unnest(
    COALESCE(wp.linked_assessment_run_ids, ARRAY[]::uuid[])
    || CASE WHEN wp.assessment_run_id IS NOT NULL THEN ARRAY[wp.assessment_run_id] ELSE ARRAY[]::uuid[] END
  ) AS run_id
) x
WHERE x.run_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.assessment_runs ar WHERE ar.id = x.run_id)
ON CONFLICT (work_permit_id, assessment_run_id) DO NOTHING;

-- Ensure primary flag for scalar assessment_run_id
UPDATE public.work_permit_assessment_links l
   SET is_primary = true
  FROM public.work_permits wp
 WHERE l.work_permit_id = wp.id
   AND wp.assessment_run_id IS NOT NULL
   AND l.assessment_run_id = wp.assessment_run_id;

-- 4) One-shot join view for permit + primary RA + TBM
CREATE OR REPLACE VIEW public.v_safety_work_bundle AS
SELECT
  wp.id AS work_permit_id,
  wp.project_id,
  wp.status AS permit_status,
  wp.permit_date,
  wp.work_name,
  wp.assessment_run_id AS primary_assessment_run_id,
  ar.period_label AS assessment_period_label,
  ar.status AS assessment_status,
  wp.tbm_session_id,
  ts.title AS tbm_title,
  ts.session_date AS tbm_session_date,
  wp.work_plan_id,
  wpl.title AS work_plan_title
FROM public.work_permits wp
LEFT JOIN public.assessment_runs ar ON ar.id = wp.assessment_run_id
LEFT JOIN public.tbm_sessions ts ON ts.id = wp.tbm_session_id
LEFT JOIN public.work_plans wpl ON wpl.id = wp.work_plan_id;

GRANT SELECT ON public.v_safety_work_bundle TO authenticated;

-- 5) Accident AI cache (mirror of ai_risk_cache)
CREATE TABLE IF NOT EXISTS public.ai_accident_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NULL,
  cache_key text NOT NULL UNIQUE,
  process_name text,
  generated_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  hit_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'ai', -- library | ai
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_accident_cache_key ON public.ai_accident_cache(cache_key);

ALTER TABLE public.ai_accident_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ai_accident_cache' AND policyname = 'ai_acc_cache_select'
  ) THEN
    CREATE POLICY ai_acc_cache_select ON public.ai_accident_cache
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

COMMENT ON TABLE public.work_permit_assessment_links IS
  'SSOT junction: work permit ↔ approved assessment runs (replaces soft linked_assessment_run_ids)';
COMMENT ON VIEW public.v_safety_work_bundle IS
  'Single-join view: permit + primary risk assessment + TBM + work plan';
