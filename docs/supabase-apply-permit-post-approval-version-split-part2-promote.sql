-- SafeNex PART 2/4: promote_permits_to_closure_pending — NEW approval_version
-- Paste into Supabase SQL Editor and Run alone, then the next part.
-- Uses body dollar-quotes (SQL Editor-safe).

CREATE OR REPLACE FUNCTION public.promote_permits_to_closure_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  r record;
  v_count integer := 0;
  v_sm_id uuid;
  v_sm_name text;
  v_sup_id uuid;
  v_sup_name text;
  v_ver integer;
  v_title text;
  v_eff_date date;
BEGIN
  FOR r IN
    SELECT p.*
      FROM public.work_permits p
     WHERE COALESCE(p.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
       AND COALESCE(p.is_deleted, false) = false
  LOOP
    v_eff_date := COALESCE(
      (r.extension_until)::date,
      NULLIF(r.form_data->>'work_extend_until', '')::timestamptz::date,
      (r.work_end_at)::date,
      NULLIF(r.form_data->>'work_end', '')::timestamptz::date,
      NULLIF(r.permit_date::text, '')::date
    );
    IF v_eff_date IS NULL OR v_eff_date >= CURRENT_DATE THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.approvals a
       WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
         AND lower(COALESCE(a.position, '')) = 'extend_sm'
         AND a.status IN ('대기', '진행중')
    ) THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.approvals a
       WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
         AND lower(COALESCE(a.position, '')) IN ('closure_sm', 'closure_supervisor')
         AND a.status IN ('대기', '진행중', '승인')
    ) THEN
      UPDATE public.work_permits
         SET status = '종료대기', updated_at = now()
       WHERE id = r.id AND status IS DISTINCT FROM '종료대기';
      CONTINUE;
    END IF;

    SELECT a.approver_id, a.approver_name
      INTO v_sm_id, v_sm_name
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('owner_sm', 'sm')
       AND a.status = '승인'
     ORDER BY a.approval_version DESC, a.step_order DESC
     LIMIT 1;

    IF v_sm_id IS NULL THEN
      SELECT pm.user_id, COALESCE(pr.display_name, '')
        INTO v_sm_id, v_sm_name
        FROM public.project_members pm
        LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
        LEFT JOIN public.companies c ON c.id = pm.company_id
       WHERE pm.project_id = r.project_id
         AND (
           lower(COALESCE(pm.position_new::text, '')) IN ('owner_sm', 'owner_hse')
           OR lower(COALESCE(pm.role_new::text, '')) = 'safety_manager'
         )
         AND lower(COALESCE(c.type, '')) IN ('client', '발주처', 'owner')
       ORDER BY pm.created_at ASC NULLS LAST
       LIMIT 1;
    END IF;

    IF v_sm_id IS NULL THEN
      CONTINUE;
    END IF;

    v_sup_id := NULL;
    v_sup_name := NULL;
    SELECT a.approver_id, a.approver_name
      INTO v_sup_id, v_sup_name
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('contractor_supervisor', 'site_supervisor')
       AND a.status = '승인'
       AND a.approver_id IS NOT NULL
     ORDER BY a.approval_version DESC, a.step_order ASC
     LIMIT 1;

    IF v_sup_id IS NULL THEN
      SELECT pm.user_id, COALESCE(pr.display_name, '')
        INTO v_sup_id, v_sup_name
        FROM public.project_members pm
        LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
       WHERE pm.project_id = r.project_id
         AND (
           upper(COALESCE(pm.position_new::text, '')) = 'SITE_SUPERVISOR'
           OR lower(COALESCE(pm.role_new::text, '')) IN ('site_supervisor', 'supervisor')
         )
         AND (r.company_id IS NULL OR pm.company_id = r.company_id)
       ORDER BY pm.created_at ASC NULLS LAST
       LIMIT 1;
    END IF;

    SELECT COALESCE(MAX(approval_version), 0) + 1 INTO v_ver
      FROM public.approvals
     WHERE entity_type = 'work_permit' AND entity_id = r.id;

    v_title := COALESCE(NULLIF(r.work_name, ''), NULLIF(r.work_description, ''), '작업허가서');

    IF v_sup_id IS NOT NULL AND v_sup_id IS DISTINCT FROM v_sm_id THEN
      INSERT INTO public.approvals (
        project_id, entity_type, entity_id, step, step_order, status, approval_version,
        approver_id, approver_name, position
      ) VALUES (
        r.project_id, 'work_permit', r.id,
        '관리감독자 작업 완료 확인', 1, '진행중', v_ver,
        v_sup_id, COALESCE(v_sup_name, ''), 'closure_supervisor'
      );

      INSERT INTO public.approvals (
        project_id, entity_type, entity_id, step, step_order, status, approval_version,
        approver_id, approver_name, position
      ) VALUES (
        r.project_id, 'work_permit', r.id,
        '발주처 SM 작업 완료 승인', 2, '대기', v_ver,
        v_sm_id, COALESCE(v_sm_name, ''), 'closure_sm'
      );
    ELSE
      INSERT INTO public.approvals (
        project_id, entity_type, entity_id, step, step_order, status, approval_version,
        approver_id, approver_name, position
      ) VALUES (
        r.project_id, 'work_permit', r.id,
        '작업 완료 확인', 1, '진행중', v_ver,
        v_sm_id, COALESCE(v_sm_name, ''), 'closure_sm'
      );
    END IF;

    UPDATE public.work_permits
       SET status = '종료대기', updated_at = now()
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$body$;
