-- Monday–Sunday weekly safety report.
-- Sunday 21:00 KST writes one stored report per project.
-- Opening the screen only reads that row. Gemini runs from the Sunday job
-- or from an explicit rebuild, and only when the permit bundle changed
-- or the risk lines are not ready yet.

ALTER TABLE public.owner_weekly_work_reports
  ADD COLUMN IF NOT EXISTS source jsonb,
  ADD COLUMN IF NOT EXISTS source_hash text,
  ADD COLUMN IF NOT EXISTS stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'digest';

COMMENT ON COLUMN public.owner_weekly_work_reports.source IS
  'Company work bundle used to write the report. The screen does not rescan permits.';
COMMENT ON COLUMN public.owner_weekly_work_reports.source_hash IS
  'Hash of the work bundle. Same hash skips another model call.';
COMMENT ON COLUMN public.owner_weekly_work_reports.status IS
  'digest = work list only, ready = risk lines written, failed = model call failed.';

CREATE OR REPLACE FUNCTION public.weekly_tokens(src text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT tok), ARRAY[]::text[])
  FROM regexp_split_to_table(lower(COALESCE(src, '')), '[^0-9a-z가-힣]+') AS tok
  WHERE char_length(tok) > 1
    AND tok NOT IN ('및', '작업', '관련');
$$;

