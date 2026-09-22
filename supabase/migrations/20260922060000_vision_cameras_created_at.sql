-- Live list orders by created_at (first registered camera).
ALTER TABLE public.vision_cameras
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.vision_cameras vc
SET created_at = a.first_at
FROM (
  SELECT entity_id::uuid AS entity_id, min(created_at) AS first_at
  FROM public.vision_audit_ledger
  WHERE action = 'vision.cloud_camera.upsert'
    AND entity_type = 'camera'
    AND entity_id ~* '^[0-9a-f-]{36}$'
  GROUP BY entity_id
) a
WHERE vc.id = a.entity_id;
