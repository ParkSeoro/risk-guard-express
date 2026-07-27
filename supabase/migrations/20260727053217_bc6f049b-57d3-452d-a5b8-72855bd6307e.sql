-- Unified Push Notification System
-- 배포 후 한 번만 세팅:
--   ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<ref>.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<service_role_jwt>';
-- Secrets(edge functions): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, (선택) FCM_SERVER_KEY

CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- 1. notifications: 누락 컬럼 보강 + RLS 재정비
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  type text NOT NULL DEFAULT 'general',
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS body text,
  ADD COLUMN IF NOT EXISTS link text,
  ADD COLUMN IF NOT EXISTS severity text,
  ADD COLUMN IF NOT EXISTS related_id text,
  ADD COLUMN IF NOT EXISTS related_type text,
  ADD COLUMN IF NOT EXISTS project_id uuid;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;

CREATE POLICY "notif_select_own" ON public.notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif_update_own" ON public.notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif_delete_own" ON public.notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif_insert_own" ON public.notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
-- 트리거는 SECURITY DEFINER이므로 RLS 우회. service_role 도 GRANT 로 통과.

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- ============================================================
-- 2. device_push_tokens: 네이티브 FCM/APNs 토큰
-- ============================================================
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios','android','web')),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, token)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;
GRANT ALL ON public.device_push_tokens TO service_role;
ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dpt_select_own" ON public.device_push_tokens;
DROP POLICY IF EXISTS "dpt_insert_own" ON public.device_push_tokens;
DROP POLICY IF EXISTS "dpt_update_own" ON public.device_push_tokens;
DROP POLICY IF EXISTS "dpt_delete_own" ON public.device_push_tokens;
CREATE POLICY "dpt_select_own" ON public.device_push_tokens FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "dpt_insert_own" ON public.device_push_tokens FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "dpt_update_own" ON public.device_push_tokens FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "dpt_delete_own" ON public.device_push_tokens FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_dpt_user ON public.device_push_tokens(user_id);

-- ============================================================
-- 3. should_push_notify: mandatory 유형에 danger_zone_entry 등 포함
-- ============================================================
CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  _is_mandatory boolean;
  _now_t time := (now() AT TIME ZONE 'Asia/Seoul')::time;
