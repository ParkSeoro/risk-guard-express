
-- ===== Extend todo_items for source tracking =====
ALTER TABLE public.todo_items
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_todo_items_source
  ON public.todo_items(source_table, source_id);

-- ===== Extend safety_education_materials =====
ALTER TABLE public.safety_education_materials
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS last_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_count integer DEFAULT 0;

-- ===== Helper RPC: apply env measurement exceedance to linked risk items =====
CREATE OR REPLACE FUNCTION public.apply_env_exceedance_to_risk(_measurement_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor_id uuid;
  v_project_id uuid;
  v_exceeded boolean;
  v_updated int := 0;
BEGIN
  SELECT factor_id, project_id, COALESCE(is_exceeded, false)
    INTO v_factor_id, v_project_id, v_exceeded
  FROM public.work_env_measurements
  WHERE id = _measurement_id AND COALESCE(is_deleted,false) = false;

  IF v_factor_id IS NULL OR v_exceeded = false THEN
    RETURN 0;
  END IF;

  UPDATE public.risk_items ri
     SET severity = LEAST(COALESCE(ri.severity,1) + 1, 3),
         risk_score = LEAST(COALESCE(ri.severity,1) + 1, 3) * COALESCE(ri.probability,1),
         override_reason = COALESCE(NULLIF(ri.override_reason,''), '') ||
           CASE WHEN ri.override_reason IS NULL OR ri.override_reason = '' THEN '' ELSE E'\n' END ||
           '[자동] 작업환경측정 노출기준 초과로 강도 상향 (' || now()::date || ')',
         updated_at = now()
   WHERE v_factor_id = ANY(COALESCE(ri.linked_env_factor_ids, ARRAY[]::uuid[]))
     AND COALESCE(ri.is_deleted,false) = false
     AND (v_project_id IS NULL OR ri.project_id = v_project_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_env_exceedance_to_risk(uuid) TO authenticated, service_role;

-- ===== Trigger: auto-apply on measurement insert/update =====
CREATE OR REPLACE FUNCTION public.trg_env_measurement_exceedance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_exceeded,false) = true THEN
    PERFORM public.apply_env_exceedance_to_risk(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_env_measurement_exceedance ON public.work_env_measurements;
CREATE TRIGGER trg_env_measurement_exceedance
AFTER INSERT OR UPDATE OF is_exceeded ON public.work_env_measurements
FOR EACH ROW EXECUTE FUNCTION public.trg_env_measurement_exceedance();

-- ===== Trigger: Health checkup schedule → todo_items =====
CREATE OR REPLACE FUNCTION public.trg_health_checkup_todo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_existing uuid;
BEGIN
  IF NEW.scheduled_date IS NULL THEN
    RETURN NEW;
  END IF;

  v_title := '[건강진단] ' || COALESCE(NEW.worker_name,'근로자') || ' - ' || COALESCE(NEW.type::text,'일반') || ' 실시';

  SELECT id INTO v_existing
  FROM public.todo_items
  WHERE source_table = 'health_checkups' AND source_id = NEW.id
  LIMIT 1;

  IF v_existing IS NULL THEN
    INSERT INTO public.todo_items (
      project_id, company_id, title, description, due_date, status, frequency,
      source_table, source_id, category,
      completed_at, created_at, updated_at
    ) VALUES (
      NEW.project_id, NEW.company_id, v_title,
      COALESCE(NEW.institution,'') ,
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
           status = CASE WHEN NEW.conducted_date IS NOT NULL THEN 'done' ELSE 'pending' END,
           completed_at = CASE WHEN NEW.conducted_date IS NOT NULL THEN COALESCE(completed_at, now()) ELSE NULL END,
           updated_at = now()
     WHERE id = v_existing;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_health_checkup_todo ON public.health_checkups;
CREATE TRIGGER trg_health_checkup_todo
AFTER INSERT OR UPDATE OF scheduled_date, conducted_date, type ON public.health_checkups
FOR EACH ROW EXECUTE FUNCTION public.trg_health_checkup_todo();

-- ===== Trigger: health_education_logs → bump safety_education_materials stats =====
CREATE OR REPLACE FUNCTION public.trg_health_education_log_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.material_id IS NOT NULL THEN
    UPDATE public.safety_education_materials
       SET last_completed_at = COALESCE(NEW.conducted_at, now()),
           completion_count = COALESCE(completion_count,0) + 1,
           category = COALESCE(category, 'health'),
           updated_at = now()
     WHERE id = NEW.material_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_health_education_log_sync ON public.health_education_logs;
CREATE TRIGGER trg_health_education_log_sync
AFTER INSERT ON public.health_education_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_health_education_log_sync();
