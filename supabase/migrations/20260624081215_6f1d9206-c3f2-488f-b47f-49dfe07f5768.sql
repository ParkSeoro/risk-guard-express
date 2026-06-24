
DROP FUNCTION IF EXISTS public.check_data_integrity(uuid);

-- safety_cost_violations (idempotent)
CREATE TABLE IF NOT EXISTS public.safety_cost_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid REFERENCES public.safety_cost_monthly_reports(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  company_id uuid,
  violation_code text NOT NULL,
  severity text NOT NULL DEFAULT 'high',
  category_code text,
  expected_amount numeric,
  actual_amount numeric,
  detail text,
  legal_basis text,
  resolved_at timestamptz,
  resolved_by uuid,
  is_deleted boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_cost_violations TO authenticated;
GRANT ALL ON public.safety_cost_violations TO service_role;
ALTER TABLE public.safety_cost_violations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='safety_cost_violations' AND policyname='scv_select') THEN
    CREATE POLICY "scv_select" ON public.safety_cost_violations FOR SELECT TO authenticated
    USING (public.is_master(auth.uid())
      OR public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[]));
    CREATE POLICY "scv_insert" ON public.safety_cost_violations FOR INSERT TO authenticated
    WITH CHECK (public.is_master(auth.uid())
      OR public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[]));
    CREATE POLICY "scv_update" ON public.safety_cost_violations FOR UPDATE TO authenticated
    USING (public.is_master(auth.uid())
      OR public.has_project_role(auth.uid(), project_id, ARRAY['project_admin','safety_manager']::public.project_role[]));
    CREATE POLICY "scv_delete" ON public.safety_cost_violations FOR DELETE TO authenticated
    USING (public.is_master(auth.uid()));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_scv_updated_at ON public.safety_cost_violations;
CREATE TRIGGER trg_scv_updated_at BEFORE UPDATE ON public.safety_cost_violations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_scv_report ON public.safety_cost_violations(report_id);
CREATE INDEX IF NOT EXISTS idx_scv_project ON public.safety_cost_violations(project_id) WHERE is_deleted = false;

-- validate_safety_cost_report
CREATE OR REPLACE FUNCTION public.validate_safety_cost_report(_report_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _r record; _violations int := 0; _total numeric := 0; _personnel numeric := 0; _education numeric := 0; _ppe numeric := 0;
BEGIN
  SELECT * INTO _r FROM public.safety_cost_monthly_reports WHERE id = _report_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  DELETE FROM public.safety_cost_violations WHERE report_id = _report_id;
  SELECT COALESCE(SUM(amount),0) INTO _total FROM public.safety_cost_items WHERE report_id = _report_id AND COALESCE(is_deleted,false)=false;
  SELECT COALESCE(SUM(amount),0) INTO _personnel FROM public.safety_cost_items
   WHERE report_id = _report_id AND COALESCE(is_deleted,false)=false
     AND (category_code ILIKE '%personnel%' OR category_name ILIKE '%인건%' OR category_name ILIKE '%안전관리자%');
  SELECT COALESCE(SUM(amount),0) INTO _education FROM public.safety_cost_items
   WHERE report_id = _report_id AND COALESCE(is_deleted,false)=false
     AND (category_code ILIKE '%edu%' OR category_name ILIKE '%교육%');
  SELECT COALESCE(SUM(amount),0) INTO _ppe FROM public.safety_cost_items
   WHERE report_id = _report_id AND COALESCE(is_deleted,false)=false
     AND (category_code ILIKE '%ppe%' OR category_name ILIKE '%보호구%');

  IF _total > 0 AND _personnel / _total > 0.5 THEN
    INSERT INTO public.safety_cost_violations
      (report_id, project_id, company_id, violation_code, severity, category_code, expected_amount, actual_amount, detail, legal_basis)
    VALUES (_report_id, _r.project_id, _r.company_id, 'PERSONNEL_RATIO_EXCEEDED', 'medium',
      'personnel', _total * 0.5, _personnel,
      '인건비가 전체의 ' || round((_personnel/_total*100)::numeric,1) || '% (권고 50% 초과)',
      '산업안전보건관리비 계상 및 사용기준 고시');
    _violations := _violations + 1;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.safety_cost_items sci
    WHERE sci.report_id = _report_id AND COALESCE(sci.is_deleted,false)=false AND sci.amount > 0
      AND NOT EXISTS (SELECT 1 FROM public.safety_cost_evidence_files ef WHERE ef.item_id = sci.id)
    LIMIT 1
  ) THEN
    INSERT INTO public.safety_cost_violations (report_id, project_id, company_id, violation_code, severity, detail, legal_basis)
    VALUES (_report_id, _r.project_id, _r.company_id, 'EVIDENCE_MISSING', 'high',
      '증빙파일 누락 항목 존재', '산업안전보건관리비 사용내역 증빙 보관 의무');
    _violations := _violations + 1;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.safety_cost_items
    WHERE report_id = _report_id AND COALESCE(is_deleted,false)=false
      AND COALESCE(classification_status,'pending') = 'pending' LIMIT 1
  ) THEN
    INSERT INTO public.safety_cost_violations (report_id, project_id, company_id, violation_code, severity, detail)
    VALUES (_report_id, _r.project_id, _r.company_id, 'CLASSIFICATION_PENDING', 'medium', '분류 미확정 항목 존재 - 검토 필요');
    _violations := _violations + 1;
  END IF;

  IF _violations > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT pm.user_id, 'critical_alert',
      '산업안전보건관리비 검증 위반 ' || _violations || '건',
      _r.title || ' / ' || _r.report_month::text, '/safety-cost'
    FROM public.project_members pm
    WHERE pm.project_id = _r.project_id AND pm.role_new IN ('project_admin','safety_manager');
  END IF;

  RETURN jsonb_build_object('success', true, 'report_id', _report_id, 'violations', _violations,
    'total', _total, 'personnel', _personnel, 'education', _education, 'ppe', _ppe);
