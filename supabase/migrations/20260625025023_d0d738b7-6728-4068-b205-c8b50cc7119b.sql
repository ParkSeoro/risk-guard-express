-- Fix audit_logs column mismatch: existing schema uses (target_type, target_id, details)
-- Recreate functions/triggers that erroneously used (table_name, record_id, changes)

-- 1) project_members role change audit trigger
CREATE OR REPLACE FUNCTION public.trg_project_members_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role_new IS DISTINCT FROM NEW.role_new THEN
    INSERT INTO public.audit_logs (user_id, action, target_type, target_id, project_id, details)
    VALUES (auth.uid(), 'role_change', 'project_members', NEW.id::text, NEW.project_id,
            jsonb_build_object('user_id', NEW.user_id, 'project_id', NEW.project_id,
                               'from', OLD.role_new, 'to', NEW.role_new));
    IF NEW.user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (NEW.user_id, 'role_changed',
              '프로젝트 권한 변경', '새 역할: ' || COALESCE(NEW.role_new::text,''), '/projects');
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 2) delegate_approval audit
CREATE OR REPLACE FUNCTION public.delegate_approval(
  _approval_id uuid, _new_approver_id uuid, _reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a record; _new_name text; _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RETURN jsonb_build_object('error','REASON_REQUIRED'); END IF;
  SELECT * INTO _a FROM public.approvals WHERE id = _approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF _a.status <> '대기' THEN
    RETURN jsonb_build_object('error','NOT_PENDING','status',_a.status); END IF;
  IF NOT (_a.approver_id = _caller OR public.is_master(_caller)
          OR public.has_project_role(_caller, _a.project_id, ARRAY['project_admin']::public.project_role[])) THEN
    RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(display_name, full_name, '') INTO _new_name
    FROM public.profiles WHERE user_id = _new_approver_id;

  UPDATE public.approvals
     SET approver_id = _new_approver_id,
         approver_name = COALESCE(_new_name, ''),
         comment = COALESCE(comment,'') ||
           CASE WHEN COALESCE(comment,'') = '' THEN '' ELSE E'\n' END
           || '[위임] ' || _reason || ' (by ' || _caller || ' at ' || now() || ')',
         updated_at = now()
   WHERE id = _approval_id;

  INSERT INTO public.audit_logs (user_id, action, target_type, target_id, project_id, details)
  VALUES (_caller, 'approval_delegate', 'approvals', _approval_id::text, _a.project_id,
          jsonb_build_object('from', _a.approver_id, 'to', _new_approver_id, 'reason', _reason));

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_new_approver_id, 'approval_request', '결재 위임 도착',
          '[' || COALESCE(_a.step,'결재') || '] 위임 사유: ' || _reason, '/approvals');

  RETURN jsonb_build_object('success', true, 'approval_id', _approval_id);
END; $$;

-- 3) derive_permit_from_work_plan audit
CREATE OR REPLACE FUNCTION public.derive_permit_from_work_plan(_work_plan_id uuid, _permit_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  INSERT INTO public.audit_logs (user_id, action, target_type, target_id, project_id, details)
  VALUES (auth.uid(), 'derive_from_work_plan', 'work_permits', _new_id::text, _wp.project_id,
          jsonb_build_object('source_work_plan_id', _work_plan_id));

  RETURN jsonb_build_object('success', true, 'permit_id', _new_id, 'reused', false);
END; $$;

-- 4) derive_tbm_from_work_plan audit
CREATE OR REPLACE FUNCTION public.derive_tbm_from_work_plan(_work_plan_id uuid, _tbm_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  INSERT INTO public.audit_logs (user_id, action, target_type, target_id, project_id, details)
  VALUES (auth.uid(), 'derive_from_work_plan', 'tbm_sessions', _new_id::text, _wp.project_id,
          jsonb_build_object('source_work_plan_id', _work_plan_id));

  RETURN jsonb_build_object('success', true, 'tbm_id', _new_id, 'reused', false);
END; $$;