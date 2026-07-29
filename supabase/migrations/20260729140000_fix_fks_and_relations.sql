-- Integrity hotfix: missing FKs for workers / entry / TBM / permit links
-- Intent name: 20260729_fix_fks_and_relations.sql

-- 1) tbm_participations.worker_id (column first)
ALTER TABLE public.tbm_participations
  ADD COLUMN IF NOT EXISTS worker_id uuid;

-- Backfill worker_id from phone + session project
-- NOTE: Postgres regexp_replace uses POSIX regex — use [^0-9], not PCRE \D
UPDATE public.tbm_participations tp
   SET worker_id = w.id
  FROM public.tbm_sessions ts
  JOIN public.workers w
    ON w.project_id = ts.project_id
   AND regexp_replace(coalesce(w.phone, ''), '[^0-9]', '', 'g')
     = regexp_replace(coalesce(tp.worker_phone, ''), '[^0-9]', '', 'g')
 WHERE tp.tbm_session_id = ts.id
   AND tp.worker_id IS NULL
   AND coalesce(tp.worker_phone, '') <> ''
   AND regexp_replace(coalesce(tp.worker_phone, ''), '[^0-9]', '', 'g') <> '';

UPDATE public.tbm_participations tp
   SET worker_id = NULL
 WHERE worker_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = tp.worker_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tbm_participations_worker_id_fkey'
  ) THEN
    ALTER TABLE public.tbm_participations
      ADD CONSTRAINT tbm_participations_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tbm_participations_worker_id
  ON public.tbm_participations(worker_id);

-- 2) Orphan cleanup for workers / entry / permit workers / sessions / permits
UPDATE public.workers w
   SET company_id = NULL
 WHERE company_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = w.company_id);

DELETE FROM public.workers w
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = w.project_id);

DELETE FROM public.worker_entry_logs l
 WHERE NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = l.worker_id);

UPDATE public.worker_entry_logs l
   SET work_permit_id = NULL
 WHERE work_permit_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_permits wp WHERE wp.id = l.work_permit_id);

DELETE FROM public.worker_entry_logs l
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = l.project_id);

DELETE FROM public.work_permit_workers x
 WHERE NOT EXISTS (SELECT 1 FROM public.work_permits wp WHERE wp.id = x.work_permit_id)
    OR NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.id = x.worker_id)
    OR NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = x.project_id);

DELETE FROM public.work_permits wp
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = wp.project_id);

UPDATE public.tbm_sessions ts
   SET company_id = NULL
 WHERE company_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = ts.company_id);

DELETE FROM public.tbm_sessions ts
 WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = ts.project_id);

-- 3) workers FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workers_project_id_fkey') THEN
    ALTER TABLE public.workers
      ADD CONSTRAINT workers_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workers_company_id_fkey') THEN
    ALTER TABLE public.workers
      ADD CONSTRAINT workers_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4) worker_entry_logs FKs (entry_at = check_in_time, exit_at = check_out_time)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'worker_entry_logs_worker_id_fkey') THEN
    ALTER TABLE public.worker_entry_logs
      ADD CONSTRAINT worker_entry_logs_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'worker_entry_logs_project_id_fkey') THEN
    ALTER TABLE public.worker_entry_logs
      ADD CONSTRAINT worker_entry_logs_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'worker_entry_logs_work_permit_id_fkey') THEN
    ALTER TABLE public.worker_entry_logs
      ADD CONSTRAINT worker_entry_logs_work_permit_id_fkey
      FOREIGN KEY (work_permit_id) REFERENCES public.work_permits(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_worker_entry_logs_worker_day
  ON public.worker_entry_logs(worker_id, entry_at);

-- 5) work_permit_workers FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_permit_workers_work_permit_id_fkey') THEN
    ALTER TABLE public.work_permit_workers
      ADD CONSTRAINT work_permit_workers_work_permit_id_fkey
      FOREIGN KEY (work_permit_id) REFERENCES public.work_permits(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_permit_workers_worker_id_fkey') THEN
    ALTER TABLE public.work_permit_workers
      ADD CONSTRAINT work_permit_workers_worker_id_fkey
      FOREIGN KEY (worker_id) REFERENCES public.workers(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_permit_workers_project_id_fkey') THEN
    ALTER TABLE public.work_permit_workers
      ADD CONSTRAINT work_permit_workers_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6) work_permits / tbm_sessions project FKs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_permits_project_id_fkey') THEN
    ALTER TABLE public.work_permits
      ADD CONSTRAINT work_permits_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_sessions_project_id_fkey') THEN
    ALTER TABLE public.tbm_sessions
      ADD CONSTRAINT tbm_sessions_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tbm_sessions_company_id_fkey') THEN
    ALTER TABLE public.tbm_sessions
      ADD CONSTRAINT tbm_sessions_company_id_fkey
      FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 7) Ensure AI accident cache (may be missing if prior bundle migration failed)
CREATE TABLE IF NOT EXISTS public.ai_accident_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NULL REFERENCES public.projects(id) ON DELETE SET NULL,
  cache_key text NOT NULL UNIQUE,
  process_name text,
  generated_cases jsonb NOT NULL DEFAULT '[]'::jsonb,
  hit_count integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_accident_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read ai_accident_cache" ON public.ai_accident_cache;
CREATE POLICY "Authenticated read ai_accident_cache"
  ON public.ai_accident_cache FOR SELECT TO authenticated USING (true);

-- 8) Junction + view (idempotent)
CREATE TABLE IF NOT EXISTS public.work_permit_assessment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id uuid NOT NULL REFERENCES public.work_permits(id) ON DELETE CASCADE,
  assessment_run_id uuid NOT NULL REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_permit_id, assessment_run_id)
);
ALTER TABLE public.work_permit_assessment_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members manage permit assessment links" ON public.work_permit_assessment_links;
DROP POLICY IF EXISTS "Authenticated full access work_permit_assessment_links" ON public.work_permit_assessment_links;
CREATE POLICY "Members manage permit assessment links"
  ON public.work_permit_assessment_links FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_permits wp
      WHERE wp.id = work_permit_id AND is_project_member(auth.uid(), wp.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.work_permits wp
      WHERE wp.id = work_permit_id AND is_project_member(auth.uid(), wp.project_id)
    )
  );

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
  ts.tbm_date AS tbm_session_date,
  wp.work_plan_id,
  wpl.title AS work_plan_title
FROM public.work_permits wp
LEFT JOIN public.assessment_runs ar ON ar.id = wp.assessment_run_id
LEFT JOIN public.tbm_sessions ts ON ts.id = wp.tbm_session_id
LEFT JOIN public.work_plans wpl ON wpl.id = wp.work_plan_id;

GRANT SELECT ON public.v_safety_work_bundle TO authenticated;

COMMENT ON COLUMN public.worker_entry_logs.entry_at IS 'check_in_time (출근)';
COMMENT ON COLUMN public.worker_entry_logs.exit_at IS 'check_out_time (퇴근)';

-- 9) Realtime publication gaps
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_zone_events;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_entry_logs;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
