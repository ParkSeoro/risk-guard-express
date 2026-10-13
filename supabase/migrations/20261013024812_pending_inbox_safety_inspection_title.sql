-- 결재 대기에서 안전점검 제목이 '-'로 보이던 문제.
-- 양식명(일일/장비/고소/시설물/순회 등)·점검일·작성회사를 채운다.

DROP FUNCTION IF EXISTS public.get_my_pending_entity_approvals();
CREATE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid,
  entity_type text,
  entity_id uuid,
  project_id uuid,
  step text,
  step_order integer,
  step_position text,
  created_at timestamp with time zone,
  entity_title text,
  entity_date date,
  company_name text,
  personnel_count integer,
  approval_version integer,
  resubmit_count integer,
  submitted_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE
           WHEN a.entity_type='work_plan' THEN wp.title
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.work_name,''), per.work_description, '작업허가서')
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN ar.period_label
           WHEN a.entity_type='safety_inspection' THEN
             CASE si.inspection_type
               WHEN 'daily_sf006' THEN '일일 안전점검표'
               WHEN 'equipment_sf007' THEN '건설장비작업 안전점검표'
               WHEN 'height_sf008' THEN '고소작업 안전점검표'
               WHEN 'facility_sf009' THEN '시설물 안전점검표'
               WHEN 'patrol' THEN '순회 안전점검일지'
               WHEN 'pre_work' THEN
                 '작업 전 점검(일일)' || CASE WHEN NULLIF(btrim(COALESCE(si.process_category,'')),'') IS NOT NULL
                   AND si.process_category <> '공식양식' THEN ' · ' || si.process_category ELSE '' END
               WHEN 'during_work' THEN
                 '작업 중 점검' || CASE WHEN NULLIF(btrim(COALESCE(si.process_category,'')),'') IS NOT NULL
                   AND si.process_category <> '공식양식' THEN ' · ' || si.process_category ELSE '' END
               WHEN 'weekly' THEN
                 '주간 점검' || CASE WHEN NULLIF(btrim(COALESCE(si.process_category,'')),'') IS NOT NULL
                   AND si.process_category <> '공식양식' THEN ' · ' || si.process_category ELSE '' END
               WHEN 'monthly' THEN
                 '월간 점검' || CASE WHEN NULLIF(btrim(COALESCE(si.process_category,'')),'') IS NOT NULL
                   AND si.process_category <> '공식양식' THEN ' · ' || si.process_category ELSE '' END
               WHEN 'special' THEN
                 '특별 점검' || CASE WHEN NULLIF(btrim(COALESCE(si.process_category,'')),'') IS NOT NULL
                   AND si.process_category <> '공식양식' THEN ' · ' || si.process_category ELSE '' END
               ELSE COALESCE(NULLIF(btrim(COALESCE(si.location,'')),''), '안전점검')
             END
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan' THEN wp.start_date
           WHEN a.entity_type='work_permit' THEN per.permit_date
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN ar.start_date
           WHEN a.entity_type='safety_inspection' THEN (si.inspected_at AT TIME ZONE 'Asia/Seoul')::date
           ELSE NULL END AS entity_date,
         CASE
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.contractor_company,''), a.company_name)
           WHEN a.entity_type='work_plan' THEN COALESCE(NULLIF(wpc.name,''), NULLIF(author_co.name,''), a.company_name, '')
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN COALESCE(NULLIF(author_co.name,''), a.company_name, '')
           WHEN a.entity_type='safety_inspection' THEN COALESCE(NULLIF(sic.name,''), a.company_name, '')
           ELSE COALESCE(a.company_name, '')
         END AS company_name,
         CASE WHEN a.entity_type='work_permit' THEN per.personnel_count ELSE NULL END AS personnel_count,
         a.approval_version,
         GREATEST(COALESCE(a.approval_version, 1) - 1, 0) AS resubmit_count,
         CASE WHEN a.entity_type='work_permit' THEN per.submitted_at ELSE NULL END AS submitted_at
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type IN ('assessment_run', 'assessment_run_feedback')
                                        AND ar.id = a.entity_id
    LEFT JOIN public.safety_inspections si ON a.entity_type='safety_inspection' AND si.id = a.entity_id
    LEFT JOIN public.companies sic
      ON a.entity_type='safety_inspection'
     AND sic.id = si.company_id
     AND COALESCE(sic.is_deleted, false) = false
    LEFT JOIN public.companies wpc
      ON a.entity_type='work_plan'
     AND wpc.id = wp.company_id
     AND COALESCE(wpc.is_deleted, false) = false
    LEFT JOIN LATERAL (
      SELECT c.name
      FROM public.project_members pm
      JOIN public.companies c
        ON c.id = pm.company_id
       AND COALESCE(c.is_deleted, false) = false
      WHERE a.entity_type IN ('work_plan', 'assessment_run', 'assessment_run_feedback')
        AND pm.project_id = a.project_id
        AND pm.user_id = CASE
          WHEN a.entity_type='work_plan' THEN COALESCE(wp.author_user_id, wp.created_by)
          ELSE COALESCE(ar.author_user_id, ar.created_by)
        END
      ORDER BY CASE WHEN pm.company_id IS NOT NULL THEN 0 ELSE 1 END
      LIMIT 1
    ) author_co ON true
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND public.account_is_active(auth.uid())
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
     AND NOT public.approval_entity_is_deleted(a.entity_type, a.entity_id)
     AND NOT public.approval_entity_is_voided(a.entity_type, a.entity_id)
   ORDER BY
     CASE WHEN lower(COALESCE(a.position,'')) = 'closure_sm' THEN 0 ELSE 1 END,
     a.created_at DESC;
$body$;

REVOKE ALL ON FUNCTION public.get_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated, service_role;
