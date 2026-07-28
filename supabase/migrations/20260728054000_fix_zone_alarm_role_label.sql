-- Fix danger-zone admin push copy: stop hardcoding "근로자".
-- Resolve honorific from notes role_label=… or project_members.role_new / position_new.

CREATE OR REPLACE FUNCTION public.trg_zone_event_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  z record;
  rz record;
  worker_uid uuid;
  display_name text;
  role_label text;
  pm_role text;
  pm_pos text;
  zone_label text;
  zone_name text;
  link_url text;
  subject_phrase text;
BEGIN
  IF NEW.event_type <> 'unauthorized_entry' THEN
    RETURN NEW;
  END IF;

  zone_label := '위험구역';
  zone_name := '위험구역';

  IF NEW.zone_id IS NOT NULL THEN
    SELECT id, name, zone_type INTO z
      FROM public.site_zones WHERE id = NEW.zone_id;
    IF FOUND THEN
      zone_label := CASE COALESCE(z.zone_type,'danger')
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

  -- 1) Prefer explicit role_label from notes (client / alarm_sim)
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
  -- Alarm sim / logged-in GPS: match by display_name when phone missing
  IF worker_uid IS NULL AND NEW.worker_name IS NOT NULL AND btrim(NEW.worker_name) <> '' THEN
    SELECT p.user_id INTO worker_uid
      FROM public.profiles p
      JOIN public.project_members pm ON pm.user_id = p.user_id
     WHERE p.display_name = btrim(NEW.worker_name)
       AND pm.project_id = NEW.project_id
     LIMIT 1;
  END IF;

  -- 2) Membership lookup when notes had no role_label
  IF role_label IS NULL AND worker_uid IS NOT NULL THEN
    SELECT COALESCE(pm.role_new::text, ''), COALESCE(pm.position_new::text, '')
      INTO pm_role, pm_pos
      FROM public.project_members pm
     WHERE pm.project_id = NEW.project_id
       AND pm.user_id = worker_uid
     LIMIT 1;

    IF NOT FOUND THEN
      -- Global master may not have project_members row
      IF EXISTS (
        SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = worker_uid AND ur.role::text = 'master'
      ) THEN
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

  IF worker_uid IS NOT NULL THEN
    INSERT INTO public.notifications
      (user_id, project_id, type, title, message, body, related_type, related_id,
       link, severity, is_read)
    VALUES
      (worker_uid, NEW.project_id, 'danger_zone_entry',
       '⚠️ ' || zone_label || ' 진입 경고',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       'zone_event', NEW.id::text, link_url, 'high', false);
  END IF;

  -- 관리자 알림: "긴급: OOO 관리자님 위험 구역 진입" (더 이상 근로자 고정 아님)
  INSERT INTO public.notifications
    (user_id, project_id, type, title, message, body, related_type, related_id,
     link, severity, is_read)
  SELECT DISTINCT pm.user_id, NEW.project_id, 'danger_zone_entry',
         '🚨 긴급: ' || subject_phrase || ' 위험 구역 진입',
         subject_phrase || '이(가) ' || zone_name || '에 진입했습니다. 즉시 확인하세요.',
         subject_phrase || '이(가) ' || zone_name || '에 진입했습니다. 즉시 확인하세요.',
         'zone_event', NEW.id::text, link_url, 'high', false
    FROM public.project_members pm
   WHERE pm.project_id = NEW.project_id
     AND pm.user_id IS NOT NULL
     AND (worker_uid IS NULL OR pm.user_id <> worker_uid)
     AND (
          pm.position_new IN ('SITE_MANAGER','HSE_MANAGER','OWNER_HSE','OWNER_SM','SUPERVISOR')
       OR COALESCE(pm.role_new::text,'') IN ('project_admin','safety_manager')
     );

  RETURN NEW;
END;
$$;
