-- Treat approval_approved and approval_rejected identically to approval_result
-- in should_push_notify so approval outcomes are not silently dropped when
-- notification_preferences exists (mirrors send-notification-email/index.ts).
CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'danger_zone_entry',
    'suspended_site_entry',
    'emergency_drill',
    'work_stop',
    'announcement',
    'assessment_share',
    'signup_pending'
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
    WHEN 'approval_request' THEN true
    WHEN 'approval_result' THEN true
    WHEN 'approval_approved' THEN true
    WHEN 'approval_rejected' THEN true
    WHEN 'danger_zone_entry' THEN true
    WHEN 'suspended_site_entry' THEN true
    WHEN 'announcement' THEN true
    WHEN 'assessment_share' THEN true
    WHEN 'signup_pending' THEN true
    WHEN 'return_request' THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection' THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit' THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm' THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning' THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due' THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident' THEN true
    WHEN 'todo_due' THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result' THEN COALESCE(p.event_assessment_result, true)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$function$;
