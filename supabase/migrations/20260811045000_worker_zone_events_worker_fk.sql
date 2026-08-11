-- worker_zone_events.worker_qr_id historically referenced worker_daily_qr(id),
-- but track-location / notify triggers store and resolve workers.id.
-- Fix FK so zone event inserts (and alarm triggers) succeed.

-- Clear orphans that are not valid workers.id (includes old daily_qr ids)
UPDATE public.worker_zone_events
SET worker_qr_id = NULL
WHERE worker_qr_id IS NOT NULL
  AND worker_qr_id NOT IN (SELECT id FROM public.workers);

ALTER TABLE public.worker_zone_events
  DROP CONSTRAINT IF EXISTS worker_zone_events_worker_qr_id_fkey;

ALTER TABLE public.worker_zone_events
  ADD CONSTRAINT worker_zone_events_worker_qr_id_fkey
  FOREIGN KEY (worker_qr_id)
  REFERENCES public.workers(id)
  ON DELETE SET NULL;