CREATE OR REPLACE FUNCTION public.weekly_same_text(a text, b text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  WITH sides AS (
    SELECT public.weekly_tokens(a) AS ta, public.weekly_tokens(b) AS tb
  )
  SELECT CASE
    WHEN cardinality(ta) = 0 OR cardinality(tb) = 0 THEN
      lower(regexp_replace(COALESCE(a, ''), '\s+', '', 'g'))
        = lower(regexp_replace(COALESCE(b, ''), '\s+', '', 'g'))
    ELSE (
      SELECT count(*)::float
      FROM unnest(ta) AS x
      WHERE x = ANY (tb)
    ) / GREATEST(cardinality(ARRAY(SELECT DISTINCT u FROM unnest(ta || tb) AS u)), 1) >= 0.82
  END
  FROM sides;
$$;

REVOKE ALL ON FUNCTION public.weekly_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.weekly_same_text(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_tokens(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.weekly_same_text(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.register_owner_weekly_work_reports(p_as_of date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := COALESCE(p_as_of, (now() AT TIME ZONE 'Asia/Seoul')::date);
  v_week_start date := date_trunc('week', v_today)::date;
  v_week_end date := v_week_start + 6;
  v_range_start timestamptz := (v_week_start::timestamp AT TIME ZONE 'Asia/Seoul');
  v_range_end timestamptz := ((v_week_end + 1)::timestamp AT TIME ZONE 'Asia/Seoul');
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_owner_safety(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('statement_timeout', '60s', true);

  DROP TABLE IF EXISTS _ww_item;
  CREATE TEMP TABLE _ww_item (
    project_id uuid,
    company_name text,
    work_name text,
    bullet text,
    bkey text
  ) ON COMMIT DROP;

  INSERT INTO _ww_item (project_id, company_name, work_name, bullet, bkey)
  WITH issued AS (
    SELECT DISTINCT ON (wp.id)
      wp.project_id,
      CASE
        WHEN pc.role_in_project = 'contractor'
         AND parent.id IS NOT NULL
         AND COALESCE(parent.type, '') <> 'client'
        THEN parent.name
        ELSE COALESCE(c.name, '업체 미지정')
      END AS company_name,
      btrim(regexp_replace(COALESCE(wp.work_name, ''), '\s+', ' ', 'g')) AS work_name,
      regexp_replace(
        regexp_replace(
          replace(replace(COALESCE(wp.work_description, ''), chr(13), ''), '／', '/'),
          '([A-Za-z])\s*/\s*([A-Za-z])',
          '\1\2',
          'g'
        ),
        ' ([0-9]+) ([가-힣])',
        chr(10) || '\2',
        'g'
      ) AS work_description
    FROM public.work_permits wp
    LEFT JOIN public.companies c ON c.id = wp.company_id
    LEFT JOIN public.project_companies pc
      ON pc.project_id = wp.project_id
     AND pc.company_id = wp.company_id
     AND COALESCE(pc.is_deleted, false) = false
    LEFT JOIN public.companies parent ON parent.id = pc.parent_company_id
    WHERE wp.is_deleted IS NOT TRUE
      AND wp.permit_date BETWEEN v_week_start AND v_week_end
      AND wp.status IN (
        '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
        '종료대기', 'CLOSURE_PENDING', '종료완료', 'closed', 'CLOSED'
      )
    ORDER BY wp.id, pc.role_in_project
  ),
  names AS (
    SELECT DISTINCT project_id, company_name, NULLIF(work_name, '') AS work_name
    FROM issued
  ),
  pieces AS (
    SELECT
      i.project_id,
      i.company_name,
      NULLIF(i.work_name, '') AS work_name,
      btrim(regexp_replace(regexp_replace(btrim(num_piece), '^[-*•\s]+', ''), '^[0-9]+[.)]\s*', '')) AS bullet
    FROM issued i
    CROSS JOIN LATERAL regexp_split_to_table(replace(i.work_description, '/', chr(10)), chr(10)) AS raw_piece
    CROSS JOIN LATERAL regexp_split_to_table(raw_piece, '\s+[0-9]+[.)]\s+') AS num_piece
  )
  SELECT project_id, company_name, work_name, NULL::text, NULL::text FROM names
  UNION ALL
  SELECT project_id, company_name, work_name, bullet,
    lower(regexp_replace(bullet, '[^0-9a-zA-Z가-힣]+', '', 'g'))
  FROM pieces
  WHERE char_length(bullet) >= 4
    AND bullet !~ '[,，]\s*[A-Za-z]$'
    AND (
      char_length(regexp_replace(bullet, '[^가-힣]', '', 'g')) >= 2
      OR char_length(bullet) >= 12
    );

  DELETE FROM _ww_item a
  USING _ww_item b
  WHERE a.bkey IS NOT NULL
    AND a.project_id = b.project_id
    AND a.company_name = b.company_name
    AND a.bkey = b.bkey
    AND (
      char_length(a.bullet) > char_length(b.bullet)
      OR (char_length(a.bullet) = char_length(b.bullet) AND a.ctid > b.ctid)
    );

  DELETE FROM _ww_item a
  USING _ww_item b
  WHERE a.bullet IS NOT NULL
    AND b.bullet IS NOT NULL
    AND a.project_id = b.project_id
    AND a.company_name = b.company_name
    AND a.bullet <> b.bullet
    AND public.weekly_same_text(a.bullet, b.bullet)
    AND (
      char_length(a.bullet) > char_length(b.bullet)
      OR (char_length(a.bullet) = char_length(b.bullet) AND a.ctid > b.ctid)
    );

  DELETE FROM _ww_item a
  WHERE a.bullet IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM _ww_item b
      WHERE b.project_id = a.project_id
        AND b.company_name = a.company_name
        AND b.bullet IS NOT NULL
        AND b.bullet <> a.bullet
        AND cardinality(public.weekly_tokens(b.bullet)) > cardinality(public.weekly_tokens(a.bullet))
        AND (
          SELECT count(*)::float
          FROM unnest(public.weekly_tokens(a.bullet)) AS tok
          WHERE tok = ANY (public.weekly_tokens(b.bullet))
        ) / GREATEST(cardinality(public.weekly_tokens(a.bullet)), 1) >= 0.8
    );

  UPDATE _ww_item AS item
  SET work_name = picked.canon
  FROM (
    SELECT DISTINCT ON (src.project_id, src.company_name, src.work_name)
      src.project_id,
      src.company_name,
      src.work_name,
      canon.work_name AS canon
    FROM (SELECT DISTINCT project_id, company_name, work_name FROM _ww_item) AS src
    JOIN (SELECT DISTINCT project_id, company_name, work_name FROM _ww_item) AS canon
      ON canon.project_id = src.project_id
     AND canon.company_name = src.company_name
     AND public.weekly_same_text(src.work_name, canon.work_name)
    ORDER BY src.project_id, src.company_name, src.work_name, char_length(canon.work_name), canon.work_name
  ) AS picked
  WHERE item.project_id = picked.project_id
    AND item.company_name = picked.company_name
    AND item.work_name IS NOT DISTINCT FROM picked.work_name
    AND picked.canon IS NOT NULL;

  INSERT INTO public.owner_weekly_work_reports (
    project_id, week_start, week_end, body, permit_count, source, source_hash, stats, status, updated_at
  )
  WITH headings AS (
    SELECT DISTINCT project_id, company_name, work_name
    FROM _ww_item
  ),
  item_lines AS (
    SELECT
      h.project_id,
      h.company_name,
      h.work_name,
      (
        SELECT COALESCE(jsonb_agg(item.bullet ORDER BY item.bullet), '[]'::jsonb)
        FROM (
          SELECT DISTINCT bullet
          FROM _ww_item
          WHERE project_id = h.project_id
            AND company_name = h.company_name
            AND work_name IS NOT DISTINCT FROM h.work_name
            AND bullet IS NOT NULL
        ) AS item
      ) AS items
    FROM headings AS h
  ),
  company_groups AS (
    SELECT
      project_id,
      company_name,
      jsonb_agg(
        jsonb_build_object(
          'heading', COALESCE(NULLIF(work_name, ''), '작업'),
          'items', items
        )
        ORDER BY COALESCE(work_name, '')
      ) AS groups,
      string_agg(
        '■ ' || COALESCE(NULLIF(work_name, ''), '작업')
        || COALESCE(
          E'\n* ' || (
            SELECT string_agg(b.value, E'\n* ' ORDER BY b.value)
            FROM jsonb_array_elements_text(items) AS b(value)
          ),
          ''
        ),
        E'\n'
        ORDER BY COALESCE(work_name, '')
      ) AS block
    FROM item_lines
    GROUP BY project_id, company_name
  ),
  company_source AS (
    SELECT
      project_id,
      jsonb_agg(
        jsonb_build_object('name', company_name, 'groups', groups)
        ORDER BY company_name
      ) AS companies,
      string_agg('(' || company_name || ')' || E'\n' || block, E'\n\n' ORDER BY company_name) AS body
    FROM company_groups
    GROUP BY project_id
  ),
  reports AS (
    SELECT
      cs.project_id,
      '[' || COALESCE(NULLIF(btrim(pr.name), ''), '현장') || ' 현장 주간 안전보고]'
        || E'\n\n' || cs.body AS body,
      (
        SELECT count(*)::integer
        FROM public.work_permits wp
        WHERE wp.project_id = cs.project_id
          AND wp.is_deleted IS NOT TRUE
          AND wp.permit_date BETWEEN v_week_start AND v_week_end
          AND wp.status IN (
            '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
            '종료대기', 'CLOSURE_PENDING', '종료완료', 'closed', 'CLOSED'
          )
      ) AS permit_count,
      jsonb_build_object('project_name', COALESCE(pr.name, ''), 'companies', cs.companies) AS source,
      md5(cs.companies::text) AS source_hash,
      jsonb_build_object(
        'inspection', (
          SELECT count(*)::int
          FROM public.safety_inspections s
          WHERE s.project_id = cs.project_id
            AND COALESCE(s.is_deleted, false) = false
            AND s.inspected_at >= v_range_start
            AND s.inspected_at < v_range_end
        ),
        'education', (
          SELECT count(*)::int
          FROM public.education_sessions e
          WHERE e.project_id = cs.project_id
            AND e.held_on BETWEEN v_week_start AND v_week_end
        ),
        'work_stop', (
          SELECT count(*)::int
          FROM public.work_stop_requests w
          WHERE w.project_id = cs.project_id
            AND w.created_at >= v_range_start
            AND w.created_at < v_range_end
        ),
        'suspension', (
          SELECT count(*)::int
          FROM public.workers w
          WHERE w.project_id = cs.project_id
            AND w.site_entry_suspended_at >= v_range_start
            AND w.site_entry_suspended_at < v_range_end
        ),
        'incident', (
          SELECT count(*)::int
          FROM public.incident_reports i
          WHERE i.project_id = cs.project_id
            AND COALESCE(i.is_deleted, false) = false
            AND i.occurred_at >= v_range_start
            AND i.occurred_at < v_range_end
        )
      ) AS stats
    FROM company_source cs
    JOIN public.projects pr ON pr.id = cs.project_id
  )
  SELECT
    project_id, v_week_start, v_week_end, body, permit_count, source, source_hash, stats, 'digest', now()
  FROM reports
  ON CONFLICT (project_id, week_start) DO UPDATE
    SET week_end = EXCLUDED.week_end,
        permit_count = EXCLUDED.permit_count,
        source = EXCLUDED.source,
        source_hash = EXCLUDED.source_hash,
        stats = EXCLUDED.stats || jsonb_build_object(
          'plan', COALESCE(public.owner_weekly_work_reports.stats->'plan', '{}'::jsonb),
          'meeting_actual', public.owner_weekly_work_reports.stats->'meeting_actual'
        ),
        body = CASE
          WHEN public.owner_weekly_work_reports.source_hash IS NOT DISTINCT FROM EXCLUDED.source_hash
           AND public.owner_weekly_work_reports.status = 'ready'
          THEN public.owner_weekly_work_reports.body
          ELSE EXCLUDED.body
        END,
        status = CASE
          WHEN public.owner_weekly_work_reports.source_hash IS NOT DISTINCT FROM EXCLUDED.source_hash
           AND public.owner_weekly_work_reports.status = 'ready'
          THEN 'ready'
          ELSE 'digest'
        END,
        updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.register_owner_weekly_work_reports(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_owner_weekly_work_reports(date) TO service_role;

DROP POLICY IF EXISTS owner_weekly_work_reports_update ON public.owner_weekly_work_reports;
CREATE POLICY owner_weekly_work_reports_update
  ON public.owner_weekly_work_reports
  FOR UPDATE TO authenticated
  USING (public.can_manage_owner_safety(auth.uid()))
  WITH CHECK (public.can_manage_owner_safety(auth.uid()));

CREATE OR REPLACE FUNCTION public.run_weekly_safety_report()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _url text;
  _secret text;
  _week date := date_trunc('week', (now() AT TIME ZONE 'Asia/Seoul')::date)::date;
BEGIN
  PERFORM public.register_owner_weekly_work_reports(NULL);
  BEGIN
    SELECT value INTO _url FROM private.dispatch_config WHERE key = 'supabase_url';
    SELECT value INTO _secret FROM private.dispatch_config WHERE key = 'trigger_secret';
    IF _url IS NULL OR _secret IS NULL OR btrim(_url) = '' OR btrim(_secret) = '' THEN
      RETURN;
    END IF;
    PERFORM net.http_post(
      url := rtrim(_url, '/') || '/functions/v1/write-weekly-safety-report',
      body := jsonb_build_object('week_start', _week),
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Push-Trigger-Secret', _secret
      ),
      timeout_milliseconds := 120000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'weekly safety report dispatch skipped: %', SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.run_weekly_safety_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_weekly_safety_report() TO service_role;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'register-owner-weekly-work-reports';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'run-weekly-safety-report';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'run-weekly-safety-report',
  '0 12 * * 0',
  $$SELECT public.run_weekly_safety_report();$$
);

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_i integer;
BEGIN
  FOR v_i IN 0..3 LOOP
    PERFORM public.register_owner_weekly_work_reports(v_today - (v_i * 7));
  END LOOP;
END $$;
