
ALTER TABLE public.incident_reports ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id);

CREATE TABLE IF NOT EXISTS public.worker_education_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id),
  education_type TEXT NOT NULL CHECK (education_type IN ('정기','채용시','작업변경시','특별','관리감독자','기초안전보건')),
  course_name TEXT NOT NULL,
  hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  completed_at DATE NOT NULL,
  next_due_at DATE,
  evidence_url TEXT,
  instructor TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_education_records TO authenticated;
GRANT ALL ON public.worker_education_records TO service_role;
ALTER TABLE public.worker_education_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edu_select" ON public.worker_education_records FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = worker_education_records.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "edu_insert" ON public.worker_education_records FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = worker_education_records.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "edu_update" ON public.worker_education_records FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = worker_education_records.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "edu_delete" ON public.worker_education_records FOR DELETE TO authenticated
USING (public.is_master(auth.uid()));

CREATE OR REPLACE FUNCTION public.fn_edu_next_due()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.next_due_at IS NULL THEN
    NEW.next_due_at := CASE NEW.education_type
      WHEN '정기' THEN (NEW.completed_at + INTERVAL '3 months')::date
      WHEN '관리감독자' THEN (NEW.completed_at + INTERVAL '12 months')::date
      WHEN '특별' THEN (NEW.completed_at + INTERVAL '12 months')::date
      ELSE NULL
    END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edu_next_due ON public.worker_education_records;
CREATE TRIGGER trg_edu_next_due BEFORE INSERT OR UPDATE ON public.worker_education_records
FOR EACH ROW EXECUTE FUNCTION public.fn_edu_next_due();

CREATE TABLE IF NOT EXISTS public.safety_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  full_name TEXT NOT NULL,
  role_type TEXT NOT NULL CHECK (role_type IN ('안전보건관리책임자','관리감독자','안전관리자','보건관리자','산업보건의','명예산업안전감독관')),
  company_id UUID REFERENCES public.companies(id),
  appointed_at DATE NOT NULL,
  ended_at DATE,
  reason TEXT,
  evidence_url TEXT,
  reported_to_authority_at TIMESTAMPTZ,
  authority_doc_no TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_appointments TO authenticated;
GRANT ALL ON public.safety_appointments TO service_role;
ALTER TABLE public.safety_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appt_select" ON public.safety_appointments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = safety_appointments.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "appt_mutate" ON public.safety_appointments FOR ALL TO authenticated
USING (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = safety_appointments.project_id AND pm.user_id = auth.uid() AND pm.role_new = 'project_admin'::project_role))
WITH CHECK (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = safety_appointments.project_id AND pm.user_id = auth.uid() AND pm.role_new = 'project_admin'::project_role));

ALTER TABLE public.safety_inspections
  ADD COLUMN IF NOT EXISTS inspection_category TEXT DEFAULT '자체점검',
  ADD COLUMN IF NOT EXISTS participating_company_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS legal_frequency TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='safety_inspections_category_chk') THEN
    ALTER TABLE public.safety_inspections ADD CONSTRAINT safety_inspections_category_chk
      CHECK (inspection_category IN ('자체점검','순회점검','합동점검','협의체회의'));
  END IF;
END $$;

CREATE OR REPLACE VIEW public.v_contractor_safety_scorecard AS
SELECT
  c.id AS company_id,
  c.name AS company_name,
  p.id AS project_id,
  COALESCE((SELECT COUNT(*) FROM public.workers w WHERE w.company_id = c.id AND w.project_id = p.id), 0) AS worker_count,
  COALESCE((SELECT COUNT(*) FROM public.incident_reports i WHERE i.company_id = c.id AND i.project_id = p.id AND i.is_deleted = false), 0) AS incident_count,
  COALESCE((SELECT COUNT(*) FROM public.incident_reports i WHERE i.company_id = c.id AND i.project_id = p.id AND i.is_major = true AND i.is_deleted = false), 0) AS major_incident_count,
  COALESCE((SELECT COUNT(*) FROM public.safety_inspection_actions a JOIN public.safety_inspections s ON s.id = a.inspection_id WHERE s.project_id = p.id AND a.status = '미완료' AND a.due_date < CURRENT_DATE), 0) AS overdue_actions,
  COALESCE((SELECT COUNT(*) FROM public.worker_education_records e WHERE e.company_id = c.id AND e.project_id = p.id AND e.is_deleted = false), 0) AS education_count,
  COALESCE((SELECT COUNT(*) FROM public.tbm_participations tp JOIN public.tbm_sessions ts ON ts.id = tp.tbm_session_id WHERE ts.project_id = p.id AND tp.company_name = c.name), 0) AS tbm_participations
FROM public.companies c
CROSS JOIN public.projects p
WHERE EXISTS (SELECT 1 FROM public.workers w WHERE w.company_id = c.id AND w.project_id = p.id);
GRANT SELECT ON public.v_contractor_safety_scorecard TO authenticated;

CREATE TABLE IF NOT EXISTS public.work_stop_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES public.workers(id),
  reporter_name TEXT NOT NULL,
  location TEXT,
  hazard_description TEXT NOT NULL,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT '접수' CHECK (status IN ('접수','확인중','조치완료','반려')),
  resumed_at TIMESTAMPTZ,
  resumed_by UUID REFERENCES auth.users(id),
  resolution_note TEXT,
  retaliation_flag BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_stop_requests TO authenticated;
GRANT ALL ON public.work_stop_requests TO service_role;
ALTER TABLE public.work_stop_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wsr_select" ON public.work_stop_requests FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = work_stop_requests.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "wsr_insert" ON public.work_stop_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "wsr_update" ON public.work_stop_requests FOR UPDATE TO authenticated
USING (public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = work_stop_requests.project_id AND pm.user_id = auth.uid() AND pm.role_new = 'project_admin'::project_role));

