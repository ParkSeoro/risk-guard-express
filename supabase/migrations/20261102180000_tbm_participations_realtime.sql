-- Manager TBM QR attendance can follow inserts without a 4-second poll.
-- Replica identity must include tbm_session_id so the session filter is delivered.

ALTER TABLE public.tbm_participations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'tbm_participations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tbm_participations;
  END IF;
END $$;
