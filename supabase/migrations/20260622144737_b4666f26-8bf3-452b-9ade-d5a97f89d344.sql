
ALTER TABLE public.approvals
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS entity_id uuid,
  ADD COLUMN IF NOT EXISTS step_order int DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_approvals_entity ON public.approvals(entity_type, entity_id);

CREATE OR REPLACE FUNCTION public.submit_entity_for_approval(
  _entity_type text, _entity_id uuid, _project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _step record; _count int := 0; _now timestamptz := now();
BEGIN
  IF _entity_type NOT IN ('work_plan','work_permit') THEN
    RETURN jsonb_build_object('error','UNSUPPORTED_ENTITY');
  END IF;
  IF EXISTS (SELECT 1 FROM public.approvals
              WHERE entity_type=_entity_type AND entity_id=_entity_id
                AND status IN ('대기','진행중')) THEN
    RETURN jsonb_build_object('error','ALREADY_SUBMITTED');
  END IF;

  FOR _step IN
    SELECT step_order, step_label, position AS pos, user_id, user_name, company_id, company_name
      FROM public.approval_lines
     WHERE project_id = _project_id
     ORDER BY step_order ASC
  LOOP
    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, step, step_order, position,
      approver_id, approver_name, company_id, company_name, status, created_at, updated_at
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      COALESCE(_step.step_label, '결재'), _step.step_order, COALESCE(_step.pos,''),
      _step.user_id, COALESCE(_step.user_name,''), _step.company_id, COALESCE(_step.company_name,''),
      CASE WHEN _count = 0 THEN '진행중' ELSE '대기' END, _now, _now
    );
    _count := _count + 1;
  END LOOP;

  IF _count = 0 THEN
    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, step, step_order, status, created_at, updated_at,
      approver_id, approver_name
    )
    SELECT _project_id, _entity_type, _entity_id, '관리자 승인', 1, '진행중', _now, _now,
           pm.user_id, COALESCE(p.display_name, '')
      FROM public.project_members pm
      LEFT JOIN public.profiles p ON p.user_id = pm.user_id
     WHERE pm.project_id = _project_id AND pm.role_new = 'project_admin'
     LIMIT 1;
    _count := 1;
  END IF;

  IF _entity_type = 'work_plan' THEN
    UPDATE public.work_plans SET status='결재중', updated_at=_now WHERE id=_entity_id;
  ELSIF _entity_type = 'work_permit' THEN
    UPDATE public.work_permits SET status='검토대기', updated_at=_now WHERE id=_entity_id;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT a.approver_id, 'approval_request',
    CASE WHEN _entity_type='work_plan' THEN '작업계획서 결재 요청' ELSE '작업허가서 결재 요청' END,
    '결재가 필요합니다.',
    CASE WHEN _entity_type='work_plan' THEN '/work-plans' ELSE '/work-permits' END
   FROM public.approvals a
  WHERE a.entity_type=_entity_type AND a.entity_id=_entity_id
    AND a.status='진행중' AND a.approver_id IS NOT NULL;

  RETURN jsonb_build_object('success', true, 'steps', _count);
END; $$;

GRANT EXECUTE ON FUNCTION public.submit_entity_for_approval(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid, _action text, _comment text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _a record; _next record; _now timestamptz := now();
  _all_done boolean; _creator uuid;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_PENDING'); END IF;
  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''), approved_at = _now, updated_at = _now
   WHERE id = _approval_id;

  IF _action = 'reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id
        RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='반려', rejection_reason=COALESCE(_comment,''),
             updated_at=_now WHERE id=_a.entity_id RETURNING created_by INTO _creator;
    END IF;

    IF _creator IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_creator, 'approval_result',
        CASE WHEN _a.entity_type='work_plan' THEN '작업계획서 반려' ELSE '작업허가서 반려' END,
        COALESCE(_comment, '결재가 반려되었습니다.'),
        CASE WHEN _a.entity_type='work_plan' THEN '/work-plans' ELSE '/work-permits' END);
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'rejected');
  END IF;

  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND status='대기' AND step_order > _a.step_order
   ORDER BY step_order ASC LIMIT 1;

  IF FOUND THEN
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    IF _next.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_next.approver_id, 'approval_request',
        CASE WHEN _a.entity_type='work_plan' THEN '작업계획서 결재 요청' ELSE '작업허가서 결재 요청' END,
        '결재가 필요합니다.',
        CASE WHEN _a.entity_type='work_plan' THEN '/work-plans' ELSE '/work-permits' END);
    END IF;
    RETURN jsonb_build_object('success', true, 'action','forwarded');
  END IF;

  SELECT bool_and(status='승인') INTO _all_done FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='승인', approved_at=_now,
             approved_by=auth.uid(), updated_at=_now WHERE id=_a.entity_id
        RETURNING created_by INTO _creator;
    END IF;
    IF _creator IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_creator, 'approval_result',
        CASE WHEN _a.entity_type='work_plan' THEN '작업계획서 최종 승인' ELSE '작업허가서 최종 승인' END,
        '결재가 완료되었습니다.',
        CASE WHEN _a.entity_type='work_plan' THEN '/work-plans' ELSE '/work-permits' END);
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'action','approved');
END; $$;

GRANT EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid, entity_type text, entity_id uuid, project_id uuid,
  step text, step_order int, step_position text, created_at timestamptz,
  entity_title text, entity_date date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE WHEN a.entity_type='work_plan' THEN wp.title
              WHEN a.entity_type='work_permit' THEN per.work_description
              ELSE '' END AS entity_title,
         CASE WHEN a.entity_type='work_plan' THEN wp.start_date
              WHEN a.entity_type='work_permit' THEN per.permit_date
              ELSE NULL END AS entity_date
    FROM public.approvals a
    LEFT JOIN public.work_plans wp ON a.entity_type='work_plan' AND wp.id = a.entity_id
    LEFT JOIN public.work_permits per ON a.entity_type='work_permit' AND per.id = a.entity_id
   WHERE a.status='진행중'
     AND a.entity_type IS NOT NULL
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
   ORDER BY a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated;
