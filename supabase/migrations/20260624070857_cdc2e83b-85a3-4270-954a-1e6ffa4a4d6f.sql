
-- Phase B3/B4 (fixed for todo_items schema: user_id, status='미완료')

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

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, changes, reason)
  VALUES (_caller, 'approval_delegate', 'approvals', _approval_id,
          jsonb_build_object('from', _a.approver_id, 'to', _new_approver_id), _reason);

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_new_approver_id, 'approval_request', '결재 위임 도착',
          '[' || COALESCE(_a.step,'결재') || '] 위임 사유: ' || _reason, '/approvals');

  RETURN jsonb_build_object('success', true, 'approval_id', _approval_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.delegate_approval(uuid, uuid, text) TO authenticated;

-- Approval inserted → notify approver
CREATE OR REPLACE FUNCTION public.trg_approval_notify_approver()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.approver_id IS NOT NULL AND NEW.status = '대기' THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.approver_id, 'approval_request',
            '신규 결재 요청: ' || COALESCE(NEW.step,''),
            '결재 대기 항목이 도착했습니다.', '/approvals');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_approval_notify_approver ON public.approvals;
CREATE TRIGGER trg_approval_notify_approver
AFTER INSERT ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_approval_notify_approver();

-- Approval approved/rejected → notify creator
CREATE OR REPLACE FUNCTION public.trg_approval_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _creator uuid; _title text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('승인','반려') THEN RETURN NEW; END IF;
  IF NEW.run_id IS NOT NULL THEN
    SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = NEW.run_id;
  ELSIF NEW.risk_item_id IS NOT NULL THEN
    SELECT created_by INTO _creator FROM public.risk_items WHERE id = NEW.risk_item_id;
  END IF;
  IF _creator IS NULL THEN RETURN NEW; END IF;
  _title := CASE WHEN NEW.status = '승인' THEN '결재 승인됨' ELSE '결재 반려됨' END;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_creator,
          CASE WHEN NEW.status = '승인' THEN 'approval_approved' ELSE 'approval_rejected' END,
          _title || ': ' || COALESCE(NEW.step,''),
          COALESCE(NEW.comment, ''), '/approvals');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_approval_status_change ON public.approvals;
CREATE TRIGGER trg_approval_status_change
AFTER UPDATE OF status ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_approval_status_change();

-- Inspection action dispatch
CREATE OR REPLACE FUNCTION public.trg_inspection_action_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _existing uuid;
BEGIN
  IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.assignee_id IS DISTINCT FROM NEW.assignee_id))
     AND NEW.assignee_id IS NOT NULL AND NEW.status NOT IN ('done','closed') THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.assignee_id,
            CASE WHEN NEW.severity IN ('high','critical') THEN 'critical_alert' ELSE 'task_assigned' END,
            '[안전점검 시정조치] ' || COALESCE(NEW.severity,'') || ' 배정',
            COALESCE(NEW.issue,''), '/safety-inspections');
  END IF;

  IF NEW.severity IN ('high','critical') AND NEW.status NOT IN ('done','closed')
     AND NEW.assignee_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.todo_items
     WHERE source_table = 'safety_inspection_actions' AND source_id = NEW.id
       AND COALESCE(is_deleted,false) = false LIMIT 1;
    IF _existing IS NULL THEN
      INSERT INTO public.todo_items (
        project_id, user_id, title, description, due_date, status, frequency,
        source_table, source_id, category, created_at, updated_at
      ) VALUES (
        NEW.project_id, NEW.assignee_id,
        '[점검시정] ' || COALESCE(NEW.issue,'조치 필요'),
        COALESCE(NEW.completion_note,''),
        COALESCE(NEW.due_date, CURRENT_DATE + 7),
        '미완료', 'once',
        'safety_inspection_actions', NEW.id, 'inspection',
        now(), now()
      );
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_safety_inspection_action_todo ON public.safety_inspection_actions;
DROP TRIGGER IF EXISTS trg_inspection_action_dispatch ON public.safety_inspection_actions;
CREATE TRIGGER trg_inspection_action_dispatch
AFTER INSERT OR UPDATE ON public.safety_inspection_actions
FOR EACH ROW EXECUTE FUNCTION public.trg_inspection_action_dispatch();

-- Todo user assignment notify
CREATE OR REPLACE FUNCTION public.trg_todo_notify_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id))
     AND NEW.user_id IS NOT NULL
     AND COALESCE(NEW.status,'미완료') NOT IN ('완료','done','cancelled') THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'task_assigned',
            '[할일] ' || COALESCE(NEW.title,'신규 배정'),
            '기한: ' || COALESCE(NEW.due_date::text,'미지정'), '/todo');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_todo_notify_user ON public.todo_items;
CREATE TRIGGER trg_todo_notify_user
AFTER INSERT OR UPDATE OF user_id ON public.todo_items
FOR EACH ROW EXECUTE FUNCTION public.trg_todo_notify_user();

