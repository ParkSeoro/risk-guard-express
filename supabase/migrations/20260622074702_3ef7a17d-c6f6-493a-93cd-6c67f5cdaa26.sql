
-- ============ Enums ============
DO $$ BEGIN
  CREATE TYPE public.health_checkup_type AS ENUM ('일반','특수','배치전','수시','임시');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.health_checkup_result AS ENUM ('정상A','정상B','요관찰C','유소견D1','유소견D2','판정불가','미수검');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.health_education_type AS ENUM ('정기','특별','관리감독자','MSDS','신규채용','작업변경');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hazard_survey_type AS ENUM ('근골격계','뇌심혈관','직무스트레스','감정노동');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.env_factor_category AS ENUM ('소음','분진','화학물질','물리적','생물학적','진동','조명','고온');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ workers extensions ============
ALTER TABLE public.workers
  ADD COLUMN IF NOT EXISTS health_checkup_status public.health_checkup_result DEFAULT '미수검',
  ADD COLUMN IF NOT EXISTS last_checkup_date date,
  ADD COLUMN IF NOT EXISTS next_checkup_due date,
  ADD COLUMN IF NOT EXISTS special_education_required_until date,
  ADD COLUMN IF NOT EXISTS health_restrictions text;

ALTER TABLE public.worker_entry_logs
  ADD COLUMN IF NOT EXISTS health_warning_shown boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_warning_items jsonb DEFAULT '[]'::jsonb;

-- ============ work_env_factors (유해인자 마스터) ============
CREATE TABLE IF NOT EXISTS public.work_env_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category public.env_factor_category NOT NULL,
  name text NOT NULL,
  cas_no text,
  exposure_limit_value numeric,
  exposure_limit_unit text,
  notes text,
  is_deleted boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_env_factors TO authenticated;
GRANT ALL ON public.work_env_factors TO service_role;
ALTER TABLE public.work_env_factors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "env_factors_select" ON public.work_env_factors FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "env_factors_write" ON public.work_env_factors FOR ALL TO authenticated USING (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[])) WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[]));
CREATE TRIGGER trg_work_env_factors_updated BEFORE UPDATE ON public.work_env_factors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_work_env_factors_project ON public.work_env_factors(project_id) WHERE is_deleted = false;

-- ============ work_env_measurements (작업환경측정) ============
CREATE TABLE IF NOT EXISTS public.work_env_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  round text NOT NULL,
  measure_date date NOT NULL,
  agency text,
  location text,
  factor_id uuid REFERENCES public.work_env_factors(id),
  factor_name text,
  measured_value numeric,
  unit text,
  exposure_limit numeric,
  is_exceeded boolean DEFAULT false,
  action_required boolean DEFAULT false,
  action_summary text,
  report_url text,
  next_due_date date,
  is_deleted boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_env_measurements TO authenticated;
GRANT ALL ON public.work_env_measurements TO service_role;
ALTER TABLE public.work_env_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wem_select" ON public.work_env_measurements FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "wem_write" ON public.work_env_measurements FOR ALL TO authenticated USING (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[])) WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[]));
CREATE TRIGGER trg_wem_updated BEFORE UPDATE ON public.work_env_measurements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_wem_project_date ON public.work_env_measurements(project_id, measure_date DESC) WHERE is_deleted = false;

-- ============ chemicals (화학물질/MSDS) ============
CREATE TABLE IF NOT EXISTS public.chemicals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  cas_no text,
  name text NOT NULL,
  trade_name text,
  hazard_class text,
  hazard_pictograms jsonb DEFAULT '[]'::jsonb,
  is_carcinogen boolean DEFAULT false,
  is_reproductive_toxin boolean DEFAULT false,
  msds_file_url text,
  warning_label_url text,
  storage_location text,
  monthly_usage numeric,
  unit text,
  notes text,
  is_deleted boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chemicals TO authenticated;
