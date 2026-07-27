-- =============================================================================
-- Unified Push Notification System
-- 1) notifications 중앙 테이블 (idempotent)
-- 2) device_push_tokens (Capacitor FCM/APNs)
-- 3) worker_zone_events → notifications (지오펜싱 침범)
-- 4) approvals → notifications (상신/진행/승인·반려)
-- 5) notifications INSERT → pg_net → dispatch-notification-push Edge Function
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1) notifications 중앙 테이블
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  body text,
  link text,
  severity text,
  type text NOT NULL DEFAULT 'general',
  related_id text,
  related_type text,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS link text,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS related_id text,
  ADD COLUMN IF NOT EXISTS related_type text,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type
  ON public.notifications (type);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;
CREATE POLICY "Users can insert own notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- message ↔ body 동기화
CREATE OR REPLACE FUNCTION public.sync_notification_body_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.message IS NULL AND NEW.body IS NOT NULL THEN
    NEW.message := NEW.body;
  ELSIF NEW.body IS NULL AND NEW.message IS NOT NULL THEN
    NEW.body := NEW.message;
  ELSIF NEW.message IS NOT NULL AND NEW.body IS NOT NULL AND TG_OP = 'INSERT' THEN
    -- keep both
    NULL;
  END IF;
  IF NEW.message IS NULL THEN NEW.message := ''; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_notification_body_message ON public.notifications;
CREATE TRIGGER trg_sync_notification_body_message
BEFORE INSERT OR UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.sync_notification_body_message();

-- ---------------------------------------------------------------------------
-- 2) Capacitor / 네이티브 푸시 토큰
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_id text,
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_push_tokens_user
  ON public.device_push_tokens (user_id);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own device tokens" ON public.device_push_tokens;
CREATE POLICY "Users manage own device tokens"
  ON public.device_push_tokens FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;
GRANT ALL ON public.device_push_tokens TO service_role;

-- ---------------------------------------------------------------------------
-- 3) 푸시 강제 타입에 위험구역 침범 포함
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  _is_mandatory boolean;
  _now_t time := (now() AT TIME ZONE 'Asia/Seoul')::time;