END; $$;

-- acknowledge_assessment_notice
CREATE OR REPLACE FUNCTION public.acknowledge_assessment_notice(_notice_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('error','UNAUTHENTICATED'); END IF;
  UPDATE public.assessment_notices
    SET acknowledged_worker_ids = (
      SELECT array_agg(DISTINCT x) FROM unnest(
        COALESCE(acknowledged_worker_ids, ARRAY[]::uuid[]) || _uid
      ) AS t(x)
    ), updated_at = now()
  WHERE id = _notice_id;
  RETURN jsonb_build_object('success', true);
END; $$;

-- derive_permit_from_work_plan
CREATE OR REPLACE FUNCTION public.derive_permit_from_work_plan(_work_plan_id uuid, _permit_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _wp record; _new_id uuid; _date date := COALESCE(_permit_date, CURRENT_DATE);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO _wp FROM public.work_plans WHERE id = _work_plan_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF NOT public.is_project_member(auth.uid(), _wp.project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT id INTO _new_id FROM public.work_permits
   WHERE work_plan_id = _work_plan_id AND permit_date = _date AND COALESCE(is_deleted,false)=false LIMIT 1;
  IF _new_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'permit_id', _new_id, 'reused', true);
  END IF;

  INSERT INTO public.work_permits (
    project_id, work_plan_id, permit_date, work_description, location, status, created_at, updated_at
  ) VALUES (
    _wp.project_id, _work_plan_id, _date,
    COALESCE(_wp.work_content, _wp.title, '작업'), COALESCE(_wp.location, ''),
    '검토대기', now(), now()
  ) RETURNING id INTO _new_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, changes)
  VALUES (auth.uid(), 'derive_from_work_plan', 'work_permits', _new_id,
          jsonb_build_object('source_work_plan_id', _work_plan_id));

  RETURN jsonb_build_object('success', true, 'permit_id', _new_id, 'reused', false);
END; $$;

-- derive_tbm_from_work_plan
CREATE OR REPLACE FUNCTION public.derive_tbm_from_work_plan(_work_plan_id uuid, _tbm_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _wp record; _new_id uuid; _date date := COALESCE(_tbm_date, CURRENT_DATE); _token text := encode(gen_random_bytes(16), 'hex');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO _wp FROM public.work_plans WHERE id = _work_plan_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF NOT public.is_project_member(auth.uid(), _wp.project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT id INTO _new_id FROM public.tbm_sessions
   WHERE work_plan_id = _work_plan_id AND tbm_date = _date AND COALESCE(is_deleted,false)=false LIMIT 1;
  IF _new_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'tbm_id', _new_id, 'reused', true);
  END IF;

  INSERT INTO public.tbm_sessions (
    project_id, work_plan_id, qr_token, title, briefing_summary, tbm_date, location, is_active,
    work_content, created_by, created_at, updated_at
  ) VALUES (
    _wp.project_id, _work_plan_id, _token,
    'TBM - ' || COALESCE(_wp.title, '작업'),
    COALESCE(_wp.special_notes, ''), _date, COALESCE(_wp.location,''), true,
    COALESCE(_wp.work_content, ''), auth.uid(), now(), now()
  ) RETURNING id INTO _new_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, changes)
  VALUES (auth.uid(), 'derive_from_work_plan', 'tbm_sessions', _new_id,
          jsonb_build_object('source_work_plan_id', _work_plan_id));

  RETURN jsonb_build_object('success', true, 'tbm_id', _new_id, 'reused', false);
END; $$;

-- check_data_integrity (recreated with new return type)
CREATE OR REPLACE FUNCTION public.check_data_integrity(_project_id uuid DEFAULT NULL)
RETURNS TABLE(code text, severity text, count bigint, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 'HIGH_RISK_NO_TODO'::text, 'high'::text, COUNT(*)::bigint, '고위험 위험성평가 항목 중 할일 미생성'::text
    FROM public.risk_items ri
   WHERE COALESCE(ri.is_deleted,false)=false
     AND (COALESCE(ri.severity,1)*COALESCE(ri.frequency,1)) >= 6
     AND (_project_id IS NULL OR ri.project_id = _project_id)
     AND NOT EXISTS (SELECT 1 FROM public.todo_items t
                      WHERE t.source_table='risk_items' AND t.source_id=ri.id
                        AND COALESCE(t.is_deleted,false)=false)
  UNION ALL
  SELECT 'MAJOR_INCIDENT_OVERDUE'::text, 'critical'::text, COUNT(*)::bigint, '중대재해 24시간 보고 미이행'::text
    FROM public.incident_reports
   WHERE COALESCE(is_major,false) = true AND reported_to_authority_at IS NULL
     AND legal_deadline_at IS NOT NULL AND legal_deadline_at < now()
     AND (_project_id IS NULL OR project_id = _project_id)
  UNION ALL
  SELECT 'EMERGENCY_DRILL_MISSING'::text, 'high'::text, 1::bigint, '최근 12개월 비상대피훈련 기록 없음'::text
   WHERE NOT EXISTS (
     SELECT 1 FROM public.emergency_drills
      WHERE conducted_at >= (CURRENT_DATE - interval '12 months')
        AND (_project_id IS NULL OR project_id = _project_id))
  UNION ALL
  SELECT 'INSPECTION_ACTION_OVERDUE'::text, 'high'::text, COUNT(*)::bigint, '안전점검 시정조치 기한 초과'::text
    FROM public.safety_inspection_actions sa
    JOIN public.safety_inspections si ON si.id = sa.inspection_id
   WHERE sa.completed_at IS NULL AND sa.due_date < CURRENT_DATE
     AND (_project_id IS NULL OR si.project_id = _project_id)
  UNION ALL
  SELECT 'EDUCATION_OVERDUE'::text, 'high'::text, COUNT(*)::bigint, '안전보건교육 만기 초과'::text
    FROM public.worker_required_items
   WHERE item_type='education' AND status IN ('pending','overdue')
     AND due_date < CURRENT_DATE AND COALESCE(is_deleted,false)=false
     AND (_project_id IS NULL OR project_id = _project_id)
  UNION ALL
  SELECT 'SAFETY_MANAGER_MISSING'::text, 'critical'::text, 1::bigint, '현직 안전관리자 미선임 (산안법 §17)'::text
   WHERE NOT EXISTS (
     SELECT 1 FROM public.safety_appointments
      WHERE appointment_type IN ('safety_manager','안전관리자')
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)
        AND (_project_id IS NULL OR project_id = _project_id))
  UNION ALL
  SELECT 'WORK_STOP_PENDING'::text, 'critical'::text, COUNT(*)::bigint, '미처리 작업중지권 발동'::text
    FROM public.work_stop_requests
   WHERE status IN ('pending','reviewing')
     AND (_project_id IS NULL OR project_id = _project_id)
  UNION ALL
  SELECT 'SAFETY_COST_UNVALIDATED'::text, 'medium'::text, COUNT(*)::bigint, '월별 산안비 보고서 검증 미실시'::text
    FROM public.safety_cost_monthly_reports scr
   WHERE COALESCE(scr.is_deleted,false) = false
     AND scr.report_month < date_trunc('month', CURRENT_DATE)
     AND COALESCE(scr.status,'') NOT IN ('approved','승인완료')
     AND (_project_id IS NULL OR scr.project_id = _project_id)
  UNION ALL
  SELECT 'ASSESSMENT_NOTICE_UNREAD'::text, 'medium'::text, COUNT(*)::bigint, '위험성평가 공지 미확인 (근로자 0명 확인)'::text
    FROM public.assessment_notices an
   WHERE (an.expires_at IS NULL OR an.expires_at > now())
     AND COALESCE(array_length(an.acknowledged_worker_ids, 1), 0) = 0
     AND (_project_id IS NULL OR an.project_id = _project_id);
END; $$;
