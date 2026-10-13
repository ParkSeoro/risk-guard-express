-- Work-stop: reporter chooses anonymous vs real name; notify company managers + 발주처.
-- Identity: is_anonymous + placeholder reporter_name; worker_id / reporter_user_id stay for audit.
-- Legal cite: 산업안전보건법 제52조.

ALTER TABLE public.work_stop_requests
  ADD COLUMN IF NOT EXISTS is_anonymous boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reporter_user_id uuid;

COMMENT ON COLUMN public.work_stop_requests.is_anonymous IS
  'When true, reporter_name is the public placeholder (익명 근로자). worker_id/reporter_user_id are audit-only.';
COMMENT ON COLUMN public.work_stop_requests.reporter_user_id IS
  'Auth user who submitted. Not shown when is_anonymous.';

CREATE OR REPLACE FUNCTION public.fn_work_stop_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_company_id uuid;
  v_display text;
  v_message text;
BEGIN
  IF NEW.worker_id IS NOT NULL THEN
    SELECT w.company_id INTO v_company_id
      FROM public.workers w
     WHERE w.id = NEW.worker_id;
  END IF;

  IF v_company_id IS NULL AND NEW.reporter_user_id IS NOT NULL THEN
    SELECT pm.company_id INTO v_company_id
      FROM public.project_members pm
     WHERE pm.project_id = NEW.project_id
       AND pm.user_id = NEW.reporter_user_id
     LIMIT 1;
  END IF;

  v_display := CASE
    WHEN COALESCE(NEW.is_anonymous, false) THEN '익명 근로자'
    ELSE COALESCE(NULLIF(btrim(NEW.reporter_name), ''), '근로자')
  END;

  v_message := v_display
    || CASE
         WHEN NULLIF(btrim(COALESCE(NEW.location, '')), '') IS NOT NULL
         THEN ' · ' || btrim(NEW.location)
         ELSE ''
       END
    || ' — '
    || COALESCE(NULLIF(btrim(NEW.hazard_description), ''), '위험상황');

  -- One DISTINCT insert: 소속 회사 관리자 ∪ 현장 안전 리더십 ∪ 발주처 OWNER_*
  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT pm.user_id, NEW.project_id, 'work_stop',
         '작업중지 요청 접수', v_message, v_message, '/work-stop',
         'work_stop', NEW.id::text, 'critical', false, now()
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.user_id IS NOT NULL
     AND COALESCE(pm.role_new::text, '') NOT IN ('worker', 'viewer')
     AND (
       (v_company_id IS NOT NULL AND pm.company_id = v_company_id)
       OR COALESCE(pm.role_new::text, '') IN ('project_admin', 'safety_manager', 'site_manager')
       OR COALESCE(pm.position_new::text, '') IN (
            'OWNER_HSE', 'OWNER_SM', 'OWNER_PM', 'OWNER_CM',
            'SITE_MANAGER', 'HSE_MANAGER'
          )
     );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$body$;