-- project_members role change audit + notify
CREATE OR REPLACE FUNCTION public.trg_project_members_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role_new IS DISTINCT FROM NEW.role_new THEN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, changes)
    VALUES (auth.uid(), 'role_change', 'project_members', NEW.id,
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
DROP TRIGGER IF EXISTS trg_project_members_audit ON public.project_members;
CREATE TRIGGER trg_project_members_audit
AFTER UPDATE ON public.project_members
FOR EACH ROW EXECUTE FUNCTION public.trg_project_members_audit();

-- Extend integrity check
CREATE OR REPLACE FUNCTION public.check_data_integrity(_project_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _findings jsonb := '[]'::jsonb; _c int;
BEGIN
  IF NOT (public.is_master(auth.uid())
          OR (_project_id IS NOT NULL AND public.is_project_member(auth.uid(), _project_id))) THEN
    RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COUNT(*) INTO _c FROM public.project_members pm
   LEFT JOIN public.profiles p ON p.user_id = pm.user_id
   WHERE p.user_id IS NULL AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','PM_PROFILE_ORPHAN','severity','high','count',_c,
    'message','project_members rows without matching profile')); END IF;

  SELECT COUNT(*) INTO _c FROM public.workers w
   WHERE w.is_active = true AND w.company_id IS NULL
     AND (_project_id IS NULL OR w.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','WORKER_NO_COMPANY','severity','medium','count',_c,
    'message','active workers without company_id')); END IF;

  SELECT COUNT(*) INTO _c FROM public.worker_entry_logs wel
   WHERE wel.daily_qr_id IS NULL
     AND (wel.entry_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
     AND (_project_id IS NULL OR wel.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','ENTRY_NO_DAILY_QR','severity','low','count',_c,
    'message','today entry logs not linked to a daily QR')); END IF;

  SELECT COUNT(*) INTO _c FROM public.project_members pm
   JOIN public.companies c ON c.id = pm.company_id
   WHERE pm.company IS NOT NULL AND pm.company <> '' AND pm.company <> c.name
     AND (_project_id IS NULL OR pm.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','PM_COMPANY_TEXT_DRIFT','severity','low','count',_c,
    'message','project_members.company text differs from companies.name')); END IF;

  SELECT COUNT(*) INTO _c FROM public.risk_items ri
   WHERE COALESCE(ri.is_deleted,false) = false
     AND (COALESCE(ri.severity,1) * COALESCE(ri.frequency,1)) >= 6
     AND (_project_id IS NULL OR ri.project_id = _project_id)
     AND NOT EXISTS (SELECT 1 FROM public.todo_items td
        WHERE td.source_table = 'risk_items' AND td.source_id = ri.id
          AND COALESCE(td.is_deleted,false) = false);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','HIGH_RISK_NO_TODO','severity','high','count',_c,
    'message','high risk items (>=6) without a follow-up todo')); END IF;

  SELECT COUNT(*) INTO _c FROM public.chemicals ch
   WHERE COALESCE(ch.is_deleted,false) = false
     AND (ch.is_carcinogen = true OR ch.is_reproductive_toxin = true)
     AND (_project_id IS NULL OR ch.project_id = _project_id)
     AND NOT EXISTS (SELECT 1 FROM public.health_checkups hc
        WHERE hc.project_id = ch.project_id
          AND COALESCE(hc.is_deleted,false) = false
          AND hc.type::text ILIKE '%special%');
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','CARCINOGEN_NO_SPECIAL_CHECKUP','severity','high','count',_c,
    'message','carcinogen/repro-toxin MSDS registered but no special health checkup recorded')); END IF;

  SELECT COUNT(*) INTO _c FROM (
    SELECT factor_id, MAX(measured_at) AS last_at, project_id
      FROM public.work_env_measurements
     WHERE COALESCE(is_deleted,false) = false
       AND (_project_id IS NULL OR project_id = _project_id)
     GROUP BY factor_id, project_id) s WHERE s.last_at < now() - INTERVAL '6 months';
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','ENV_MEASUREMENT_OVERDUE','severity','high','count',_c,
    'message','factors with no measurement in 6 months (시행규칙 §202)')); END IF;

  SELECT COUNT(*) INTO _c FROM public.safety_inspection_actions sia
   WHERE sia.status NOT IN ('done','closed')
     AND sia.due_date IS NOT NULL AND sia.due_date < CURRENT_DATE
     AND (_project_id IS NULL OR sia.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','INSPECTION_ACTION_OVERDUE','severity','high','count',_c,
    'message','open inspection actions past due date')); END IF;

  SELECT COUNT(*) INTO _c FROM public.approvals a
   WHERE a.status = '대기' AND a.approver_id IS NULL
     AND (_project_id IS NULL OR a.project_id = _project_id);
  IF _c > 0 THEN _findings := _findings || jsonb_build_array(jsonb_build_object(
    'code','APPROVAL_NO_APPROVER','severity','medium','count',_c,
    'message','pending approvals with no approver assigned')); END IF;

  RETURN jsonb_build_object(
    'checked_at', now(), 'project_id', _project_id,
    'findings', _findings, 'total_findings', jsonb_array_length(_findings));
END; $$;
