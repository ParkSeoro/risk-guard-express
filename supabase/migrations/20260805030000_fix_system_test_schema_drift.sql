-- Fix schema drift surfaced by System Test Engine (2026-08-05 run).
-- 1) check_data_integrity referenced emergency_drills.conducted_at (gone) → conducted_date
-- 2) health/env write RLS blocked master (system test + ops)

CREATE OR REPLACE FUNCTION public.check_data_integrity(_project_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(code text, severity text, count bigint, detail text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      WHERE conducted_date >= (CURRENT_DATE - interval '12 months')
        AND COALESCE(is_deleted, false) = false
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
      WHERE role_type IN ('safety_manager','안전관리자')
        AND COALESCE(is_deleted, false) = false
        AND (ended_at IS NULL OR ended_at::date >= CURRENT_DATE)
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
END;
$function$;

REVOKE ALL ON FUNCTION public.check_data_integrity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_data_integrity(uuid) TO authenticated, service_role;

-- Master must write health/env tables (ops + system test engine)
DROP POLICY IF EXISTS hc_write ON public.health_checkups;
CREATE POLICY hc_write ON public.health_checkups
FOR ALL TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(), project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
)
WITH CHECK (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(), project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
);

DROP POLICY IF EXISTS hc_select ON public.health_checkups;
CREATE POLICY hc_select ON public.health_checkups
FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.can_access_company_data(auth.uid(), project_id, company_id)
);

DROP POLICY IF EXISTS env_factors_write ON public.work_env_factors;
CREATE POLICY env_factors_write ON public.work_env_factors
FOR ALL TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(), project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
)
WITH CHECK (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(), project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
);

DROP POLICY IF EXISTS env_factors_select ON public.work_env_factors;
CREATE POLICY env_factors_select ON public.work_env_factors
FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.is_project_member(auth.uid(), project_id)
);

DROP POLICY IF EXISTS wem_write ON public.work_env_measurements;
CREATE POLICY wem_write ON public.work_env_measurements
FOR ALL TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(), project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
)
WITH CHECK (
  public.is_master(auth.uid())
  OR public.has_project_role(
    auth.uid(), project_id,
    ARRAY['project_admin','safety_manager']::public.project_role[]
  )
);

DROP POLICY IF EXISTS wem_select ON public.work_env_measurements;
CREATE POLICY wem_select ON public.work_env_measurements
FOR SELECT TO authenticated
USING (
  public.is_master(auth.uid())
  OR public.is_project_member(auth.uid(), project_id)
);
