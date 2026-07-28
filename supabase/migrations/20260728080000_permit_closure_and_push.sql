-- Work permit closure (2nd approval) lifecycle + richer approval push copy.
-- Statuses (free text on work_permits.status):
--   승인 / 승인완료 / 발행완료  → pre-work approved
--   종료대기 (CLOSURE_PENDING) → day after work date; SM must confirm
--   종료완료 (CLOSED)          → SM confirmed work completion

-- 1) Promote approved permits whose work day has passed → 종료대기 + closure approval row
CREATE OR REPLACE FUNCTION public.promote_permits_to_closure_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_sm_id uuid;
  v_sm_name text;
  v_ver integer;
  v_order integer;
  v_title text;
BEGIN
  FOR r IN
    SELECT p.*
      FROM public.work_permits p
     WHERE COALESCE(p.status, '') IN ('승인', '승인완료', '발행완료', 'APPROVED', 'ISSUED', 'approved')
       AND COALESCE(p.is_deleted, false) = false
       AND (
         -- work date is strictly before today (next calendar day after permit/work date)
         COALESCE(
           NULLIF(p.permit_date::text, '')::date,
           (NULLIF(p.form_data->>'work_end', ''))::timestamptz::date,
           (NULLIF(p.form_data->>'work_start', ''))::timestamptz::date
         ) < CURRENT_DATE
       )
  LOOP
    -- Resolve original owner_sm from latest approval version
    SELECT a.approver_id, a.approver_name, a.approval_version
      INTO v_sm_id, v_sm_name, v_ver
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND a.entity_id = r.id
       AND lower(COALESCE(a.position, '')) IN ('owner_sm', 'sm')
       AND a.status = '승인'
     ORDER BY a.approval_version DESC, a.step_order DESC
     LIMIT 1;

    IF v_sm_id IS NULL THEN
      -- Fallback: any SM role member on the project (client company)
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
         AND lower(COALESCE(c.type, '')) IN ('client', '발주처')
       LIMIT 1;
      SELECT COALESCE(MAX(approval_version), 0) INTO v_ver
        FROM public.approvals WHERE entity_type = 'work_permit' AND entity_id = r.id;
    END IF;

    IF v_sm_id IS NULL THEN
      CONTINUE; -- cannot enqueue without SM
    END IF;

    -- Skip if closure step already open/done
    IF EXISTS (
      SELECT 1 FROM public.approvals a
       WHERE a.entity_type = 'work_permit' AND a.entity_id = r.id
         AND lower(COALESCE(a.position, '')) = 'closure_sm'
         AND a.status IN ('대기', '진행중', '승인')
    ) THEN
      UPDATE public.work_permits SET status = '종료대기', updated_at = now() WHERE id = r.id AND status IS DISTINCT FROM '종료대기';
      CONTINUE;
    END IF;

    SELECT COALESCE(MAX(step_order), 0) + 1 INTO v_order
      FROM public.approvals
     WHERE entity_type = 'work_permit' AND entity_id = r.id AND approval_version = v_ver;

    v_title := COALESCE(NULLIF(r.work_name, ''), NULLIF(r.work_description, ''), '작업허가서');

    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, step, step_order, status, approval_version,
      approver_id, approver_name, position
    ) VALUES (
      r.project_id, 'work_permit', r.id,
      '작업 완료 확인', GREATEST(v_order, 90), '진행중', COALESCE(v_ver, 1),
      v_sm_id, COALESCE(v_sm_name, ''), 'closure_sm'
    );

    UPDATE public.work_permits
       SET status = '종료대기', updated_at = now()
     WHERE id = r.id;

    -- Explicit push-oriented notification (trigger also fires on INSERT 진행중)
    INSERT INTO public.notifications
      (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
    VALUES
      (v_sm_id, r.project_id, 'approval_request',
       '작업 완료 확인 요망',
       '결재 요청: ' || v_title || ' 허가서의 작업 완료 확인이 필요합니다.',
       '결재 요청: ' || v_title || ' 허가서의 작업 완료 확인이 필요합니다.',
       'work_permit', r.id::text, '/m/approvals', false);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_permits_to_closure_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_permits_to_closure_pending() TO service_role, authenticated;

-- 2) When approving closure_sm step → CLOSED + stamp form signatures
CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _a record;
  _next record;
  _prior_pending integer;
  _now timestamptz := now();
  _all_done boolean;
  _plan_id uuid;
  _permit record;
  _sigs jsonb;
  _title text;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  SELECT COUNT(*) INTO _prior_pending FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND step_order < _a.step_order
     AND status NOT IN ('승인')
     AND lower(COALESCE(position,'')) <> 'closure_sm';
  -- Closure step is independent of prior-version incomplete rows except other open steps same version
  IF lower(COALESCE(_a.position,'')) <> 'closure_sm' AND _prior_pending > 0 THEN
    RETURN jsonb_build_object('error','PRIOR_STEP_NOT_APPROVED');
  END IF;

  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''),
         approved_at=_now,
         updated_at=_now
   WHERE id=_approval_id;

  -- Closure reject: stay 종료대기 (SM can retry) — cancel only this step
  IF _action='reject' AND lower(COALESCE(_a.position,'')) = 'closure_sm' THEN
    UPDATE public.work_permits
       SET status='종료대기', updated_at=_now
     WHERE id=_a.entity_id;
    RETURN jsonb_build_object('success', true, 'action','closure_rejected');
  END IF;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits
         SET status='반려',
             rejection_reason=COALESCE(_comment,''),
             updated_at=_now
       WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='rejected', updated_at=_now WHERE id=_a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  -- Closure approve → CLOSED + stamp bottom 승인자
  IF _action='approve' AND lower(COALESCE(_a.position,'')) = 'closure_sm'
     AND _a.entity_type = 'work_permit' THEN
    SELECT * INTO _permit FROM public.work_permits WHERE id = _a.entity_id;
    _sigs := COALESCE(_permit.signatures, '{}'::jsonb);
    _sigs := _sigs || jsonb_build_object(
      'closure_approver', jsonb_build_object(
        'name', COALESCE(_a.approver_name, ''),
        'signature', COALESCE(_sigs->'closure_approver'->>'signature', ''),
        'signed_at', _now
      ),
      'closed_at', _now
    );
    UPDATE public.work_permits
       SET status = '종료완료',
           signatures = _sigs,
           form_data = COALESCE(form_data, '{}'::jsonb) || jsonb_build_object(
             'closed_at', _now,
             'closed_by', auth.uid(),
             'closed_by_name', COALESCE(_a.approver_name, '')
           ),
           updated_at = _now
     WHERE id = _a.entity_id;

    _title := COALESCE(NULLIF(_permit.work_name, ''), NULLIF(_permit.work_description, ''), '작업허가서');
    IF _permit.created_by IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (_permit.created_by, _permit.project_id, 'approval_result',
         '작업 완료 확인 완료',
         _title || ' 허가서가 종료(마감)되었습니다.',
         _title || ' 허가서가 종료(마감)되었습니다.',
         'work_permit', _permit.id::text, '/work-permits/' || _permit.id::text, false);
    END IF;

    RETURN jsonb_build_object('success', true, 'action','closed', 'finalized', true);
  END IF;

  -- Promote next waiting step
  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND status='대기'
     AND step_order>_a.step_order
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    RETURN jsonb_build_object('success', true, 'action','forwarded', 'next_step_order', _next.step_order);
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type=_a.entity_type
       AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version
       AND status IN ('대기','진행중')
  ) INTO _all_done;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING id INTO _plan_id;
      IF _plan_id IS NOT NULL THEN
        UPDATE public.work_permits
           SET status = CASE WHEN status IN ('승인','발행완료','반려','종료대기','종료완료') THEN status ELSE '승인' END,
               approved_at = COALESCE(approved_at, _now),
               updated_at = _now
         WHERE work_plan_id = _plan_id
           AND COALESCE(status,'') NOT IN ('승인','발행완료','반려','종료대기','종료완료');
      END IF;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits
         SET status='승인',
             approved_at=_now,
             approved_by=auth.uid(),
             updated_at=_now
       WHERE id=_a.entity_id
         AND COALESCE(status,'') NOT IN ('종료대기','종료완료');
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='approved', updated_at=_now WHERE id=_a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.act_on_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.act_on_entity_approval(_approval_id, _action, _comment);
$function$;