BEGIN
  _is_mandatory := _type IN (
    'incident',
    'approval_request',
    'approval_result',
    'approval_approved',
    'approval_rejected',
    'critical_alert',
    'danger_zone_entry'
  );

  SELECT * INTO p FROM public.notification_preferences WHERE user_id = _user_id;
  IF p IS NULL THEN RETURN true; END IF;
  IF NOT _is_mandatory AND COALESCE(p.channel_push, true) = false THEN RETURN false; END IF;

  IF NOT _is_mandatory AND p.push_quiet_start IS NOT NULL AND p.push_quiet_end IS NOT NULL THEN
    IF p.push_quiet_start < p.push_quiet_end THEN
      IF _now_t >= p.push_quiet_start AND _now_t < p.push_quiet_end THEN RETURN false; END IF;
    ELSE
      IF _now_t >= p.push_quiet_start OR _now_t < p.push_quiet_end THEN RETURN false; END IF;
    END IF;
  END IF;

  RETURN CASE _type
    WHEN 'approval_request'    THEN true
    WHEN 'approval_result'     THEN true
    WHEN 'approval_approved'   THEN true
    WHEN 'approval_rejected'   THEN true
    WHEN 'danger_zone_entry'   THEN true
    WHEN 'critical_alert'      THEN true
    WHEN 'incident'            THEN true
    WHEN 'return_request'      THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'   THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'         THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                 THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'      THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due'  THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'todo_due'            THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'   THEN COALESCE(p.event_assessment_result, false)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.should_push_notify(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers: 결재 딥링크 / 엔티티 작성자
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approval_entity_link(_entity_type text, _entity_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _entity_type
    WHEN 'work_plan' THEN '/work-plan/' || COALESCE(_entity_id::text, '')
    WHEN 'work_permit' THEN '/work-permits/' || COALESCE(_entity_id::text, '')
    WHEN 'assessment_run' THEN '/assessment-run/' || COALESCE(_entity_id::text, '')
    WHEN 'safety_cost' THEN '/safety-cost'
    WHEN 'incident' THEN '/incidents'
    WHEN 'emergency_drill' THEN '/emergency-drills'
    WHEN 'tbm' THEN '/tbm-logs'
    ELSE '/approvals'
  END;
$$;

CREATE OR REPLACE FUNCTION public.approval_entity_label(_entity_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _entity_type
    WHEN 'work_plan' THEN '작업계획서'
    WHEN 'work_permit' THEN '작업허가서'
    WHEN 'assessment_run' THEN '위험성평가'
    WHEN 'safety_cost' THEN '산업안전보건관리비'
    WHEN 'incident' THEN '사고보고'
    WHEN 'emergency_drill' THEN '비상대피훈련'
    WHEN 'tbm' THEN 'TBM 일지'
    ELSE COALESCE(_entity_type, '결재')
  END;
$$;

CREATE OR REPLACE FUNCTION public.approval_entity_creator(
  _entity_type text,
  _entity_id uuid,
  _run_id uuid DEFAULT NULL,
  _risk_item_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _creator uuid;
BEGIN
  IF _entity_type = 'work_plan' AND _entity_id IS NOT NULL THEN
    SELECT created_by INTO _creator FROM public.work_plans WHERE id = _entity_id;
  ELSIF _entity_type = 'work_permit' AND _entity_id IS NOT NULL THEN
    SELECT created_by INTO _creator FROM public.work_permits WHERE id = _entity_id;
  ELSIF _entity_type = 'assessment_run' AND _entity_id IS NOT NULL THEN
    BEGIN
      SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = _entity_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSIF _entity_type = 'safety_cost' AND _entity_id IS NOT NULL THEN
    BEGIN
      SELECT created_by INTO _creator FROM public.safety_cost_reports WHERE id = _entity_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSIF _run_id IS NOT NULL THEN
    BEGIN
      SELECT created_by INTO _creator FROM public.assessment_runs WHERE id = _run_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSIF _risk_item_id IS NOT NULL THEN
    BEGIN
      SELECT created_by INTO _creator FROM public.risk_items WHERE id = _risk_item_id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN _creator;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) 지오펜싱: unauthorized_entry → notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_zone_event_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _zone_name text;
  _zone_type text;
  _zone_label text;
  _display_name text;
  _link text;
  _uid uuid;
  _worker_title text;
  _worker_body text;
  _mgr_title text;
  _mgr_body text;
BEGIN
  IF NEW.event_type IS DISTINCT FROM 'unauthorized_entry' THEN
    RETURN NEW;
  END IF;

  SELECT name, zone_type INTO _zone_name, _zone_type
    FROM public.site_zones WHERE id = NEW.zone_id;
  _zone_name := COALESCE(_zone_name, '위험구역');
  _zone_type := COALESCE(_zone_type, 'danger');
  _zone_label := CASE WHEN _zone_type = 'restricted' THEN '제한구역' ELSE '위험구역' END;
  _display_name := COALESCE(NULLIF(NEW.worker_name, ''), '근로자');
  _link := '/zone-events?project=' || NEW.project_id::text;

  _worker_title := '⚠️ ' || _zone_label || ' 진입 경고';
  _worker_body := _zone_name || '에 진입했습니다. 즉시 이탈하십시오.';
  _mgr_title := '🚨 ' || _zone_label || ' 무단진입 발생';
  _mgr_body := _display_name || ' 근로자가 ' || _zone_name || '에 진입했습니다.';

  -- (a) 침범 당사자 (phone → profiles)
  IF NEW.worker_phone IS NOT NULL AND length(trim(NEW.worker_phone)) > 0 THEN
    SELECT p.user_id INTO _uid
      FROM public.profiles p
     WHERE p.phone = NEW.worker_phone
     LIMIT 1;
    IF _uid IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, project_id, type, title, message, body, link,
        related_type, related_id, severity
      ) VALUES (
        _uid, NEW.project_id, 'danger_zone_entry',
        _worker_title, _worker_body, _worker_body, _link,
        'zone_event', COALESCE(NEW.id::text, NEW.zone_id::text), 'critical'
      );
    END IF;
  END IF;

  -- (b) 현장 관리자 / HSE
  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity
  )
  SELECT DISTINCT pm.user_id, NEW.project_id, 'danger_zone_entry',
         _mgr_title, _mgr_body, _mgr_body, _link,
         'zone_event', COALESCE(NEW.id::text, NEW.zone_id::text), 'critical'
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.user_id IS NOT NULL
     AND (
       pm.position_new IN ('SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'SUPERVISOR')
       OR pm.role_new IN ('project_admin', 'safety_manager')
     )
     AND (_uid IS NULL OR pm.user_id <> _uid);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zone_event_notify ON public.worker_zone_events;
CREATE TRIGGER trg_zone_event_notify
AFTER INSERT ON public.worker_zone_events
FOR EACH ROW EXECUTE FUNCTION public.trg_zone_event_notify();

-- ---------------------------------------------------------------------------
-- 5) 전자결재: approvals → notifications
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_approval_notify_approver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _label text;
  _link text;
