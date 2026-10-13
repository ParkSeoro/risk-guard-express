-- Work-stop: show project name on notify copy, and join profiles by user_id
-- (profiles.id is the profile PK, not auth.users.id).

CREATE OR REPLACE FUNCTION public.reveal_work_stop_reporters(_ids uuid[])
RETURNS TABLE(id uuid, legal_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT r.id,
         COALESCE(
           NULLIF(NULLIF(btrim(w.name), ''), '익명 근로자'),
           NULLIF(NULLIF(btrim(p.display_name), ''), '익명 근로자')
         ) AS legal_name
    FROM public.work_stop_requests r
    LEFT JOIN public.workers w ON w.id = r.worker_id
    LEFT JOIN public.profiles p ON p.user_id = r.reporter_user_id
   WHERE r.id = ANY(_ids)
     AND COALESCE(r.is_anonymous, false)
     AND public.can_reveal_work_stop_reporter(r.project_id)
     AND COALESCE(
           NULLIF(NULLIF(btrim(w.name), ''), '익명 근로자'),
           NULLIF(NULLIF(btrim(p.display_name), ''), '익명 근로자')
         ) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.reveal_work_stop_reporters(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_work_stop_reporters(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_work_stop_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $body$
DECLARE
  v_company_id uuid;
  v_legal text;
  v_project text;
  v_public_display text;
  v_public_message text;
  v_reveal_message text;
BEGIN
  SELECT NULLIF(btrim(pr.name), '') INTO v_project
    FROM public.projects pr WHERE pr.id = NEW.project_id;

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

  IF NEW.worker_id IS NOT NULL THEN
    SELECT NULLIF(btrim(w.name), '') INTO v_legal
      FROM public.workers w WHERE w.id = NEW.worker_id;
  END IF;
  IF v_legal IS NULL AND NEW.reporter_user_id IS NOT NULL THEN
    SELECT NULLIF(btrim(p.display_name), '') INTO v_legal
      FROM public.profiles p WHERE p.user_id = NEW.reporter_user_id;
  END IF;
  IF v_legal IS NULL OR v_legal = '익명 근로자' THEN
    v_legal := COALESCE(NULLIF(btrim(NEW.reporter_name), ''), '근로자');
    IF v_legal = '익명 근로자' THEN v_legal := '근로자'; END IF;
  END IF;

  v_public_display := CASE
    WHEN COALESCE(NEW.is_anonymous, false) THEN '익명 근로자'
    ELSE COALESCE(NULLIF(btrim(NEW.reporter_name), ''), v_legal, '근로자')
  END;

  v_public_message := COALESCE('[' || v_project || '] ', '')
    || v_public_display
    || CASE
         WHEN NULLIF(btrim(COALESCE(NEW.location, '')), '') IS NOT NULL
         THEN ' · ' || btrim(NEW.location)
         ELSE ''
       END
    || ' — '
    || COALESCE(NULLIF(btrim(NEW.hazard_description), ''), '위험상황');

  v_reveal_message := COALESCE('[' || v_project || '] ', '')
    || COALESCE(NULLIF(btrim(v_legal), ''), '근로자')
    || ' (익명 신고)'
    || CASE
         WHEN NULLIF(btrim(COALESCE(NEW.location, '')), '') IS NOT NULL
         THEN ' · ' || btrim(NEW.location)
         ELSE ''
       END
    || ' — '
    || COALESCE(NULLIF(btrim(NEW.hazard_description), ''), '위험상황');

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT pm.user_id, NEW.project_id, 'work_stop',
         '작업중지 요청 접수',
         CASE
           WHEN COALESCE(NEW.is_anonymous, false)
                AND (
                  COALESCE(pm.role_new::text, '') = 'project_admin'
                  OR COALESCE(pm.position_new::text, '') = 'OWNER_PM'
                  OR public.is_master(pm.user_id)
                )
           THEN v_reveal_message
           ELSE v_public_message
         END,
         CASE
           WHEN COALESCE(NEW.is_anonymous, false)
                AND (
                  COALESCE(pm.role_new::text, '') = 'project_admin'
                  OR COALESCE(pm.position_new::text, '') = 'OWNER_PM'
                  OR public.is_master(pm.user_id)
                )
           THEN v_reveal_message
           ELSE v_public_message
         END,
         '/work-stop?id=' || NEW.id::text,
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

-- Existing work-stop alerts: prefix project name once (real name still comes from RPC on read).
UPDATE public.notifications n
   SET message = '[' || p.name || '] ' || n.message,
       body = CASE
                WHEN NULLIF(btrim(COALESCE(n.body, '')), '') IS NULL THEN n.body
                WHEN n.body LIKE '[' || p.name || ']%' THEN n.body
                ELSE '[' || p.name || '] ' || n.body
              END
  FROM public.projects p
 WHERE n.project_id = p.id
   AND n.type = 'work_stop'
   AND NULLIF(btrim(p.name), '') IS NOT NULL
   AND n.message IS NOT NULL
   AND n.message NOT LIKE '[' || p.name || ']%';