GRANT ALL ON public.chemicals TO service_role;
ALTER TABLE public.chemicals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chem_select" ON public.chemicals FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "chem_write" ON public.chemicals FOR ALL TO authenticated USING (public.can_write_company_data(auth.uid(), project_id, company_id)) WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));
CREATE TRIGGER trg_chemicals_updated BEFORE UPDATE ON public.chemicals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_chemicals_project ON public.chemicals(project_id) WHERE is_deleted = false;

-- ============ chemical_workers ============
CREATE TABLE IF NOT EXISTS public.chemical_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chemical_id uuid NOT NULL REFERENCES public.chemicals(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  msds_education_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(chemical_id, worker_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chemical_workers TO authenticated;
GRANT ALL ON public.chemical_workers TO service_role;
ALTER TABLE public.chemical_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cw_select" ON public.chemical_workers FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "cw_write" ON public.chemical_workers FOR ALL TO authenticated USING (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager','site_manager']::public.project_role[])) WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager','site_manager']::public.project_role[]));

-- ============ health_checkups ============
CREATE TABLE IF NOT EXISTS public.health_checkups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE,
  worker_name text,
  worker_phone text,
  type public.health_checkup_type NOT NULL,
  hazard_factors jsonb DEFAULT '[]'::jsonb,
  scheduled_date date,
  conducted_date date,
  institution text,
  result public.health_checkup_result DEFAULT '미수검',
  restrictions text,
  followup_required boolean DEFAULT false,
  followup_summary text,
  report_url text,
  next_due_date date,
  notes text,
  is_deleted boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_checkups TO authenticated;
GRANT ALL ON public.health_checkups TO service_role;
ALTER TABLE public.health_checkups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hc_select" ON public.health_checkups FOR SELECT TO authenticated USING (public.can_access_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "hc_write" ON public.health_checkups FOR ALL TO authenticated USING (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[])) WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[]));
CREATE TRIGGER trg_hc_updated BEFORE UPDATE ON public.health_checkups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_hc_worker ON public.health_checkups(worker_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_hc_project_due ON public.health_checkups(project_id, next_due_date) WHERE is_deleted = false;

-- Sync worker status when checkup is conducted
CREATE OR REPLACE FUNCTION public.sync_worker_health_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.worker_id IS NOT NULL AND NEW.conducted_date IS NOT NULL THEN
    UPDATE public.workers
       SET health_checkup_status = COALESCE(NEW.result, health_checkup_status),
           last_checkup_date = NEW.conducted_date,
           next_checkup_due = NEW.next_due_date,
           health_restrictions = NEW.restrictions,
           updated_at = now()
     WHERE id = NEW.worker_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_sync_worker_health ON public.health_checkups;
CREATE TRIGGER trg_sync_worker_health AFTER INSERT OR UPDATE ON public.health_checkups FOR EACH ROW EXECUTE FUNCTION public.sync_worker_health_status();

-- ============ health_education_logs ============
CREATE TABLE IF NOT EXISTS public.health_education_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE,
  worker_name text,
  type public.health_education_type NOT NULL,
  title text,
  hours numeric DEFAULT 0,
  conducted_at timestamptz,
  instructor text,
  material_id uuid REFERENCES public.safety_education_materials(id),
  attachment_url text,
  notes text,
  is_deleted boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_education_logs TO authenticated;
GRANT ALL ON public.health_education_logs TO service_role;
ALTER TABLE public.health_education_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hel_select" ON public.health_education_logs FOR SELECT TO authenticated USING (public.can_access_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "hel_write" ON public.health_education_logs FOR ALL TO authenticated USING (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager','site_manager']::public.project_role[])) WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager','site_manager']::public.project_role[]));
CREATE TRIGGER trg_hel_updated BEFORE UPDATE ON public.health_education_logs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_hel_worker ON public.health_education_logs(worker_id) WHERE is_deleted = false;

-- ============ hazard_surveys ============
CREATE TABLE IF NOT EXISTS public.hazard_surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  type public.hazard_survey_type NOT NULL,
  title text NOT NULL,
  survey_date date NOT NULL,
  target_count int DEFAULT 0,
  response_count int DEFAULT 0,
  high_risk_count int DEFAULT 0,
  findings jsonb DEFAULT '{}'::jsonb,
  actions jsonb DEFAULT '[]'::jsonb,
  next_due_date date,
  qr_token text UNIQUE,
  is_active boolean DEFAULT true,
  is_deleted boolean DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hazard_surveys TO authenticated;
GRANT SELECT ON public.hazard_surveys TO anon;
GRANT ALL ON public.hazard_surveys TO service_role;
ALTER TABLE public.hazard_surveys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hs_select" ON public.hazard_surveys FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "hs_write" ON public.hazard_surveys FOR ALL TO authenticated USING (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[])) WITH CHECK (public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[]));
CREATE TRIGGER trg_hs_updated BEFORE UPDATE ON public.hazard_surveys FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ hazard_survey_responses ============
CREATE TABLE IF NOT EXISTS public.hazard_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.hazard_surveys(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.workers(id),
  worker_name text,
  worker_phone text,
  company_name text,
  scores jsonb DEFAULT '{}'::jsonb,
  total_score numeric,
  risk_level text,
  ai_summary text,
  ip_hash text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT, INSERT ON public.hazard_survey_responses TO authenticated;
GRANT INSERT ON public.hazard_survey_responses TO anon;
GRANT ALL ON public.hazard_survey_responses TO service_role;
ALTER TABLE public.hazard_survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hsr_select" ON public.hazard_survey_responses FOR SELECT TO authenticated USING (public.is_project_member(auth.uid(), project_id));
CREATE POLICY "hsr_insert_anon" ON public.hazard_survey_responses FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "hsr_insert_auth" ON public.hazard_survey_responses FOR INSERT TO authenticated WITH CHECK (true);

-- ============ risk_items extensions ============
ALTER TABLE public.risk_items
  ADD COLUMN IF NOT EXISTS linked_chemical_ids uuid[] DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS linked_env_factor_ids uuid[] DEFAULT ARRAY[]::uuid[],
  ADD COLUMN IF NOT EXISTS env_exceedance_source uuid;

-- ============ RPC: get health warnings for a worker ============
CREATE OR REPLACE FUNCTION public.get_worker_health_warnings(_worker_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _w record;
  _warnings jsonb := '[]'::jsonb;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT id, project_id, health_checkup_status, last_checkup_date, next_checkup_due,
         special_education_required_until
    INTO _w FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('warnings','[]'::jsonb); END IF;

  IF _w.health_checkup_status = '미수검' OR _w.last_checkup_date IS NULL THEN
    _warnings := _warnings || jsonb_build_array(jsonb_build_object('code','HEALTH_NOT_CHECKED','message','건강진단 미수검'));
  ELSIF _w.next_checkup_due IS NOT NULL AND _w.next_checkup_due < _today THEN
    _warnings := _warnings || jsonb_build_array(jsonb_build_object('code','HEALTH_OVERDUE','message','건강진단 기한 초과'));
  END IF;

  IF _w.health_checkup_status IN ('유소견D1','유소견D2') THEN
    _warnings := _warnings || jsonb_build_array(jsonb_build_object('code','HEALTH_RESTRICTED','message','유소견자 - 작업제한 검토 필요'));
  END IF;

  IF _w.special_education_required_until IS NOT NULL AND _w.special_education_required_until < _today THEN
    _warnings := _warnings || jsonb_build_array(jsonb_build_object('code','EDUCATION_EXPIRED','message','특별교육 이수 만료'));
  END IF;

  RETURN jsonb_build_object('warnings', _warnings);
END; $$;

-- ============ Update worker_daily_scan to include health warnings ============
CREATE OR REPLACE FUNCTION public.worker_daily_scan(
  _token text, _action text, _signature text,
  _ra_confirmed boolean DEFAULT false,
  _edu_confirmed boolean DEFAULT false,
  _tbm_confirmed boolean DEFAULT false,
  _no_accident boolean DEFAULT false,
  _ack_warnings boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q record;
  _open_log uuid;
  _new_log uuid;
  _now timestamptz := now();
  _warn jsonb;
  _warn_items jsonb;
BEGIN
  IF _signature IS NULL OR length(_signature) < 100 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED');
  END IF;
  IF _action NOT IN ('entry','exit') THEN
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;

  SELECT dq.id, dq.worker_id, dq.project_id, dq.work_date, dq.expires_at,
         dq.used_for_entry, dq.used_for_exit, w.name, w.company_name
    INTO _q
    FROM public.worker_daily_qr dq
    JOIN public.workers w ON w.id = dq.worker_id
   WHERE dq.qr_token = _token LIMIT 1;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_TOKEN'); END IF;
  IF _q.expires_at < _now THEN
    RETURN jsonb_build_object('error', 'EXPIRED', 'message', '오늘자 QR이 만료되었습니다.');
  END IF;

  _warn := public.get_worker_health_warnings(_q.worker_id);
  _warn_items := COALESCE(_warn->'warnings', '[]'::jsonb);

  IF _action = 'entry' THEN
    IF _q.used_for_entry THEN
      RETURN jsonb_build_object('error', 'ALREADY_ENTERED');
    END IF;
    -- if warnings exist and user has not acknowledged, return them
    IF jsonb_array_length(_warn_items) > 0 AND NOT COALESCE(_ack_warnings,false) THEN
      RETURN jsonb_build_object('warning', true, 'warnings', _warn_items,
        'message','건강진단/특별교육 미이수 항목이 있습니다. 확인 후 진행하세요.');
    END IF;
    INSERT INTO public.worker_entry_logs (
      worker_id, project_id, daily_qr_id, entry_at, entry_signature_data,
      risk_assessment_confirmed, education_confirmed, tbm_confirmed, entry_method,
      health_warning_shown, health_warning_items
    ) VALUES (
      _q.worker_id, _q.project_id, _q.id, _now, _signature,
      COALESCE(_ra_confirmed,false), COALESCE(_edu_confirmed,false), COALESCE(_tbm_confirmed,false),
      'self_qr', jsonb_array_length(_warn_items) > 0, _warn_items
    ) RETURNING id INTO _new_log;
    UPDATE public.worker_daily_qr SET used_for_entry = true WHERE id = _q.id;

    -- notify safety managers about warning entries
    IF jsonb_array_length(_warn_items) > 0 THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      SELECT pm.user_id, 'health_warning',
             '미이수 근로자 출근: ' || _q.name,
             '경고 항목 ' || jsonb_array_length(_warn_items) || '건',
             '/health/checkups'
        FROM public.project_members pm
       WHERE pm.project_id = _q.project_id
         AND pm.role_new IN ('project_admin','safety_manager');
    END IF;

    RETURN jsonb_build_object('success', true, 'action', 'entry', 'log_id', _new_log,
      'worker_name', _q.name, 'company_name', COALESCE(_q.company_name,''),
      'warnings', _warn_items);
  ELSE
    IF NOT COALESCE(_no_accident,false) THEN
      RETURN jsonb_build_object('error', 'NO_ACCIDENT_REQUIRED');
    END IF;
    SELECT id INTO _open_log FROM public.worker_entry_logs
     WHERE daily_qr_id = _q.id AND exit_at IS NULL LIMIT 1;
    IF _open_log IS NULL THEN
      RETURN jsonb_build_object('error', 'NO_OPEN_ENTRY');
    END IF;
    UPDATE public.worker_entry_logs
      SET exit_at = _now, exit_signature_data = _signature, no_accident_confirmed = true
    WHERE id = _open_log;
    UPDATE public.worker_daily_qr SET used_for_exit = true WHERE id = _q.id;
    RETURN jsonb_build_object('success', true, 'action', 'exit', 'log_id', _open_log);
  END IF;
END; $$;
