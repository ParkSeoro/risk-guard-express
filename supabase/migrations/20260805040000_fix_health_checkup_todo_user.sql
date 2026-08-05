-- Health checkup → todo must set todo_items.user_id (NOT NULL).
-- Without an owner the AFTER INSERT trigger aborts the checkup insert,
-- so schedule→todo linkage is broken in production.

CREATE OR REPLACE FUNCTION public.trg_health_checkup_todo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_title text;
  v_existing uuid;
  v_user uuid;
BEGIN
  IF NEW.scheduled_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_title := '[건강진단] ' || COALESCE(NEW.worker_name, '근로자') || ' - '
    || COALESCE(NEW.type::text, '일반') || ' 실시';

  -- Prefer explicit creator, then session user, then project safety/admin.
  v_user := COALESCE(
    NEW.created_by,
    auth.uid(),
    (
      SELECT pm.user_id
        FROM public.project_members pm
       WHERE pm.project_id = NEW.project_id
         AND pm.user_id IS NOT NULL
         AND pm.role_new IN (
           'safety_manager'::public.project_role,
           'project_admin'::public.project_role,
           'site_manager'::public.project_role
         )
       ORDER BY CASE pm.role_new
         WHEN 'safety_manager' THEN 0
         WHEN 'project_admin' THEN 1
         ELSE 2
       END
       LIMIT 1
    )
  );

  IF v_user IS NULL THEN
    -- Cannot satisfy todo_items.user_id NOT NULL — skip rather than abort checkup save.
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing
    FROM public.todo_items
   WHERE source_table = 'health_checkups' AND source_id = NEW.id
   LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.todo_items (
      project_id, company_id, user_id, title, description, due_date, status, frequency,
      source_table, source_id, category,
      completed_at, created_at, updated_at
    ) VALUES (
      NEW.project_id, NEW.company_id, v_user, v_title,
      COALESCE(NEW.institution, ''),
      NEW.scheduled_date,
      CASE WHEN NEW.conducted_date IS NOT NULL THEN 'done' ELSE 'pending' END,
      'once',
      'health_checkups', NEW.id, 'health',
      CASE WHEN NEW.conducted_date IS NOT NULL THEN now() ELSE NULL END,
      now(), now()
    );
  ELSE
    UPDATE public.todo_items
       SET title = v_title,
           due_date = NEW.scheduled_date,
           user_id = COALESCE(user_id, v_user),
           status = CASE WHEN NEW.conducted_date IS NOT NULL THEN 'done' ELSE 'pending' END,
           completed_at = CASE
             WHEN NEW.conducted_date IS NOT NULL THEN COALESCE(completed_at, now())
             ELSE NULL
           END,
           updated_at = now()
     WHERE id = v_existing;
  END IF;

  RETURN NEW;
END;
$function$;

-- Env measurement exceedance → risk upgrade used dropped columns
-- (probability / risk_score). Align to live SSOT: frequency + risk.
CREATE OR REPLACE FUNCTION public.apply_env_exceedance_to_risk(_measurement_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_factor_id uuid;
  v_project_id uuid;
  v_exceeded boolean;
  v_updated int := 0;
BEGIN
  SELECT factor_id, project_id, COALESCE(is_exceeded, false)
    INTO v_factor_id, v_project_id, v_exceeded
  FROM public.work_env_measurements
  WHERE id = _measurement_id AND COALESCE(is_deleted, false) = false;

  IF v_factor_id IS NULL OR v_exceeded = false THEN
    RETURN 0;
  END IF;

  UPDATE public.risk_items ri
     SET severity = LEAST(COALESCE(ri.severity, 1) + 1, 3),
         risk = LEAST(COALESCE(ri.severity, 1) + 1, 3) * COALESCE(ri.frequency, 1),
         auto_adjust_reason = COALESCE(ri.auto_adjust_reason, '') ||
           CASE WHEN ri.auto_adjust_reason IS NULL OR ri.auto_adjust_reason = '' THEN '' ELSE E'\n' END ||
           '[자동] 작업환경측정 노출기준 초과로 강도 상향 (' || now()::date || ')',
         env_exceedance_source = COALESCE(ri.env_exceedance_source, _measurement_id),
         updated_at = now()
   WHERE v_factor_id = ANY (COALESCE(ri.linked_env_factor_ids, ARRAY[]::uuid[]))
     AND COALESCE(ri.is_deleted, false) = false
     AND (v_project_id IS NULL OR ri.project_id = v_project_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_env_exceedance_to_risk(uuid) TO authenticated, service_role;
