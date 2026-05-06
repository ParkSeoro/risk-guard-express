ALTER TABLE public.tbm_sessions
  ADD COLUMN IF NOT EXISTS work_content text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS work_steps text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS special_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prohibited_actions text NOT NULL DEFAULT '';