CREATE OR REPLACE FUNCTION public.fn_work_stop_notify()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, project_id, type, title, body, severity, link)
  SELECT pm.user_id, NEW.project_id, 'work_stop_request', '🛑 작업중지 요청 접수',
         COALESCE(NEW.hazard_description,'위험상황'), 'critical', '/work-stop/' || NEW.id::text
  FROM public.project_members pm
  WHERE pm.project_id = NEW.project_id AND pm.role_new = 'project_admin'::project_role;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_work_stop_notify ON public.work_stop_requests;
CREATE TRIGGER trg_work_stop_notify AFTER INSERT ON public.work_stop_requests
FOR EACH ROW EXECUTE FUNCTION public.fn_work_stop_notify();

CREATE TABLE IF NOT EXISTS public.assessment_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  acknowledged_worker_ids UUID[] DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_notices TO authenticated;
GRANT ALL ON public.assessment_notices TO service_role;
ALTER TABLE public.assessment_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notice_select" ON public.assessment_notices FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = assessment_notices.project_id AND pm.user_id = auth.uid()));
CREATE POLICY "notice_mutate" ON public.assessment_notices FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = assessment_notices.project_id AND pm.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = assessment_notices.project_id AND pm.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.pii_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  project_id UUID,
  worker_id UUID,
  access_type TEXT NOT NULL CHECK (access_type IN ('view_unmasked','export','print','download')),
  fields TEXT[] DEFAULT '{}',
  reason TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.pii_access_logs TO authenticated;
GRANT ALL ON public.pii_access_logs TO service_role;
ALTER TABLE public.pii_access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pii_log_insert" ON public.pii_access_logs FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY "pii_log_select" ON public.pii_access_logs FOR SELECT TO authenticated
USING (public.is_master(auth.uid()));

DROP FUNCTION IF EXISTS public.check_data_integrity(uuid);
CREATE OR REPLACE FUNCTION public.check_data_integrity(p_project_id UUID)
RETURNS TABLE(code TEXT, severity TEXT, message TEXT, ref_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT 'HIGH_RISK_NO_TODO'::TEXT, 'high'::TEXT,
         '고위험 항목에 후속 조치 없음: ' || COALESCE(ri.hazard,'')::TEXT, ri.id
  FROM public.risk_items ri
  WHERE ri.project_id = p_project_id AND ri.is_deleted = false
    AND (ri.severity * ri.frequency) >= 6
    AND NOT EXISTS (SELECT 1 FROM public.todo_items t WHERE t.ref_id = ri.id AND t.status != '완료');

  RETURN QUERY
  SELECT 'MAJOR_INCIDENT_OVERDUE'::TEXT, 'critical'::TEXT,
         '중대재해 24시간 보고 시한 경과: ' || COALESCE(i.description,'')::TEXT, i.id
  FROM public.incident_reports i
  WHERE i.project_id = p_project_id AND i.is_major = true
    AND i.reported_to_authority_at IS NULL AND i.legal_deadline_at < now();

  RETURN QUERY
  SELECT 'EMERGENCY_DRILL_MISSING'::TEXT, 'high'::TEXT,
         '최근 12개월 비상대피훈련 미실시'::TEXT, NULL::UUID
  WHERE NOT EXISTS (
    SELECT 1 FROM public.emergency_drills d
    WHERE d.project_id = p_project_id AND d.conducted_at > (now() - INTERVAL '12 months')
  );

  RETURN QUERY
  SELECT 'INSPECTION_ACTION_OVERDUE'::TEXT, 'high'::TEXT,
         '시정조치 기한 경과: ' || COALESCE(a.description,'')::TEXT, a.id
  FROM public.safety_inspection_actions a
  JOIN public.safety_inspections s ON s.id = a.inspection_id
  WHERE s.project_id = p_project_id AND a.status = '미완료' AND a.due_date < CURRENT_DATE;

  RETURN QUERY
  SELECT 'EDUCATION_OVERDUE'::TEXT, 'medium'::TEXT,
         '안전보건교육 주기 경과: ' || COALESCE(w.full_name,'근로자')::TEXT, w.id
  FROM public.worker_education_records e
  JOIN public.workers w ON w.id = e.worker_id
  WHERE e.project_id = p_project_id AND e.is_deleted = false
    AND e.next_due_at IS NOT NULL AND e.next_due_at < CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM public.worker_education_records e2
      WHERE e2.worker_id = e.worker_id AND e2.education_type = e.education_type
        AND e2.completed_at > e.completed_at AND e2.is_deleted = false
    );

  RETURN QUERY
  SELECT 'SAFETY_MANAGER_MISSING'::TEXT, 'high'::TEXT,
         '안전관리자 선임 기록 없음'::TEXT, NULL::UUID
  WHERE NOT EXISTS (
    SELECT 1 FROM public.safety_appointments a
    WHERE a.project_id = p_project_id AND a.role_type = '안전관리자'
      AND a.is_deleted = false AND (a.ended_at IS NULL OR a.ended_at > CURRENT_DATE)
  );

  RETURN QUERY
  SELECT 'WORK_STOP_PENDING'::TEXT, 'critical'::TEXT,
         '미해결 작업중지 요청: ' || COALESCE(w.location, w.hazard_description,'')::TEXT, w.id
  FROM public.work_stop_requests w
  WHERE w.project_id = p_project_id AND w.status IN ('접수','확인중');
END $$;