-- 3) Richer pending list title (work_name) for push/inbox copy
CREATE OR REPLACE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid, entity_type text, entity_id uuid, project_id uuid,
  step text, step_order integer, step_position text,
  created_at timestamp with time zone, entity_title text, entity_date date
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.title
           WHEN a.entity_type='work_permit'    THEN COALESCE(NULLIF(per.work_name,''), per.work_description, '작업허가서')
           WHEN a.entity_type='assessment_run' THEN ar.period_label
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.start_date
           WHEN a.entity_type='work_permit'    THEN per.permit_date
           WHEN a.entity_type='assessment_run' THEN ar.start_date
           ELSE NULL END AS entity_date
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type='assessment_run' AND ar.id  = a.entity_id
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
   ORDER BY
     CASE WHEN lower(COALESCE(a.position,'')) = 'closure_sm' THEN 0 ELSE 1 END,
     a.created_at DESC;
$$;

-- 4) Enrich approval_request notification message with document title
CREATE OR REPLACE FUNCTION public.trg_approval_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  _entity_label text;
  _entity_link text;
  _creator uuid;
  _all_done boolean;
  _target_id uuid;
  _entity_type text;
  _entity_id uuid;
  _doc_title text;
  _msg text;
BEGIN
  _entity_type := COALESCE(NEW.entity_type, TG_ARGV[0]);
  _entity_id   := COALESCE(NEW.entity_id, NEW.run_id);

  _entity_label := CASE _entity_type
    WHEN 'work_plan' THEN '작업계획서'
    WHEN 'work_permit' THEN '작업허가서'
    WHEN 'assessment_run' THEN '위험성평가'
    WHEN 'safety_cost' THEN '산업안전보건관리비'
    WHEN 'incident' THEN '사고보고'
    WHEN 'emergency_drill' THEN '비상대피훈련'
    WHEN 'tbm' THEN 'TBM 일지'
    ELSE COALESCE(_entity_type,'문서') END;

  _entity_link := CASE _entity_type
    WHEN 'work_plan'      THEN '/work-plan/' || COALESCE(_entity_id::text,'')
    WHEN 'work_permit'    THEN '/m/approvals'
    WHEN 'assessment_run' THEN '/assessment-run/' || COALESCE(_entity_id::text,'')
    WHEN 'safety_cost'    THEN '/safety-cost'
    WHEN 'incident'       THEN '/incidents'
    WHEN 'emergency_drill' THEN '/emergency-drills'
    WHEN 'tbm'            THEN '/tbm-logs'
    ELSE '/approvals' END;

  _doc_title := NULL;
  IF _entity_type = 'work_permit' THEN
    SELECT COALESCE(NULLIF(work_name,''), NULLIF(work_description,''), '작업허가서')
      INTO _doc_title FROM public.work_permits WHERE id = _entity_id;
  ELSIF _entity_type = 'work_plan' THEN
    SELECT title INTO _doc_title FROM public.work_plans WHERE id = _entity_id;
  END IF;
  _doc_title := COALESCE(_doc_title, _entity_label);

  IF lower(COALESCE(NEW.position,'')) = 'closure_sm' THEN
    _msg := '결재 요청: ' || _doc_title || ' 허가서의 작업 완료 확인이 필요합니다.';
  ELSE
    _msg := '결재 요청: ' || _doc_title || ' 허가서가 도착했습니다.';
    IF _entity_type <> 'work_permit' THEN
      _msg := '결재 요청: ' || _doc_title || '이(가) 도착했습니다.';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = '진행중' AND NEW.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (NEW.approver_id, NEW.project_id, 'approval_request',
         CASE WHEN lower(COALESCE(NEW.position,'')) = 'closure_sm'
              THEN '작업 완료 확인 요망' ELSE _entity_label || ' 결재 요청' END,
         _msg, _msg,
         _entity_type, _entity_id::text, _entity_link, false);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = '진행중'
       AND NEW.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (NEW.approver_id, NEW.project_id, 'approval_request',
         CASE WHEN lower(COALESCE(NEW.position,'')) = 'closure_sm'
              THEN '작업 완료 확인 요망' ELSE _entity_label || ' 결재 요청' END,
         _msg, _msg,
         _entity_type, _entity_id::text, _entity_link, false);
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = '반려' THEN
      _creator := NULL;
      IF _entity_type = 'work_plan' THEN
        SELECT created_by INTO _creator FROM public.work_plans WHERE id = _entity_id;
      ELSIF _entity_type = 'work_permit' THEN
        SELECT created_by INTO _creator FROM public.work_permits WHERE id = _entity_id;
      ELSIF _entity_type = 'assessment_run' THEN
        BEGIN SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = _entity_id;
        EXCEPTION WHEN OTHERS THEN _creator := NULL; END;
      END IF;
      IF _creator IS NOT NULL THEN
        INSERT INTO public.notifications
          (user_id, project_id, type, title, message, body, related_type, related_id, link, severity, is_read)
        VALUES
          (_creator, NEW.project_id, 'approval_result',
           _entity_label || ' 반려',
           _doc_title || '이(가) 반려되었습니다.',
           _doc_title || '이(가) 반려되었습니다.',
           _entity_type, _entity_id::text, _entity_link, 'warning', false);
      END IF;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = '승인' THEN
      SELECT NOT EXISTS (
        SELECT 1 FROM public.approvals
         WHERE entity_type = _entity_type AND entity_id = _entity_id
           AND approval_version = NEW.approval_version
           AND status IN ('대기','진행중')
      ) INTO _all_done;
      IF _all_done AND lower(COALESCE(NEW.position,'')) <> 'closure_sm' THEN
        _creator := NULL;
        IF _entity_type = 'work_plan' THEN
          SELECT created_by INTO _creator FROM public.work_plans WHERE id = _entity_id;
        ELSIF _entity_type = 'work_permit' THEN
          SELECT created_by INTO _creator FROM public.work_permits WHERE id = _entity_id;
        ELSIF _entity_type = 'assessment_run' THEN
          BEGIN SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = _entity_id;
          EXCEPTION WHEN OTHERS THEN _creator := NULL; END;
        END IF;
        IF _creator IS NOT NULL THEN
          INSERT INTO public.notifications
            (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
          VALUES
            (_creator, NEW.project_id, 'approval_result',
             _entity_label || ' 최종 승인',
             _doc_title || '이(가) 최종 승인되었습니다.',
             _doc_title || '이(가) 최종 승인되었습니다.',
             _entity_type, _entity_id::text, _entity_link, false);
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
