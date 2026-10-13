DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'worker_education_records'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%education_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.worker_education_records DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.education_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  education_type text NOT NULL CHECK (education_type IN ('regular','new_hire','job_change','special','manager','msds')),
  course_name text NOT NULL,
  hours numeric(5,2) NOT NULL CHECK (hours > 0),
  held_on date NOT NULL,
  instructor text,
  place text,
  outline text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  photo_urls text[] NOT NULL DEFAULT '{}',
  created_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.education_session_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.education_sessions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  signature_data text,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, worker_id)
);

ALTER TABLE public.worker_education_records
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.education_sessions(id);

CREATE UNIQUE INDEX IF NOT EXISTS worker_education_records_session_worker
  ON public.worker_education_records (session_id, worker_id)
  WHERE session_id IS NOT NULL AND is_deleted = false;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_session_attendees TO authenticated;
GRANT ALL ON public.education_sessions TO service_role;
GRANT ALL ON public.education_session_attendees TO service_role;

ALTER TABLE public.education_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_session_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS education_sessions_member ON public.education_sessions;
CREATE POLICY education_sessions_member ON public.education_sessions
  FOR ALL TO authenticated
  USING (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()))
  WITH CHECK (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()));

DROP POLICY IF EXISTS education_session_attendees_member ON public.education_session_attendees;
CREATE POLICY education_session_attendees_member ON public.education_session_attendees
  FOR ALL TO authenticated
  USING (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()))
  WITH CHECK (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()));