BEGIN
  _is_mandatory := _type IN (
    'incident','approval_request','approval_result','critical_alert',
    'danger_zone_entry','emergency_drill','work_stop'
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
    WHEN 'danger_zone_entry'   THEN true
    WHEN 'return_request'      THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'   THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'         THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                 THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'      THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due'  THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident'            THEN true
    WHEN 'todo_due'            THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'   THEN COALESCE(p.event_assessment_result, false)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$function$;

-- ============================================================
-- 4. worker_zone_events → notifications 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_zone_event_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  z record;
  worker_uid uuid;
  display_name text;
  zone_label text;
  link_url text;
BEGIN
  IF NEW.event_type <> 'unauthorized_entry' THEN
    RETURN NEW;
  END IF;

  SELECT id, name, zone_type INTO z
    FROM public.site_zones WHERE id = NEW.zone_id;

  zone_label := CASE COALESCE(z.zone_type,'danger')
                  WHEN 'restricted' THEN '제한구역' ELSE '위험구역' END;
  link_url := '/zone-events?project=' || NEW.project_id::text;
  display_name := COALESCE(NEW.worker_name, '근로자');

  -- (a) 침범 당사자: workers.phone → profiles.phone → user_id
  worker_uid := NULL;
  IF NEW.worker_phone IS NOT NULL AND NEW.worker_phone <> '' THEN
    SELECT user_id INTO worker_uid FROM public.profiles
      WHERE phone = NEW.worker_phone LIMIT 1;
  END IF;
  IF worker_uid IS NULL AND NEW.worker_qr_id IS NOT NULL THEN
    SELECT p.user_id INTO worker_uid
      FROM public.workers w
      JOIN public.profiles p ON p.phone = w.phone
     WHERE w.id = NEW.worker_qr_id LIMIT 1;
  END IF;

  IF worker_uid IS NOT NULL THEN
    INSERT INTO public.notifications
      (user_id, project_id, type, title, message, body, related_type, related_id,
       link, severity, is_read)
    VALUES
      (worker_uid, NEW.project_id, 'danger_zone_entry',
       '⚠️ ' || zone_label || ' 진입 경고',
       COALESCE(z.name,'위험구역') || '에 진입했습니다. 즉시 이탈하십시오.',
       COALESCE(z.name,'위험구역') || '에 진입했습니다. 즉시 이탈하십시오.',
       'zone_event', NEW.id::text, link_url, 'high', false);
  END IF;

  -- (b) 프로젝트 안전관리자/현장소장
  INSERT INTO public.notifications
    (user_id, project_id, type, title, message, body, related_type, related_id,
     link, severity, is_read)
  SELECT DISTINCT pm.user_id, NEW.project_id, 'danger_zone_entry',
         '🚨 ' || zone_label || ' 무단진입 발생',
         display_name || ' 근로자가 ' || COALESCE(z.name,'위험구역') || '에 진입했습니다.',
         display_name || ' 근로자가 ' || COALESCE(z.name,'위험구역') || '에 진입했습니다.',
         'zone_event', NEW.id::text, link_url, 'high', false
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.user_id IS NOT NULL
     AND (worker_uid IS NULL OR pm.user_id <> worker_uid)
     AND (
          pm.position_new IN ('SITE_MANAGER','HSE_MANAGER','OWNER_HSE','SUPERVISOR')
       OR COALESCE(pm.role_new::text,'') IN ('project_admin','safety_manager')
     );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zone_event_notify ON public.worker_zone_events;
CREATE TRIGGER trg_zone_event_notify
AFTER INSERT ON public.worker_zone_events
FOR EACH ROW EXECUTE FUNCTION public.trg_zone_event_notify();

-- ============================================================
-- 5. approvals 트리거: 상신/포워딩/반려/최종승인
-- ============================================================
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
    WHEN 'work_permit'    THEN '/work-permits/' || COALESCE(_entity_id::text,'')
    WHEN 'assessment_run' THEN '/assessment-run/' || COALESCE(_entity_id::text,'')
    WHEN 'safety_cost'    THEN '/safety-cost'
    WHEN 'incident'       THEN '/incidents'
    WHEN 'emergency_drill' THEN '/emergency-drills'
    WHEN 'tbm'            THEN '/tbm-logs'
    ELSE '/approvals' END;

  -- INSERT: 새 결재행이 처음부터 '진행중'이면 결재자에게 요청
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = '진행중' AND NEW.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (NEW.approver_id, NEW.project_id, 'approval_request',
         _entity_label || ' 결재 요청', '결재가 필요합니다.', '결재가 필요합니다.',
         _entity_type, _entity_id::text, _entity_link, false);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF TG_OP = 'UPDATE' THEN
    -- 대기 → 진행중: 다음 결재자에게 요청
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.status = '진행중'
       AND NEW.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (user_id, project_id, type, title, message, body, related_type, related_id, link, is_read)
      VALUES
        (NEW.approver_id, NEW.project_id, 'approval_request',
         _entity_label || ' 결재 요청', '결재가 필요합니다.', '결재가 필요합니다.',
         _entity_type, _entity_id::text, _entity_link, false);
    END IF;

    -- 반려: 상신자에게 결과
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
           COALESCE(NULLIF(NEW.comment,''),'결재가 반려되었습니다.'),
           COALESCE(NULLIF(NEW.comment,''),'결재가 반려되었습니다.'),
           _entity_type, _entity_id::text, _entity_link, 'high', false);
      END IF;
    END IF;

    -- 최종 승인: 해당 version 전부 승인 시 상신자에게 결과
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = '승인' THEN
      SELECT bool_and(status='승인') INTO _all_done
        FROM public.approvals
       WHERE entity_type = _entity_type
         AND entity_id   = _entity_id
         AND approval_version = NEW.approval_version;
      IF _all_done THEN
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
             _entity_label || ' 최종 승인', '결재가 완료되었습니다.', '결재가 완료되었습니다.',
             _entity_type, _entity_id::text, _entity_link, false);
        END IF;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approvals_notify_ins ON public.approvals;
