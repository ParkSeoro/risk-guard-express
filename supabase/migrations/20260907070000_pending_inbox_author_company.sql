-- 결재 대기 회사명 = 작성회사. 현재 결재자 회사(발주처 SM)를 쓰지 않는다.
-- 작업허가서는 contractor_company, 작업계획서는 work_plans.company_id,
-- 위험성평가는 author_user_id 소속 회사.

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
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan' THEN wp.start_date
           WHEN a.entity_type='work_permit' THEN per.permit_date
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN ar.start_date
           ELSE NULL END AS entity_date,
         CASE
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.contractor_company,''), a.company_name)
           WHEN a.entity_type='work_plan' THEN COALESCE(NULLIF(wpc.name,''), NULLIF(author_co.name,''), a.company_name, '')
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN COALESCE(NULLIF(author_co.name,''), a.company_name, '')
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
   ORDER BY
     CASE WHEN lower(COALESCE(a.position,'')) = 'closure_sm' THEN 0 ELSE 1 END,
     a.created_at DESC;
$body$;

REVOKE ALL ON FUNCTION public.get_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated, service_role;
