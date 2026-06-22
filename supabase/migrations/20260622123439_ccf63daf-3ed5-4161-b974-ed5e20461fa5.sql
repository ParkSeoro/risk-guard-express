
-- 1) notification_preferences 확장: 푸시 채널 + 세부 이벤트 + 방해금지 시간
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS channel_push boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS channel_in_app boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_safety_inspection boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_work_permit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_tbm boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_health_warning boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_health_checkup_due boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_incident boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_todo_due boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS event_assessment_result boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_general boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS push_quiet_start time DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS push_quiet_end time DEFAULT '07:00';

-- 2) 알림 타입 → 사용자 설정 컬럼 매핑 + 시스템 강제 여부 판정
--    MANDATORY(시스템 강제, 사용자가 끌 수 없음): incident, approval_request, approval_result
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
  -- 시스템 강제 — 사용자 설정과 무관하게 항상 푸시
  _is_mandatory := _type IN ('incident', 'approval_request', 'approval_result', 'critical_alert');

  SELECT * INTO p FROM public.notification_preferences WHERE user_id = _user_id;
  -- 설정이 없으면 기본값(푸시 ON)으로 간주
  IF p IS NULL THEN RETURN true; END IF;
  IF NOT _is_mandatory AND COALESCE(p.channel_push, true) = false THEN RETURN false; END IF;

  -- 방해금지 시간 (강제 알림은 무시)
  IF NOT _is_mandatory AND p.push_quiet_start IS NOT NULL AND p.push_quiet_end IS NOT NULL THEN
    IF p.push_quiet_start < p.push_quiet_end THEN
      IF _now_t >= p.push_quiet_start AND _now_t < p.push_quiet_end THEN RETURN false; END IF;
    ELSE
      -- 22:00 ~ 07:00 같은 자정 넘김
      IF _now_t >= p.push_quiet_start OR _now_t < p.push_quiet_end THEN RETURN false; END IF;
    END IF;
  END IF;

  -- 세부 이벤트별 토글 (mandatory는 위에서 처리됨)
  RETURN CASE _type
    WHEN 'approval_request'   THEN true
    WHEN 'approval_result'    THEN true
    WHEN 'return_request'     THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete'THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'  THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'        THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'     THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due' THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident'           THEN true
    WHEN 'todo_due'           THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'  THEN COALESCE(p.event_assessment_result, false)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.should_push_notify(uuid, text) TO authenticated, service_role;