DROP TRIGGER IF EXISTS trg_approvals_notify_upd ON public.approvals;
CREATE TRIGGER trg_approvals_notify_ins
AFTER INSERT ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_approval_notify();
CREATE TRIGGER trg_approvals_notify_upd
AFTER UPDATE ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.trg_approval_notify();

-- ============================================================
-- 6. submit_approval / act_on_entity_approval: 내부 알림 INSERT 제거
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_approval(
  _entity_type text, _entity_id uuid, _project_id uuid,
  _company_id uuid, _steps jsonb, _reason text DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_next_version integer; v_step jsonb;
  v_order integer := 1; v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'')||CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
         updated_at=now()
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    INSERT INTO public.approvals(
      project_id, entity_type, entity_id, run_id, step, step_order, status, approval_version,
      approver_id, approver_name, position, company_id, company_name
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type='assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label','결재'), v_order,
      CASE WHEN v_order=1 THEN '진행중' ELSE '대기' END,
      v_next_version,
      NULLIF(v_step->>'user_id','')::uuid,
      COALESCE(v_step->>'user_name',''),
      COALESCE(v_step->>'position',''),
      NULLIF(v_step->>'company_id','')::uuid,
      COALESCE(v_step->>'company_name','')
    );
    v_order := v_order+1; v_inserted := v_inserted+1;
  END LOOP;

  IF _entity_type='assessment_run' THEN
    BEGIN UPDATE public.assessment_runs SET status='결재진행', updated_at=now()
           WHERE id=_entity_id AND status NOT IN ('승인완료'); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- 알림은 트리거(trg_approvals_notify_ins) 가 SSOT 로 발송.
  RETURN v_inserted;
END; $function$;

CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid, _action text, _comment text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _a record; _next record; _now timestamptz := now();
  _all_done boolean; _plan_id uuid;
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
         comment = COALESCE(_comment,''), approved_at=_now, updated_at=_now
   WHERE id=_approval_id;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='반려', rejection_reason=COALESCE(_comment,''), updated_at=_now
       WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN UPDATE public.assessment_runs SET status='rejected', updated_at=_now
             WHERE id=_a.entity_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version AND status='대기' AND step_order>_a.step_order
   ORDER BY step_order ASC LIMIT 1;

  IF FOUND THEN
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    RETURN jsonb_build_object('success', true, 'action','forwarded');
  END IF;

  SELECT bool_and(status='승인') INTO _all_done FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING id INTO _plan_id;
      IF _plan_id IS NOT NULL THEN
        UPDATE public.work_permits
           SET status = CASE WHEN status IN ('승인','반려') THEN status ELSE '승인' END,
               approved_at = COALESCE(approved_at, _now),
               updated_at = _now
         WHERE work_plan_id = _plan_id
           AND COALESCE(status,'') NOT IN ('승인','반려');
      END IF;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='승인', approved_at=_now, approved_by=auth.uid(),
             updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN UPDATE public.assessment_runs SET status='approved', updated_at=_now
             WHERE id=_a.entity_id; EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'action','approved');
END; $function$;

-- ============================================================
-- 7. notifications AFTER INSERT → dispatch-notification-push (pg_net)
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_notifications_dispatch_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $$
DECLARE
  _url text;
  _key text;
BEGIN
  BEGIN _url := current_setting('app.settings.supabase_url', true); EXCEPTION WHEN OTHERS THEN _url := NULL; END;
  BEGIN _key := current_setting('app.settings.service_role_key', true); EXCEPTION WHEN OTHERS THEN _key := NULL; END;

  IF _url IS NULL OR _key IS NULL OR _url = '' OR _key = '' THEN
    RETURN NEW; -- 미설정 시 조용히 스킵 (인앱 알림은 이미 저장됨)
  END IF;

  PERFORM net.http_post(
    url := _url || '/functions/v1/dispatch-notification-push',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || _key
    ),
    body := jsonb_build_object(
      'type','INSERT',
      'table','notifications',
      'record', to_jsonb(NEW)
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- 푸시 실패가 알림 저장을 막지 않도록
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_push ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trg_notifications_dispatch_push();
