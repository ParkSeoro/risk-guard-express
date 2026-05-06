
-- 1. safety_education_materials
CREATE TABLE public.safety_education_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  company_id UUID,
  run_id UUID,
  work_plan_id UUID,
  title TEXT NOT NULL DEFAULT '',
  work_overview TEXT NOT NULL DEFAULT '',
  key_hazards JSONB NOT NULL DEFAULT '[]'::jsonb,
  accident_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  safety_measures JSONB NOT NULL DEFAULT '[]'::jsonb,
  prohibited_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ppe_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  tbm_summary TEXT NOT NULL DEFAULT '',
  auto_generated BOOLEAN NOT NULL DEFAULT true,
  version_number INT NOT NULL DEFAULT 1,
  generated_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_edu_mat_project ON public.safety_education_materials(project_id);
CREATE INDEX idx_edu_mat_run ON public.safety_education_materials(run_id);
ALTER TABLE public.safety_education_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edu_mat_select" ON public.safety_education_materials FOR SELECT
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));
CREATE POLICY "edu_mat_insert" ON public.safety_education_materials FOR INSERT
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
CREATE POLICY "edu_mat_update" ON public.safety_education_materials FOR UPDATE
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
CREATE POLICY "edu_mat_delete" ON public.safety_education_materials FOR DELETE
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
CREATE TRIGGER trg_edu_mat_updated BEFORE UPDATE ON public.safety_education_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. workers (QR-based simple accounts, NO auth.users link)
CREATE TABLE public.workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  company_id UUID,
  company_name TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  qr_token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  education_confirmed_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, phone)
);
CREATE INDEX idx_workers_project ON public.workers(project_id);
CREATE INDEX idx_workers_token ON public.workers(qr_token);
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workers_select" ON public.workers FOR SELECT
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, false));
CREATE POLICY "workers_insert_admin" ON public.workers FOR INSERT
  WITH CHECK (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
CREATE POLICY "workers_update_admin" ON public.workers FOR UPDATE
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
CREATE POLICY "workers_delete_admin" ON public.workers FOR DELETE
  USING (public.can_access_safety_cost(auth.uid(), project_id, company_id, true));
CREATE TRIGGER trg_workers_updated BEFORE UPDATE ON public.workers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. work_permit_workers
CREATE TABLE public.work_permit_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  project_id UUID NOT NULL,
  notified_at TIMESTAMPTZ,
  notification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(work_permit_id, worker_id)
);
CREATE INDEX idx_wpw_permit ON public.work_permit_workers(work_permit_id);
CREATE INDEX idx_wpw_worker ON public.work_permit_workers(worker_id);
ALTER TABLE public.work_permit_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wpw_select" ON public.work_permit_workers FOR SELECT
  USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wpw_insert" ON public.work_permit_workers FOR INSERT
  WITH CHECK (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wpw_delete" ON public.work_permit_workers FOR DELETE
  USING (public.is_project_member(auth.uid(), project_id));

-- 4. worker_entry_logs
CREATE TABLE public.worker_entry_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id UUID NOT NULL,
  work_permit_id UUID,
  project_id UUID NOT NULL,
  entry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  exit_at TIMESTAMPTZ,
  entry_signature_data TEXT,
  exit_signature_data TEXT,
  risk_assessment_confirmed BOOLEAN NOT NULL DEFAULT false,
  education_confirmed BOOLEAN NOT NULL DEFAULT false,
  tbm_confirmed BOOLEAN NOT NULL DEFAULT false,
  no_accident_confirmed BOOLEAN NOT NULL DEFAULT false,
  entry_method TEXT NOT NULL DEFAULT 'qr',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wel_worker ON public.worker_entry_logs(worker_id);
CREATE INDEX idx_wel_project_date ON public.worker_entry_logs(project_id, entry_at);
ALTER TABLE public.worker_entry_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wel_select" ON public.worker_entry_logs FOR SELECT
  USING (public.is_project_member(auth.uid(), project_id));
-- Insert/update done via SECURITY DEFINER functions for workers

-- 5. work_plans column
ALTER TABLE public.work_plans ADD COLUMN IF NOT EXISTS auto_education_enabled BOOLEAN NOT NULL DEFAULT true;

-- 6. SECURITY DEFINER functions for worker portal (no auth)
CREATE OR REPLACE FUNCTION public.register_worker(
  _project_id UUID, _name TEXT, _phone TEXT, _company_name TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _existing record;
  _new_id UUID;
  _new_token TEXT;
  _company_id UUID;
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_NAME');
  END IF;
  IF _phone IS NULL OR length(trim(_phone)) < 8 THEN
    RETURN jsonb_build_object('error', 'INVALID_PHONE');
  END IF;

  -- Try to match company by name within project
  SELECT id INTO _company_id FROM public.companies
   WHERE project_id = _project_id AND name = trim(_company_name) LIMIT 1;

  -- Upsert by (project_id, phone)
  SELECT id, qr_token INTO _existing FROM public.workers
   WHERE project_id = _project_id AND phone = trim(_phone) LIMIT 1;

  IF FOUND THEN
    UPDATE public.workers
       SET name = trim(_name),
           company_name = COALESCE(trim(_company_name),''),
           company_id = COALESCE(_company_id, company_id),
           is_active = true,
           updated_at = now()
     WHERE id = _existing.id;
    RETURN jsonb_build_object('success', true, 'worker_id', _existing.id, 'qr_token', _existing.qr_token);
  END IF;

  INSERT INTO public.workers (project_id, company_id, company_name, name, phone)
  VALUES (_project_id, _company_id, COALESCE(trim(_company_name),''), trim(_name), trim(_phone))
  RETURNING id, qr_token INTO _new_id, _new_token;

  RETURN jsonb_build_object('success', true, 'worker_id', _new_id, 'qr_token', _new_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_worker_by_token(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE _w record;
BEGIN
  SELECT id, project_id, company_id, company_name, name, phone, education_confirmed_at, is_active
    INTO _w FROM public.workers WHERE qr_token = _token AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object(
    'id', _w.id, 'project_id', _w.project_id, 'company_id', _w.company_id,
    'company_name', _w.company_name, 'name', _w.name, 'phone', _w.phone,
    'education_confirmed_at', _w.education_confirmed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_worker_education(_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _w record;
BEGIN
  SELECT id INTO _w FROM public.workers WHERE qr_token = _token AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  UPDATE public.workers SET education_confirmed_at = now() WHERE id = _w.id;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_entry(
  _token TEXT, _work_permit_id UUID, _signature TEXT,
  _ra_confirmed BOOLEAN, _edu_confirmed BOOLEAN, _tbm_confirmed BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _w record;
  _existing UUID;
  _new_id UUID;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT id, project_id INTO _w FROM public.workers WHERE qr_token = _token AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF _signature IS NULL OR length(_signature) < 100 THEN
    RETURN jsonb_build_object('error','SIGNATURE_REQUIRED');
  END IF;

  -- One open entry (no exit_at) per day per worker
  SELECT id INTO _existing FROM public.worker_entry_logs
   WHERE worker_id = _w.id AND exit_at IS NULL
     AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('error','ALREADY_ENTERED','log_id', _existing);
  END IF;

  INSERT INTO public.worker_entry_logs (
    worker_id, work_permit_id, project_id, entry_signature_data,
    risk_assessment_confirmed, education_confirmed, tbm_confirmed
  ) VALUES (
    _w.id, _work_permit_id, _w.project_id, _signature,
    COALESCE(_ra_confirmed,false), COALESCE(_edu_confirmed,false), COALESCE(_tbm_confirmed,false)
  ) RETURNING id INTO _new_id;

  RETURN jsonb_build_object('success', true, 'log_id', _new_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.worker_exit(
  _token TEXT, _signature TEXT, _no_accident BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _w record;
  _log UUID;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT id INTO _w FROM public.workers WHERE qr_token = _token AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF _signature IS NULL OR length(_signature) < 100 THEN
    RETURN jsonb_build_object('error','SIGNATURE_REQUIRED');
  END IF;
  IF NOT COALESCE(_no_accident,false) THEN
    RETURN jsonb_build_object('error','NO_ACCIDENT_REQUIRED');
  END IF;

  SELECT id INTO _log FROM public.worker_entry_logs
   WHERE worker_id = _w.id AND exit_at IS NULL
     AND (entry_at AT TIME ZONE 'Asia/Seoul')::date = _today
   ORDER BY entry_at DESC LIMIT 1;
  IF _log IS NULL THEN
    RETURN jsonb_build_object('error','NO_OPEN_ENTRY');
  END IF;

  UPDATE public.worker_entry_logs
     SET exit_at = now(),
         exit_signature_data = _signature,
         no_accident_confirmed = true
   WHERE id = _log;

  RETURN jsonb_build_object('success', true, 'log_id', _log);
END;
$$;
