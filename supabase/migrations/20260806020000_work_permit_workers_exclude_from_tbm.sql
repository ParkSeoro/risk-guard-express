-- Permit roster may include company managers for 을지 print, without putting them on TBM attendance.
ALTER TABLE public.work_permit_workers
  ADD COLUMN IF NOT EXISTS exclude_from_tbm boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_permit_workers.exclude_from_tbm IS
  'When true, person appears on permit crew/을지 but is not synced into tbm_participations (managers).';

CREATE INDEX IF NOT EXISTS work_permit_workers_exclude_from_tbm_idx
  ON public.work_permit_workers (work_permit_id)
  WHERE exclude_from_tbm = true;
