-- The master alarm button inserted danger_zone_entry from the phone when
-- worker_zone_events insert was denied. That row became a real push titled
-- as a zone entry. Real zone alarms are inserted by SECURITY DEFINER triggers
-- and are not affected by this client policy.

DROP POLICY IF EXISTS "notif_insert_own" ON public.notifications;
CREATE POLICY "notif_insert_own" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(type, '') IS DISTINCT FROM 'danger_zone_entry'
  );

DELETE FROM public.notifications
WHERE type = 'danger_zone_entry'
  AND (
    COALESCE(message, '') LIKE '%시뮬재이션%'
    OR COALESCE(body, '') LIKE '%시뮬재이션%'
    OR COALESCE(message, '') LIKE '%알람 시뮬레이터%'
    OR COALESCE(body, '') LIKE '%알람 시뮬레이터%'
  );