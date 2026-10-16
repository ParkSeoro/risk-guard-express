-- Remote support: field users request; designated agents accept; SPA co-browse.

CREATE TABLE IF NOT EXISTS public.remote_support_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remote_support_agents_user_id_key UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS public.remote_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'ended', 'rejected', 'expired')),
  requester_path text,
  control_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remote_support_agents_active
  ON public.remote_support_agents (active, sort_order);

CREATE INDEX IF NOT EXISTS idx_remote_support_sessions_agent_status
  ON public.remote_support_sessions (agent_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_remote_support_sessions_requester_status
  ON public.remote_support_sessions (requester_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.is_remote_support_agent(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.remote_support_agents a
    WHERE a.user_id = _uid
      AND a.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_request_remote_support(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _uid IS NOT NULL
    AND NOT public.is_master(_uid)
    AND NOT public.is_remote_support_agent(_uid);
$$;

CREATE OR REPLACE FUNCTION public.touch_remote_support_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remote_support_agents_updated ON public.remote_support_agents;
CREATE TRIGGER trg_remote_support_agents_updated
  BEFORE UPDATE ON public.remote_support_agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_remote_support_updated_at();

DROP TRIGGER IF EXISTS trg_remote_support_sessions_updated ON public.remote_support_sessions;
CREATE TRIGGER trg_remote_support_sessions_updated
  BEFORE UPDATE ON public.remote_support_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_remote_support_updated_at();

-- Notify agent on new pending request; notify requester on accept/reject/end.
CREATE OR REPLACE FUNCTION public.trg_remote_support_session_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_name text;
  v_agent_name text;
  v_title text;
  v_message text;
  v_link text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    SELECT COALESCE(NULLIF(p.display_name, ''), '현장 사용자')
      INTO v_requester_name
    FROM public.profiles p
    WHERE p.user_id = NEW.requester_id;

    INSERT INTO public.notifications (
      user_id, title, message, type, related_id, related_type, project_id, link, severity
    ) VALUES (
      NEW.agent_id,
      '원격지원 요청',
      v_requester_name || '님이 원격지원을 요청했습니다.',
      'remote_support',
      NEW.id,
      'remote_support_session',
      NEW.project_id,
      '/app/admin/remote-support?session=' || NEW.id::text,
      'info'
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT COALESCE(NULLIF(p.display_name, ''), '담당자')
      INTO v_agent_name
    FROM public.profiles p
    WHERE p.user_id = NEW.agent_id;

    IF NEW.status = 'active' THEN
      v_title := '원격지원 수락';
      v_message := v_agent_name || '님이 원격지원을 수락했습니다. 화면공유를 허용해 주세요.';
      v_link := COALESCE(NEW.requester_path, '/app/admin/');
    ELSIF NEW.status = 'rejected' THEN
      v_title := '원격지원 거절';
      v_message := v_agent_name || '님이 원격지원 요청을 거절했습니다.';
      v_link := COALESCE(NEW.requester_path, '/app/admin/');
    ELSIF NEW.status = 'ended' THEN
      v_title := '원격지원 종료';
      v_message := '원격지원 세션이 종료되었습니다.';
      v_link := COALESCE(NEW.requester_path, '/app/admin/');
    ELSIF NEW.status = 'expired' THEN
      v_title := '원격지원 만료';
      v_message := '원격지원 요청이 만료되었습니다.';
      v_link := COALESCE(NEW.requester_path, '/app/admin/');
    ELSE
      RETURN NEW;
    END IF;

    INSERT INTO public.notifications (
      user_id, title, message, type, related_id, related_type, project_id, link, severity
    ) VALUES (
      NEW.requester_id,
      v_title,
      v_message,
      'remote_support',
      NEW.id,
      'remote_support_session',
      NEW.project_id,
      v_link,
      'info'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remote_support_session_notify ON public.remote_support_sessions;
CREATE TRIGGER trg_remote_support_session_notify
  AFTER INSERT OR UPDATE OF status ON public.remote_support_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_remote_support_session_notify();

ALTER TABLE public.remote_support_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remote_support_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rsa_select ON public.remote_support_agents;
CREATE POLICY rsa_select ON public.remote_support_agents
  FOR SELECT TO authenticated
  USING (
    active = true
    OR public.is_master(auth.uid())
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS rsa_insert ON public.remote_support_agents;
CREATE POLICY rsa_insert ON public.remote_support_agents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_master(auth.uid()));

DROP POLICY IF EXISTS rsa_update ON public.remote_support_agents;
CREATE POLICY rsa_update ON public.remote_support_agents
  FOR UPDATE TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

DROP POLICY IF EXISTS rsa_delete ON public.remote_support_agents;
CREATE POLICY rsa_delete ON public.remote_support_agents
  FOR DELETE TO authenticated
  USING (public.is_master(auth.uid()));

DROP POLICY IF EXISTS rss_select ON public.remote_support_sessions;
CREATE POLICY rss_select ON public.remote_support_sessions
  FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR agent_id = auth.uid()
    OR public.is_master(auth.uid())
  );

DROP POLICY IF EXISTS rss_insert ON public.remote_support_sessions;
CREATE POLICY rss_insert ON public.remote_support_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND public.can_request_remote_support(auth.uid())
    AND status = 'pending'
    AND public.is_remote_support_agent(agent_id)
  );

DROP POLICY IF EXISTS rss_update ON public.remote_support_sessions;
CREATE POLICY rss_update ON public.remote_support_sessions
  FOR UPDATE TO authenticated
  USING (
    requester_id = auth.uid()
    OR agent_id = auth.uid()
    OR public.is_master(auth.uid())
  )
  WITH CHECK (
    requester_id = auth.uid()
    OR agent_id = auth.uid()
    OR public.is_master(auth.uid())
  );

DROP POLICY IF EXISTS rss_delete ON public.remote_support_sessions;
CREATE POLICY rss_delete ON public.remote_support_sessions
  FOR DELETE TO authenticated
  USING (public.is_master(auth.uid()));

GRANT SELECT ON public.remote_support_agents TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.remote_support_agents TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.remote_support_sessions TO authenticated;
GRANT DELETE ON public.remote_support_sessions TO authenticated;
GRANT ALL ON public.remote_support_agents TO service_role;
GRANT ALL ON public.remote_support_sessions TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'remote_support_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.remote_support_sessions;
  END IF;
END $$;

-- Seed designated agents by display_name (박서로, 강은혜).
-- profiles.id ≠ auth.users.id — use profiles.user_id.
INSERT INTO public.remote_support_agents (user_id, display_label, sort_order, active)
SELECT p.user_id,
       p.display_name,
       CASE p.display_name WHEN '박서로' THEN 1 WHEN '강은혜' THEN 2 ELSE 10 END,
       true
FROM public.profiles p
JOIN auth.users u ON u.id = p.user_id
WHERE p.display_name IN ('박서로', '강은혜')
  AND p.user_id IS NOT NULL
  AND COALESCE(u.email, '') NOT LIKE '%@worker.local'
ON CONFLICT (user_id) DO UPDATE
SET display_label = EXCLUDED.display_label,
    sort_order = EXCLUDED.sort_order,
    active = true,
    updated_at = now();
