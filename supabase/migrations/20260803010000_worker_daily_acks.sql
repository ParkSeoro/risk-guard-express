-- Daily work acknowledgment: worker confirms today's permits + RA and signs once (hard gate before entry/checkout).
-- Signature can be reused for linked TBM participations.

CREATE TABLE IF NOT EXISTS public.worker_daily_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  user_id uuid,
  worker_name text,
  worker_phone text,
  ack_date date NOT NULL DEFAULT ((timezone('Asia/Seoul', now()))::date),
  permit_ids uuid[] NOT NULL DEFAULT '{}',
  work_summary text NOT NULL DEFAULT '',
  risk_summary text NOT NULL DEFAULT '',
  confirmed_work boolean NOT NULL DEFAULT true,
  confirmed_risk boolean NOT NULL DEFAULT true,
  signature_data text NOT NULL,
  entry_log_id uuid REFERENCES public.worker_entry_logs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One ack per worker per day (worker_id path used by auth GPS check-in)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_worker_daily_acks_worker_day'
  ) THEN
    ALTER TABLE public.worker_daily_acks
      ADD CONSTRAINT uq_worker_daily_acks_worker_day UNIQUE (project_id, worker_id, ack_date);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_worker_daily_acks_project_day
  ON public.worker_daily_acks (project_id, ack_date);

ALTER TABLE public.worker_daily_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "worker_daily_acks_select" ON public.worker_daily_acks;
CREATE POLICY "worker_daily_acks_select"
  ON public.worker_daily_acks FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "worker_daily_acks_insert" ON public.worker_daily_acks;
CREATE POLICY "worker_daily_acks_insert"
  ON public.worker_daily_acks FOR INSERT TO authenticated
  WITH CHECK (
    public.is_project_member(auth.uid(), project_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "worker_daily_acks_update" ON public.worker_daily_acks;
CREATE POLICY "worker_daily_acks_update"
  ON public.worker_daily_acks FOR UPDATE TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
    OR user_id = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE ON public.worker_daily_acks TO authenticated;
GRANT ALL ON public.worker_daily_acks TO service_role;

COMMENT ON TABLE public.worker_daily_acks IS
  'Worker confirms assigned permits + risk summary and signs once per day; reusable for TBM.';
