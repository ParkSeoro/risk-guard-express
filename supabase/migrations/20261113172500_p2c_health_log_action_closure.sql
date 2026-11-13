ALTER TABLE public.worker_daily_health_logs
  ADD COLUMN IF NOT EXISTS action_status text NOT NULL DEFAULT 'pending'
    CHECK (action_status IN ('pending', 'rest', 'reassigned', 'sent_home', 'cleared')),
  ADD COLUMN IF NOT EXISTS action_note text,
  ADD COLUMN IF NOT EXISTS action_taken_at timestamptz,
  ADD COLUMN IF NOT EXISTS action_taken_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS action_taken_by_name text;

CREATE INDEX IF NOT EXISTS idx_worker_daily_health_logs_action_status
  ON public.worker_daily_health_logs (project_id, log_date, fit_to_work, action_status)
  WHERE is_deleted = false;
