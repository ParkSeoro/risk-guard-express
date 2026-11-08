-- Council transcripts belong to one director. Other accounts cannot read or write them.
-- The council does not open or merge pull requests.

CREATE OR REPLACE FUNCTION public.is_council_director(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT _user_id = '5e780ffb-81c8-42ef-8eed-b27815785fd1'::uuid
    AND EXISTS (
      SELECT 1
      FROM auth.users
      WHERE id = _user_id
        AND lower(email) = 'psr1579@gmail.com'
    );
$$;

REVOKE ALL ON FUNCTION public.is_council_director(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_council_director(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.council_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda text NOT NULL,
  status text NOT NULL DEFAULT '진행중' CHECK (status IN ('진행중', '합의', '미합의')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS council_meetings_created_at_idx
  ON public.council_meetings (created_at);

CREATE TABLE IF NOT EXISTS public.council_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.council_meetings(id) ON DELETE CASCADE,
  seat text NOT NULL CHECK (seat IN ('user', 'gemini', 'claude', 'gpt', 'cursor', 'chair')),
  round integer,
  role_label text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS council_turns_meeting_idx
  ON public.council_turns (meeting_id, created_at);

ALTER TABLE public.council_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.council_turns ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.council_meetings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.council_turns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.council_meetings TO authenticated;
GRANT SELECT, INSERT ON TABLE public.council_turns TO authenticated;

DROP POLICY IF EXISTS council_meetings_director_select ON public.council_meetings;
CREATE POLICY council_meetings_director_select
  ON public.council_meetings
  FOR SELECT
  TO authenticated
  USING (created_by = auth.uid() AND public.is_council_director(auth.uid()));

DROP POLICY IF EXISTS council_meetings_director_insert ON public.council_meetings;
CREATE POLICY council_meetings_director_insert
  ON public.council_meetings
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.is_council_director(auth.uid()));

DROP POLICY IF EXISTS council_meetings_director_update ON public.council_meetings;
CREATE POLICY council_meetings_director_update
  ON public.council_meetings
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() AND public.is_council_director(auth.uid()))
  WITH CHECK (created_by = auth.uid() AND public.is_council_director(auth.uid()));

DROP POLICY IF EXISTS council_turns_director_select ON public.council_turns;
CREATE POLICY council_turns_director_select
  ON public.council_turns
  FOR SELECT
  TO authenticated
  USING (
    public.is_council_director(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.council_meetings AS meeting
      WHERE meeting.id = meeting_id
        AND meeting.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS council_turns_director_insert ON public.council_turns;
CREATE POLICY council_turns_director_insert
  ON public.council_turns
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_council_director(auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.council_meetings AS meeting
      WHERE meeting.id = meeting_id
        AND meeting.created_by = auth.uid()
    )
  );
