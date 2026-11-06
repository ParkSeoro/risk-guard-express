-- Shorter weekly notes: merge near-duplicate tasks, and show them on their own tab.

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
  v_week_end date := v_week_start + 4;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_owner_safety(auth.uid()) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('statement_timeout', '8s', true);

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

  INSERT INTO public.owner_weekly_work_reports (project_id, week_start, week_end, body, permit_count, updated_at)
  WITH headings AS (
    SELECT DISTINCT project_id, company_name, work_name
    FROM _ww_item
  ),
  counts AS (
    SELECT project_id, company_name, work_name, count(bullet) AS bullet_count
    FROM _ww_item
    WHERE bullet IS NOT NULL
    GROUP BY project_id, company_name, work_name
  ),
  located AS (
    SELECT
      item.project_id,
      item.company_name,
      item.work_name,
      item.bullet,
      CASE
        WHEN item.bullet ~ '^[A-Za-z]' THEN btrim(COALESCE((regexp_match(item.bullet, '^((?:[A-Za-z0-9#''./_+-]+\s+){1,3})'))[1], split_part(item.bullet, ' ', 1)))
        ELSE split_part(item.bullet, ' ', 1)
      END AS place
    FROM _ww_item AS item
    WHERE item.bullet IS NOT NULL
  ),
  plain_lines AS (
    SELECT
      h.project_id,
      h.company_name,
      h.work_name,
      (
        SELECT string_agg(item.bullet, E'\n * ' ORDER BY item.bullet)
        FROM (
          SELECT DISTINCT bullet
          FROM _ww_item
          WHERE project_id = h.project_id
            AND company_name = h.company_name
            AND work_name IS NOT DISTINCT FROM h.work_name
            AND bullet IS NOT NULL
        ) AS item
      ) AS lines
    FROM headings AS h
    LEFT JOIN counts AS c
      ON c.project_id = h.project_id
     AND c.company_name = h.company_name
     AND c.work_name IS NOT DISTINCT FROM h.work_name
    WHERE COALESCE(c.bullet_count, 0) <= 8
  ),
  place_lines AS (
    SELECT
      loc.project_id,
      loc.company_name,
      loc.work_name,
      loc.place,
      CASE
        WHEN count(*) = 1 THEN min(loc.bullet)
        ELSE loc.place || ' ' || left(string_agg(DISTINCT btrim(
          CASE
            WHEN loc.bullet LIKE loc.place || '%' THEN substr(loc.bullet, char_length(loc.place) + 1)
            ELSE loc.bullet
          END
        ), ', '), 90)
      END AS line
    FROM located AS loc
    JOIN counts AS c
      ON c.project_id = loc.project_id
     AND c.company_name = loc.company_name
     AND c.work_name IS NOT DISTINCT FROM loc.work_name
    WHERE c.bullet_count > 8
    GROUP BY loc.project_id, loc.company_name, loc.work_name, loc.place
  ),
  grouped_headings AS (
    SELECT project_id, company_name, work_name, string_agg(line, E'\n * ' ORDER BY place) AS lines
    FROM place_lines
    GROUP BY project_id, company_name, work_name
  ),
  blocks AS (
    SELECT
      h.project_id,
      h.company_name,
      '■ ' || COALESCE(
        CASE
          WHEN char_length(h.work_name) > 42 THEN btrim(split_part(h.work_name, ',', 1))
          ELSE NULLIF(h.work_name, '')
        END,
        '작업'
      ) || COALESCE(E'\n * ' || COALESCE(p.lines, g.lines), '') AS block
    FROM headings AS h
    LEFT JOIN plain_lines AS p
      ON p.project_id = h.project_id
     AND p.company_name = h.company_name
     AND p.work_name IS NOT DISTINCT FROM h.work_name
    LEFT JOIN grouped_headings AS g
      ON g.project_id = h.project_id
     AND g.company_name = h.company_name
     AND g.work_name IS NOT DISTINCT FROM h.work_name
  ),
  companies AS (
    SELECT project_id, company_name, '(' || company_name || ')' || E'\n' || string_agg(block, E'\n' ORDER BY block) AS block
    FROM blocks
    GROUP BY project_id, company_name
  ),
  reports AS (
    SELECT
      c.project_id,
      string_agg(c.block, E'\n\n' ORDER BY c.company_name) AS body,
      (
        SELECT count(*)::integer
        FROM public.work_permits wp
        WHERE wp.project_id = c.project_id
          AND wp.is_deleted IS NOT TRUE
          AND wp.permit_date BETWEEN v_week_start AND v_week_end
          AND wp.status IN (
            '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
            '종료대기', 'CLOSURE_PENDING', '종료완료', 'closed', 'CLOSED'
          )
      ) AS permit_count
    FROM companies AS c
    GROUP BY c.project_id
  )
  SELECT project_id, v_week_start, v_week_end, body, permit_count, now()
  FROM reports
  ON CONFLICT (project_id, week_start) DO UPDATE
    SET week_end = EXCLUDED.week_end,
        body = EXCLUDED.body,
        permit_count = EXCLUDED.permit_count,
        updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.register_owner_weekly_work_reports(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_owner_weekly_work_reports(date) TO service_role;

SELECT public.register_owner_weekly_work_reports(date '2026-11-06');
