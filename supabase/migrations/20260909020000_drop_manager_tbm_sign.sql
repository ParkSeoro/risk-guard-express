-- Company decided manager TBM confirm/sign is not needed.
-- Keep the already-applied 20260909010000_manager_tbm_sign.sql history;
-- drop the RPCs and restore should_push_notify without tbm_sign_due.

DROP FUNCTION IF EXISTS public.notify_manager_tbm_sign_due();
DROP FUNCTION IF EXISTS public.list_my_pending_tbm_signs();
DROP FUNCTION IF EXISTS public.manager_sign_tbm_participation(uuid, text);

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
    'danger_zone_entry','emergency_drill','work_stop','announcement',
    'assessment_share'
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
    WHEN 'announcement'        THEN true
    WHEN 'assessment_share'    THEN true
    WHEN 'return_request'      THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'   THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'         THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                 THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'      THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due'  THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident'            THEN true
    WHEN 'todo_due'            THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'   THEN COALESCE(p.event_assessment_result, true)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$function$;
