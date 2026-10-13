CREATE OR REPLACE FUNCTION public.notify_suspended_site_entry(_project_id uuid, _worker_id uuid, _inside boolean, _spot_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $body$
DECLARE
  _w record;
  _suspended boolean;
  _was_inside boolean;
  _kind text;
  _company_name text;
  _title text;
  _message text;
  _link text := '/app/admin/workers';
  _n int := 0;
  _added int;
  _cid uuid;
BEGIN
  IF _project_id IS NULL OR _worker_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'alerted', false);
  END IF;
  SELECT w.company_id, w.name, w.site_entry_suspended_until, w.site_entry_suspension_reason, w.site_entry_suspension_kind, c.name AS company_name
    INTO _w
    FROM public.workers w
    LEFT JOIN public.companies c ON c.id = w.company_id
   WHERE w.id = _worker_id AND w.project_id = _project_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'alerted', false);
  END IF;
  _suspended := _w.site_entry_suspended_until IS NOT NULL AND _w.site_entry_suspended_until > now();
  SELECT p.inside INTO _was_inside FROM public.worker_suspension_site_presence p WHERE p.worker_id = _worker_id AND p.project_id = _project_id;
  IF NOT _suspended OR NOT COALESCE(_inside, false) THEN
    INSERT INTO public.worker_suspension_site_presence (worker_id, project_id, inside, spot_name, updated_at)
    VALUES (_worker_id, _project_id, false, NULL, now())
    ON CONFLICT (worker_id, project_id) DO UPDATE SET inside = false, spot_name = NULL, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'alerted', false, 'suspended', _suspended, 'inside', false);
  END IF;
  IF COALESCE(_was_inside, false) THEN
    UPDATE public.worker_suspension_site_presence
       SET spot_name = COALESCE(NULLIF(btrim(COALESCE(_spot_name, '')), ''), spot_name), updated_at = now()
     WHERE worker_id = _worker_id AND project_id = _project_id;
    RETURN jsonb_build_object('ok', true, 'alerted', false, 'suspended', true, 'inside', true, 'repeat', true);
  END IF;
  _kind := CASE _w.site_entry_suspension_kind WHEN '1d' THEN '일일' WHEN '3d' THEN '3일' WHEN 'permanent' THEN '영구' ELSE '출입' END;
  _company_name := COALESCE(NULLIF(btrim(_w.company_name), ''), '소속 업체');
  _title := '출입 정지 근로자 현장 진입';
  _message := format('%s (%s) · %s 정지%s%s', COALESCE(NULLIF(btrim(_w.name), ''), '근로자'), _company_name, _kind,
    CASE WHEN _w.site_entry_suspension_reason IS NOT NULL AND btrim(_w.site_entry_suspension_reason) <> '' THEN ' · ' || btrim(_w.site_entry_suspension_reason) ELSE '' END,
    CASE WHEN _spot_name IS NOT NULL AND btrim(_spot_name) <> '' THEN ' · ' || btrim(_spot_name) ELSE '' END);
  IF _w.company_id IS NULL THEN
    _n := public.notify_project_roles(_project_id, ARRAY['project_admin']::text[], _title, _message, 'suspended_site_entry', _link, NULL, NULL, 'worker', _worker_id::text, 'high', ARRAY['OWNER_PM','OWNER_CM']::text[]);
  ELSE
    FOR _cid IN
      WITH RECURSIVE ancestors AS (
        SELECT c.id, COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_id, 0 AS depth
          FROM public.companies c
          LEFT JOIN public.project_companies pc ON pc.company_id = c.id AND pc.project_id = _project_id AND COALESCE(pc.is_deleted, false) = false
         WHERE c.id = _w.company_id AND COALESCE(c.is_deleted, false) = false
        UNION ALL
        SELECT c.id, COALESCE(pc.parent_company_id, c.parent_company_id), a.depth + 1
          FROM ancestors a
          JOIN public.companies c ON c.id = a.parent_id
          LEFT JOIN public.project_companies pc ON pc.company_id = c.id AND pc.project_id = _project_id AND COALESCE(pc.is_deleted, false) = false
         WHERE a.parent_id IS NOT NULL AND COALESCE(c.is_deleted, false) = false AND a.depth < 8
      )
      SELECT a.id FROM ancestors a
    LOOP
      _added := public.notify_project_roles(_project_id, ARRAY['safety_manager','site_manager','site_supervisor','project_admin']::text[], _title, _message, 'suspended_site_entry', _link, _cid, NULL, 'worker', _worker_id::text, 'high', ARRAY['SITE_MANAGER','HSE_MANAGER','OWNER_HSE','OWNER_SM','SITE_SUPERVISOR','SUPERVISOR','OWNER_PM','OWNER_CM']::text[]);
      _n := _n + COALESCE(_added, 0);
    END LOOP;
  END IF;
  INSERT INTO public.worker_suspension_site_presence (worker_id, project_id, inside, spot_name, last_alert_at, updated_at)
  VALUES (_worker_id, _project_id, true, NULLIF(btrim(COALESCE(_spot_name, '')), ''), now(), now())
  ON CONFLICT (worker_id, project_id) DO UPDATE SET inside = true, spot_name = EXCLUDED.spot_name, last_alert_at = now(), updated_at = now();
  RETURN jsonb_build_object('ok', true, 'alerted', true, 'notified', _n, 'suspended', true, 'inside', true);
END;
$body$;
REVOKE ALL ON FUNCTION public.notify_suspended_site_entry(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_suspended_site_entry(uuid, uuid, boolean, text) TO service_role;
