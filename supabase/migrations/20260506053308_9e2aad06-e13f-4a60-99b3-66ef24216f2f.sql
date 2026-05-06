
-- 1. TBM Sessions
CREATE TABLE public.tbm_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  run_id UUID,
  work_plan_id UUID,
  qr_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  title TEXT NOT NULL DEFAULT '',
  briefing_summary TEXT NOT NULL DEFAULT '',
  briefing_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  tbm_date DATE NOT NULL DEFAULT CURRENT_DATE,
  location TEXT NOT NULL DEFAULT '',
  leader_name TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tbm_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view tbm_sessions" ON public.tbm_sessions FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert tbm_sessions" ON public.tbm_sessions FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update tbm_sessions" ON public.tbm_sessions FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete tbm_sessions" ON public.tbm_sessions FOR DELETE TO authenticated USING (is_admin(auth.uid()));
CREATE TRIGGER update_tbm_sessions_updated_at BEFORE UPDATE ON public.tbm_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_tbm_sessions_project ON public.tbm_sessions(project_id);
CREATE INDEX idx_tbm_sessions_run ON public.tbm_sessions(run_id);
CREATE INDEX idx_tbm_sessions_token ON public.tbm_sessions(qr_token);

-- 2. TBM Participations
CREATE TABLE public.tbm_participations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tbm_session_id UUID NOT NULL REFERENCES public.tbm_sessions(id) ON DELETE CASCADE,
  worker_name TEXT NOT NULL,
  worker_phone TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  briefing_confirmed BOOLEAN NOT NULL DEFAULT false,
  signature_data TEXT NOT NULL DEFAULT '',
  participated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tbm_session_id, worker_phone)
);
ALTER TABLE public.tbm_participations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view tbm_participations" ON public.tbm_participations FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tbm_sessions s WHERE s.id = tbm_session_id AND is_project_member(auth.uid(), s.project_id))
);
CREATE POLICY "Members can delete tbm_participations" ON public.tbm_participations FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.tbm_sessions s WHERE s.id = tbm_session_id AND is_project_member(auth.uid(), s.project_id))
);
CREATE INDEX idx_tbm_part_session ON public.tbm_participations(tbm_session_id);

-- 3. Work Permits
CREATE TABLE public.work_permits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  work_plan_id UUID,
  assessment_run_id UUID,
  tbm_session_id UUID,
  permit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  work_description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '대기',
  weather_check_passed BOOLEAN NOT NULL DEFAULT false,
  weather_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  gate_check_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejection_reason TEXT NOT NULL DEFAULT '',
  approved_by UUID,
  approved_by_name TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.work_permits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view work_permits" ON public.work_permits FOR SELECT TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can insert work_permits" ON public.work_permits FOR INSERT TO authenticated WITH CHECK (is_project_member(auth.uid(), project_id));
CREATE POLICY "Members can update work_permits" ON public.work_permits FOR UPDATE TO authenticated USING (is_project_member(auth.uid(), project_id));
CREATE POLICY "Admins can delete work_permits" ON public.work_permits FOR DELETE TO authenticated USING (is_admin(auth.uid()));
CREATE TRIGGER update_work_permits_updated_at BEFORE UPDATE ON public.work_permits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_work_permits_project ON public.work_permits(project_id);
CREATE INDEX idx_work_permits_status ON public.work_permits(status);

-- 4. Public RPC: lookup TBM by QR token (no auth)
CREATE OR REPLACE FUNCTION public.get_tbm_by_token(_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s record;
BEGIN
  SELECT id, project_id, title, briefing_summary, briefing_risks, tbm_date, location, leader_name, is_active
  INTO _s
  FROM public.tbm_sessions
  WHERE qr_token = _token AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  RETURN jsonb_build_object(
    'id', _s.id,
    'title', _s.title,
    'briefing_summary', _s.briefing_summary,
    'briefing_risks', _s.briefing_risks,
    'tbm_date', _s.tbm_date,
    'location', _s.location,
    'leader_name', _s.leader_name
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_tbm_by_token(TEXT) TO anon, authenticated;

-- 5. Public RPC: submit participation (no auth)
CREATE OR REPLACE FUNCTION public.submit_tbm_participation(
  _token TEXT,
  _worker_name TEXT,
  _worker_phone TEXT,
  _company_name TEXT,
  _briefing_confirmed BOOLEAN,
  _signature_data TEXT,
  _ip_hash TEXT,
  _user_agent TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session_id UUID;
  _existing UUID;
BEGIN
  IF _worker_name IS NULL OR length(trim(_worker_name)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_NAME');
  END IF;
  IF _worker_phone IS NULL OR length(trim(_worker_phone)) < 8 THEN
    RETURN jsonb_build_object('error', 'INVALID_PHONE');
  END IF;
  IF NOT _briefing_confirmed THEN
    RETURN jsonb_build_object('error', 'BRIEFING_NOT_CONFIRMED');
  END IF;
  IF _signature_data IS NULL OR length(_signature_data) < 100 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED');
  END IF;

  SELECT id INTO _session_id FROM public.tbm_sessions WHERE qr_token = _token AND is_active = true;
  IF _session_id IS NULL THEN
    RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
  END IF;

  SELECT id INTO _existing FROM public.tbm_participations
  WHERE tbm_session_id = _session_id AND worker_phone = _worker_phone;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'ALREADY_PARTICIPATED');
  END IF;

  INSERT INTO public.tbm_participations (
    tbm_session_id, worker_name, worker_phone, company_name,
    briefing_confirmed, signature_data, ip_hash, user_agent
  ) VALUES (
    _session_id, trim(_worker_name), trim(_worker_phone), COALESCE(trim(_company_name), ''),
    true, _signature_data, COALESCE(_ip_hash, ''), COALESCE(_user_agent, '')
  );

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_tbm_participation(TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT) TO anon, authenticated;
