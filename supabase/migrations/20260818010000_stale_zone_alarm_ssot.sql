-- Danger-zone GPS siren SSOT is restricted_zones (통합 현장 관제맵).
-- 1) Do not FCM/in-app notify when the cited fence is deleted or inactive.
-- 2) Ignore leftover site_zones danger/restricted once the project has used
--    the unified map (those rows kept firing after add/edit/delete there).
-- 3) Publish restricted_zones so phones drop a deleted fence without waiting
--    for the 15s poll.

CREATE OR REPLACE FUNCTION public.trg_zone_event_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  z record;
  rz record;
  worker_uid uuid;
  violator_company_id uuid;
  display_name text;
  role_label text;
  pm_role text;
  pm_pos text;
  zone_label text;
  zone_name text;
  link_url text;
  subject_phrase text;
  admin_title text;
  admin_body text;
BEGIN
  IF NEW.event_type <> 'unauthorized_entry' THEN
    RETURN NEW;
  END IF;

  -- Deleted / inactive fences must not keep sirening the phone.
  IF NEW.restricted_zone_id IS NOT NULL THEN
    SELECT id, name, is_deleted, is_active INTO rz
      FROM public.restricted_zones WHERE id = NEW.restricted_zone_id;
    IF NOT FOUND
       OR COALESCE(rz.is_deleted, false)
       OR COALESCE(rz.is_active, true) = false THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.zone_id IS NOT NULL THEN
    SELECT id, name, zone_type, is_deleted INTO z
      FROM public.site_zones WHERE id = NEW.zone_id;
    IF NOT FOUND OR COALESCE(z.is_deleted, false) THEN
      RETURN NEW;
    END IF;
    IF COALESCE(z.zone_type, '') IN ('danger', 'restricted')
       AND EXISTS (
         SELECT 1 FROM public.restricted_zones r
          WHERE r.project_id = NEW.project_id
       ) THEN
      RETURN NEW;
    END IF;
  END IF;

  zone_label := '위험구역';
  zone_name := '위험구역';

  IF NEW.zone_id IS NOT NULL THEN
    SELECT id, name, zone_type INTO z
      FROM public.site_zones WHERE id = NEW.zone_id;
    IF FOUND THEN
      zone_label := CASE COALESCE(z.zone_type, 'danger')
                      WHEN 'restricted' THEN '제한구역' ELSE '위험구역' END;
      zone_name := COALESCE(z.name, zone_name);
    END IF;
  END IF;

  IF NEW.restricted_zone_id IS NOT NULL THEN
    SELECT id, name INTO rz FROM public.restricted_zones WHERE id = NEW.restricted_zone_id;
    IF FOUND THEN
      zone_label := '위험구역';
      zone_name := COALESCE(rz.name, zone_name);
    END IF;
  END IF;

  link_url := '/zone-events?project=' || NEW.project_id::text;
  display_name := COALESCE(NULLIF(btrim(NEW.worker_name), ''), '미확인');

  role_label := NULL;
  IF NEW.notes IS NOT NULL AND NEW.notes ~ 'role_label=' THEN
    role_label := NULLIF(btrim(substring(NEW.notes from 'role_label=([^|]+)')), '');
  END IF;

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
  IF worker_uid IS NULL AND NEW.worker_name IS NOT NULL AND btrim(NEW.worker_name) <> '' THEN
    SELECT p.user_id INTO worker_uid
      FROM public.profiles p
      JOIN public.project_members pm ON pm.user_id = p.user_id
     WHERE p.display_name = btrim(NEW.worker_name)
       AND pm.project_id = NEW.project_id
     LIMIT 1;
  END IF;

  -- Resolve violator company for company-scoped manager notify
  violator_company_id := NULL;
  IF NEW.worker_qr_id IS NOT NULL THEN
    SELECT w.company_id INTO violator_company_id
      FROM public.workers w
     WHERE w.id = NEW.worker_qr_id
     LIMIT 1;
  END IF;
  IF violator_company_id IS NULL AND NEW.worker_phone IS NOT NULL AND NEW.worker_phone <> '' THEN
    SELECT w.company_id INTO violator_company_id
      FROM public.workers w
     WHERE w.project_id = NEW.project_id
       AND regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g')
           = regexp_replace(NEW.worker_phone, '\D', '', 'g')
       AND COALESCE(w.is_active, true)
     LIMIT 1;
  END IF;
  IF violator_company_id IS NULL AND worker_uid IS NOT NULL THEN
    SELECT pm.company_id INTO violator_company_id
      FROM public.project_members pm
     WHERE pm.project_id = NEW.project_id
       AND pm.user_id = worker_uid
     LIMIT 1;
  END IF;

  IF role_label IS NULL AND worker_uid IS NOT NULL THEN
    SELECT COALESCE(pm.role_new::text, ''), COALESCE(pm.position_new::text, '')
      INTO pm_role, pm_pos
      FROM public.project_members pm
     WHERE pm.project_id = NEW.project_id
       AND pm.user_id = worker_uid
     LIMIT 1;

    IF NOT FOUND THEN
      IF public.is_master(worker_uid) THEN
        role_label := '관리자님';
      END IF;
    ELSE
      role_label := CASE lower(pm_role)
        WHEN 'master' THEN '관리자님'
        WHEN 'project_admin' THEN '관리자님'
        WHEN 'safety_manager' THEN '안전관리자님'
        WHEN 'site_manager' THEN '현장소장님'
        WHEN 'supervisor' THEN '감리님'
        WHEN 'site_supervisor' THEN '관리감독자님'
        WHEN 'viewer' THEN '열람자'
        WHEN 'worker' THEN '근로자'
        ELSE NULL
      END;
      IF role_label IS NULL THEN
        role_label := CASE upper(pm_pos)
          WHEN 'OWNER_PM' THEN '관리자님'
          WHEN 'OWNER_CM' THEN '관리자님'
          WHEN 'CEO' THEN '관리자님'
          WHEN 'EXECUTIVE' THEN '관리자님'
          WHEN 'OWNER_SM' THEN '안전관리자님'
          WHEN 'OWNER_HSE' THEN '안전관리자님'
          WHEN 'HSE_MANAGER' THEN '안전관리자님'
          WHEN 'SITE_MANAGER' THEN '현장소장님'
          WHEN 'SUPERVISOR' THEN '감리님'
          WHEN 'SITE_SUPERVISOR' THEN '관리감독자님'
          WHEN 'WORKER' THEN '근로자'
          ELSE '담당자'
        END;
      END IF;
    END IF;
  END IF;

  IF role_label IS NULL OR btrim(role_label) = '' THEN
    role_label := '담당자';
  END IF;

  subject_phrase := display_name || ' ' || role_label;
  admin_title := '긴급: ' || subject_phrase || ' 위험 구역 진입';
  admin_body := subject_phrase || '이(가) ' || zone_name || '에 진입했습니다. 즉시 확인하세요.';

  -- (1) Violator self-notify
  IF worker_uid IS NOT NULL THEN
    INSERT INTO public.notifications
      (user_id, project_id, type, title, message, body, related_type, related_id,
       link, severity, is_read)
    VALUES
      (worker_uid, NEW.project_id, 'danger_zone_entry',
       zone_label || ' 진입 경고',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       'zone_event', NEW.id::text, link_url, 'high', false);
  END IF;

  -- (2) Project admins only (project-wide) — not every SM on every company
  PERFORM public.notify_project_roles(
    NEW.project_id,
    ARRAY['project_admin']::text[],
    admin_title,
    admin_body,
    'danger_zone_entry',
    link_url,
    NULL,              -- no company filter
    worker_uid,
    'zone_event',
    NEW.id::text,
    'high',
    ARRAY['OWNER_PM', 'OWNER_CM']::text[]
  );

  -- (3) Violator's company managers only
  IF violator_company_id IS NOT NULL THEN
    PERFORM public.notify_project_roles(
      NEW.project_id,
      ARRAY['safety_manager', 'site_manager', 'site_supervisor']::text[],
      admin_title,
      admin_body,
      'danger_zone_entry',
      link_url,
      violator_company_id,
      worker_uid,
      'zone_event',
      NEW.id::text,
      'high',
      ARRAY[
        'SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'OWNER_SM',
        'SITE_SUPERVISOR', 'SUPERVISOR'
      ]::text[]
    );
  END IF;

  RETURN NEW;
END;
$body$;

COMMENT ON FUNCTION public.trg_zone_event_notify() IS
  'unauthorized_entry → violator+admins only if the restricted_zones (or leftover site_zones) fence is still live';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'restricted_zones'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restricted_zones;
  END IF;
END $$;