BEGIN
  -- 현재 결재 차례(진행중)인 행만 알림 — 대기 단계는 미리 알리지 않음
  IF NEW.approver_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM '진행중' THEN RETURN NEW; END IF;

  _label := public.approval_entity_label(NEW.entity_type);
  _link := public.approval_entity_link(NEW.entity_type, NEW.entity_id);

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity
  ) VALUES (
    NEW.approver_id,
    NEW.project_id,
    'approval_request',
    '결재 요청: ' || _label,
    '[' || COALESCE(NEW.step, '결재') || '] 결재가 필요합니다.',
    '[' || COALESCE(NEW.step, '결재') || '] 결재가 필요합니다.',
    _link,
    COALESCE(NEW.entity_type, 'approval'),
    COALESCE(NEW.entity_id::text, NEW.id::text),
    'high'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_notify_approver ON public.approvals;
CREATE TRIGGER trg_approval_notify_approver
AFTER INSERT ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_approval_notify_approver();

CREATE OR REPLACE FUNCTION public.trg_approval_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _creator uuid;
  _label text;
  _link text;
  _all_done boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  _label := public.approval_entity_label(NEW.entity_type);
  _link := public.approval_entity_link(NEW.entity_type, NEW.entity_id);

  -- 다음 결재자에게 전달 (대기 → 진행중)
  IF NEW.status = '진행중' AND OLD.status IS DISTINCT FROM '진행중' AND NEW.approver_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id, project_id, type, title, message, body, link,
      related_type, related_id, severity
    ) VALUES (
      NEW.approver_id,
      NEW.project_id,
      'approval_request',
      '결재 요청: ' || _label,
      '[' || COALESCE(NEW.step, '결재') || '] 결재가 필요합니다.',
      '[' || COALESCE(NEW.step, '결재') || '] 결재가 필요합니다.',
      _link,
      COALESCE(NEW.entity_type, 'approval'),
      COALESCE(NEW.entity_id::text, NEW.id::text),
      'high'
    );
    RETURN NEW;
  END IF;

  -- 반려 → 상신자
  IF NEW.status = '반려' THEN
    _creator := public.approval_entity_creator(
      NEW.entity_type, NEW.entity_id, NEW.run_id, NEW.risk_item_id
    );
    IF _creator IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, project_id, type, title, message, body, link,
        related_type, related_id, severity
      ) VALUES (
        _creator,
        NEW.project_id,
        'approval_result',
        _label || ' 반려',
        COALESCE(NULLIF(NEW.comment, ''), '결재가 반려되었습니다.'),
        COALESCE(NULLIF(NEW.comment, ''), '결재가 반려되었습니다.'),
        _link,
        COALESCE(NEW.entity_type, 'approval'),
        COALESCE(NEW.entity_id::text, NEW.id::text),
        'high'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- 최종 승인 완료 → 상신자 (해당 버전의 모든 스텝이 승인)
  IF NEW.status = '승인' AND NEW.entity_type IS NOT NULL AND NEW.entity_id IS NOT NULL THEN
    SELECT bool_and(a.status = '승인') INTO _all_done
      FROM public.approvals a
     WHERE a.entity_type = NEW.entity_type
       AND a.entity_id = NEW.entity_id
       AND a.approval_version = NEW.approval_version
       AND a.status <> '취소';

    IF COALESCE(_all_done, false) THEN
      _creator := public.approval_entity_creator(
        NEW.entity_type, NEW.entity_id, NEW.run_id, NEW.risk_item_id
      );
      IF _creator IS NOT NULL THEN
        INSERT INTO public.notifications (
          user_id, project_id, type, title, message, body, link,
          related_type, related_id, severity
        ) VALUES (
          _creator,
          NEW.project_id,
          'approval_result',
          _label || ' 최종 승인',
          '결재가 완료되었습니다.',
          '결재가 완료되었습니다.',
          _link,
          COALESCE(NEW.entity_type, 'approval'),
          COALESCE(NEW.entity_id::text, NEW.id::text),
          'normal'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_status_change ON public.approvals;
CREATE TRIGGER trg_approval_status_change
AFTER UPDATE OF status ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_approval_status_change();

-- RPC 쪽 중복 INSERT 제거: 트리거가 SSOT
CREATE OR REPLACE FUNCTION public.submit_approval(
  _entity_type text,
  _entity_id uuid,
  _project_id uuid,
  _company_id uuid,
  _steps jsonb,
  _reason text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_step jsonb;
  v_order integer := 1;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  UPDATE public.approvals
     SET status = '취소',
         comment = COALESCE(comment, '') || CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] ' || _reason ELSE '' END,
         updated_at = now()
   WHERE entity_type = _entity_type
     AND entity_id = _entity_id
     AND status IN ('대기', '진행중');

  SELECT COALESCE(MAX(approval_version), 0) + 1 INTO v_next_version
    FROM public.approvals
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    INSERT INTO public.approvals (
      project_id, entity_type, entity_id, run_id, step, step_order, status, approval_version,
      approver_id, approver_name, position, company_id, company_name
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type = 'assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label', '결재'), v_order,
      CASE WHEN v_order = 1 THEN '진행중' ELSE '대기' END,
      v_next_version,
      NULLIF(v_step->>'user_id', '')::uuid,
      COALESCE(v_step->>'user_name', ''),
      COALESCE(v_step->>'position', ''),
      NULLIF(v_step->>'company_id', '')::uuid,
      COALESCE(v_step->>'company_name', '')
    );
    -- 1스텝 INSERT(status=진행중) → trg_approval_notify_approver 가 알림 생성
    v_order := v_order + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  IF _entity_type = 'assessment_run' THEN
    BEGIN
      UPDATE public.assessment_runs
         SET status = '결재진행', updated_at = now()
       WHERE id = _entity_id AND status NOT IN ('승인완료');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _a record;
  _next record;
  _now timestamptz := now();
  _all_done boolean;
  _creator uuid;
  _plan_id uuid;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id = _approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;
  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error', 'NOT_PENDING'); END IF;
  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error', 'NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('error', 'INVALID_ACTION');
  END IF;

  UPDATE public.approvals
     SET status = CASE WHEN _action = 'approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment, ''),
         approved_at = _now,
         updated_at = _now
   WHERE id = _approval_id;
  -- 반려/최종승인 알림은 trg_approval_status_change 가 처리

  IF _action = 'reject' THEN
    UPDATE public.approvals
       SET status = '취소', updated_at = _now
     WHERE entity_type = _a.entity_type
       AND entity_id = _a.entity_id
       AND approval_version = _a.approval_version
       AND status IN ('대기', '진행중');

    IF _a.entity_type = 'work_plan' THEN
      UPDATE public.work_plans SET status = '반려', updated_at = _now WHERE id = _a.entity_id;
    ELSIF _a.entity_type = 'work_permit' THEN
      UPDATE public.work_permits
         SET status = '반려', rejection_reason = COALESCE(_comment, ''), updated_at = _now
       WHERE id = _a.entity_id;
    ELSIF _a.entity_type = 'assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status = 'rejected', updated_at = _now WHERE id = _a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    RETURN jsonb_build_object('success', true, 'action', 'rejected');
  END IF;

  SELECT * INTO _next
    FROM public.approvals
   WHERE entity_type = _a.entity_type
     AND entity_id = _a.entity_id
     AND approval_version = _a.approval_version
     AND status = '대기'
     AND step_order > _a.step_order
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    -- 다음 스텝 진행중 전환 → trg_approval_status_change 가 approval_request 발송
    UPDATE public.approvals SET status = '진행중', updated_at = _now WHERE id = _next.id;
    RETURN jsonb_build_object('success', true, 'action', 'forwarded');
  END IF;

  SELECT bool_and(status = '승인') INTO _all_done
    FROM public.approvals
   WHERE entity_type = _a.entity_type
     AND entity_id = _a.entity_id
     AND approval_version = _a.approval_version;

  IF _all_done THEN
    IF _a.entity_type = 'work_plan' THEN
      UPDATE public.work_plans SET status = '승인', updated_at = _now WHERE id = _a.entity_id
        RETURNING created_by, id INTO _creator, _plan_id;
      IF _plan_id IS NOT NULL THEN
        UPDATE public.work_permits
           SET status = CASE WHEN status IN ('승인', '반려') THEN status ELSE '승인' END,
               approved_at = COALESCE(approved_at, _now),
               updated_at = _now
         WHERE work_plan_id = _plan_id
           AND COALESCE(status, '') NOT IN ('승인', '반려');
      END IF;
    ELSIF _a.entity_type = 'work_permit' THEN
      UPDATE public.work_permits
         SET status = '승인', approved_at = _now, approved_by = auth.uid(), updated_at = _now
       WHERE id = _a.entity_id;
    ELSIF _a.entity_type = 'assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status = 'approved', updated_at = _now WHERE id = _a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'action', 'approved');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) notifications INSERT → pg_net → Edge Function
--    Dashboard Database Webhook 로도 동일 함수 URL 을 연결할 수 있음.
--    필수 설정 (SQL Editor 또는 Dashboard):
--      ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<ref>.supabase.co';
--      ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_jwt>';
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notifications_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _base text;
  _key text;
  _url text;
  _req_id bigint;
BEGIN
  BEGIN
    _base := NULLIF(current_setting('app.settings.supabase_url', true), '');
    _key := NULLIF(current_setting('app.settings.service_role_key', true), '');
  EXCEPTION WHEN OTHERS THEN
    _base := NULL;
    _key := NULL;
  END;

  -- vault 폴백 (설정된 경우)
  IF _base IS NULL THEN
    BEGIN
      SELECT decrypted_secret INTO _base
        FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN _base := NULL;
    END;
  END IF;
  IF _key IS NULL THEN
    BEGIN
      SELECT decrypted_secret INTO _key
        FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN _key := NULL;
    END;
  END IF;

  IF _base IS NULL OR _key IS NULL THEN
    RAISE NOTICE '[push] skip dispatch: app.settings.supabase_url / service_role_key not set';
    RETURN NEW;
  END IF;

  _url := rtrim(_base, '/') || '/functions/v1/dispatch-notification-push';

  BEGIN
    SELECT net.http_post(
      url := _url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || _key
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'notifications',
        'schema', 'public',
        'record', to_jsonb(NEW)
      )
    ) INTO _req_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[push] net.http_post failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_push ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trg_notifications_dispatch_push();
