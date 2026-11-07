-- Merge the same work across places, and keep typed plan/actual numbers.

CREATE OR REPLACE FUNCTION public.weekly_norm(src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(COALESCE(src, ''), '[^0-9A-Za-z가-힣]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.weekly_work_parts(src text)
RETURNS TABLE(place text, stem text, verb text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  nouns text := '추락방지망|내화페인트|강재거푸집|안전난간대|수직사다리|가설자재|콘크리트|거푸집|철근|비계|동바리|난간대|안전망|조적|석재|석제|판넬|배관|철골|보온재|코핑폼|발판|면정리|전기입선|그라우팅|그라우트|치핑패드|페인트|케이블|서포트|부재|패드|전등|자재|그라인더';
  verbs text := '되메우기|시운전|그라인딩|그라인더|먹메김|터파기|배근|해체|타설|조립|용접|인양|정리|양중|운반|하역|철거|도장|방수|쌓기|마감|반입|입고|인출|포설|치핑|측량|양수|보완|수정|볼팅|실링|설치|심사|이렉션|welding';
  standalone text := '^(되메우기|시운전|먹메김|터파기|양수|측량|치핑|정리|양중|인양|운반|하역|철거|도장|방수|용접|그라우팅|보완|수정|반입|입고|포설|심사|그라인딩|볼팅|실링)$';
  clauses text[];
  pieces text[];
  clause text;
  piece text;
  spaced text;
  tokens text[];
  inherited_place text;
  verb_found text;
  found_verb text;
  found_noun text;
  found_place text;
  i int;
  n int;
  noun_at int;
  verb_at int;
  last_noun text;
BEGIN
  IF btrim(COALESCE(src, '')) = '' THEN
    RETURN;
  END IF;
  clauses := regexp_split_to_array(src, '\s*[,，·•]\s*');
  FOREACH clause IN ARRAY clauses LOOP
    clause := btrim(clause);
    IF clause = '' THEN
      CONTINUE;
    END IF;
    pieces := regexp_split_to_array(clause, '\s+및\s+');
    inherited_place := '';
    last_noun := '';
    verb_found := NULL;
    FOREACH piece IN ARRAY pieces LOOP
      spaced := btrim(regexp_replace(regexp_replace(regexp_replace(piece, '(?i)(' || nouns || ')', ' \1', 'g'), '(?i)(' || verbs || ')', ' \1', 'g'), '\s+', ' ', 'g'));
      tokens := regexp_split_to_array(spaced, '\s+');
      n := COALESCE(array_length(tokens, 1), 0);
      WHILE n > 0 AND tokens[n] = '관련' LOOP
        n := n - 1;
      END LOOP;
      FOR i IN REVERSE n..1 LOOP
        IF tokens[i] ~* ('^(' || verbs || ')$') AND tokens[i] <> '작업' THEN
          verb_found := tokens[i];
          EXIT;
        END IF;
      END LOOP;
      IF verb_found IS NULL THEN
        FOR i IN REVERSE n..1 LOOP
          IF tokens[i] = '작업' THEN
            verb_found := '작업';
            EXIT;
          END IF;
        END LOOP;
      END IF;
    END LOOP;

    FOREACH piece IN ARRAY pieces LOOP
      spaced := btrim(regexp_replace(regexp_replace(regexp_replace(piece, '(?i)(' || nouns || ')', ' \1', 'g'), '(?i)(' || verbs || ')', ' \1', 'g'), '\s+', ' ', 'g'));
      tokens := regexp_split_to_array(spaced, '\s+');
      n := COALESCE(array_length(tokens, 1), 0);
      WHILE n > 0 AND tokens[n] = '관련' LOOP
        n := n - 1;
      END LOOP;
      found_verb := NULL;
      found_noun := NULL;
      noun_at := NULL;
      verb_at := NULL;
      FOR i IN REVERSE n..1 LOOP
        IF tokens[i] ~* ('^(' || verbs || ')$') AND tokens[i] <> '작업' THEN
          found_verb := tokens[i];
          verb_at := i;
          EXIT;
        END IF;
      END LOOP;
      IF found_verb IS NULL THEN
        FOR i IN REVERSE n..1 LOOP
          IF tokens[i] = '작업' THEN
            found_verb := '작업';
            verb_at := i;
            EXIT;
          END IF;
        END LOOP;
      END IF;
      IF found_verb IS NOT NULL AND verb_at IS NOT NULL AND verb_at > 1
         AND tokens[verb_at - 1] !~* ('^(' || verbs || ')$')
         AND tokens[verb_at - 1] NOT IN ('및', '작업', '관련')
         AND (tokens[verb_at - 1] ~* ('^(' || nouns || ')$') OR found_verb !~ standalone) THEN
        found_noun := tokens[verb_at - 1];
        noun_at := verb_at - 1;
      END IF;
      IF found_verb IS NULL AND verb_found IS NOT NULL AND n >= 1 AND tokens[n] !~* ('^(' || verbs || ')$') THEN
        found_verb := verb_found;
        found_noun := tokens[n];
        noun_at := n;
        verb_at := n;
      END IF;
      IF found_verb IS NULL THEN
        CONTINUE;
      END IF;
      IF noun_at IS NOT NULL AND noun_at > 1 THEN
        found_place := btrim(array_to_string(tokens[1:noun_at - 1], ' '));
      ELSIF noun_at IS NULL AND verb_at IS NOT NULL AND verb_at > 1 THEN
        found_place := btrim(array_to_string(tokens[1:verb_at - 1], ' '));
      ELSE
        found_place := '';
      END IF;
      IF found_place = '' THEN
        found_place := inherited_place;
      ELSE
        inherited_place := found_place;
      END IF;
      IF found_noun IS NULL AND last_noun <> '' THEN
        found_noun := last_noun;
      ELSIF found_noun IS NOT NULL THEN
        last_noun := found_noun;
      END IF;
      IF found_place <> '' AND regexp_replace(found_place, '^.* ', '') ~ '^(버림|기초|강재|외벽|내부|외부)$' THEN
        found_noun := btrim(regexp_replace(found_place, '^.* ', '') || ' ' || COALESCE(found_noun, ''));
        found_place := btrim(regexp_replace(found_place, '\s*\S+$', ''));
      END IF;
      place := found_place;
      verb := found_verb;
      stem := btrim(COALESCE(found_noun || ' ', '') || found_verb);
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.weekly_one_apart(a text, b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  i int;
  diff int := 0;
BEGIN
  IF COALESCE(a, '') = '' OR COALESCE(b, '') = '' THEN
    RETURN false;
  END IF;
  IF a = b THEN
    RETURN false;
  END IF;
  IF char_length(a) <> char_length(b) OR char_length(a) < 2 THEN
    RETURN false;
  END IF;
  FOR i IN 1..char_length(a) LOOP
    IF substr(a, i, 1) IS DISTINCT FROM substr(b, i, 1) THEN
      diff := diff + 1;
    END IF;
  END LOOP;
  RETURN diff = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.weekly_condense_bullets(bullets text[])
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  src_line text;
  ord int := 0;
  group_rec record;
  place_rec record;
  places text[];
  line text;
  result text[] := ARRAY[]::text[];
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _ww_bullet (
    ord int PRIMARY KEY,
    bullet text,
    bkey text
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _ww_unit (
    ord int,
    place text,
    stem text,
    skey text,
    verb text,
    shared boolean,
    companion boolean
  ) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _ww_out (
    sort int,
    line text
  ) ON COMMIT DROP;
  DELETE FROM _ww_bullet AS seen WHERE seen.ord IS NOT NULL OR seen.ord IS NULL;
  DELETE FROM _ww_unit AS seen WHERE seen.ord IS NOT NULL OR seen.ord IS NULL;
  DELETE FROM _ww_out AS seen WHERE seen.sort IS NOT NULL OR seen.sort IS NULL;

  IF bullets IS NULL THEN
    RETURN result;
  END IF;

  FOREACH src_line IN ARRAY bullets LOOP
    src_line := btrim(COALESCE(src_line, ''));
    IF src_line = '' OR EXISTS (SELECT 1 FROM _ww_bullet AS seen WHERE seen.bkey = public.weekly_norm(src_line)) THEN
      CONTINUE;
    END IF;
    ord := ord + 1;
    INSERT INTO _ww_bullet VALUES (ord, src_line, public.weekly_norm(src_line));
    INSERT INTO _ww_unit (ord, place, stem, skey, verb, shared, companion)
    SELECT ord, btrim(COALESCE(part.place, '')), part.stem,
      part.verb || '|' || replace(public.weekly_norm(split_part(part.stem, ' ', 1)), '석제', '석재'),
      part.verb,
      false,
      false
    FROM public.weekly_work_parts(src_line) AS part
    WHERE btrim(COALESCE(part.stem, '')) <> '';
  END LOOP;

  UPDATE _ww_unit AS later
  SET skey = earlier.skey
  FROM _ww_unit AS earlier
  WHERE later.verb = earlier.verb
    AND later.skey <> earlier.skey
    AND public.weekly_one_apart(split_part(later.stem, ' ', 1), split_part(earlier.stem, ' ', 1))
    AND earlier.ord < later.ord;

  UPDATE _ww_unit AS u
  SET shared = true
  WHERE (
    SELECT count(DISTINCT u2.ord) FROM _ww_unit u2 WHERE u2.skey = u.skey
  ) >= 2;

  -- Drop a narrower action when the same lines already contain a broader one.
  UPDATE _ww_unit AS narrow
  SET shared = false,
      companion = true
  WHERE narrow.shared
    AND EXISTS (
      SELECT 1
      FROM _ww_unit broad
      WHERE broad.shared
        AND broad.skey <> narrow.skey
        AND broad.verb = narrow.verb
        AND NOT EXISTS (
          SELECT 1
          FROM _ww_unit mine
          WHERE mine.skey = narrow.skey
            AND NOT EXISTS (
              SELECT 1 FROM _ww_unit hit
              WHERE hit.skey = broad.skey
                AND hit.ord = mine.ord
            )
        )
        AND (
          SELECT count(DISTINCT hit.ord) FROM _ww_unit hit WHERE hit.skey = broad.skey
        ) > (
          SELECT count(DISTINCT hit.ord) FROM _ww_unit hit WHERE hit.skey = narrow.skey
        )
    );

  FOR group_rec IN
    SELECT u.skey,
           min(u.ord) AS first_ord,
           (
             SELECT u2.stem
             FROM _ww_unit u2
             WHERE u2.skey = u.skey
               AND u2.shared
             ORDER BY (u2.stem LIKE '%석재%') DESC, u2.ord
             LIMIT 1
           ) AS stem
    FROM _ww_unit u
    WHERE u.shared
    GROUP BY u.skey
    ORDER BY min(u.ord)
  LOOP
    places := ARRAY[]::text[];
    FOR place_rec IN
      SELECT picked.place
      FROM (
        SELECT DISTINCT ON (public.weekly_norm(u.place))
          u.place,
          min(u.ord) OVER (PARTITION BY public.weekly_norm(u.place)) AS first_ord
        FROM _ww_unit u
        WHERE u.skey = group_rec.skey
          AND u.shared
          AND btrim(COALESCE(u.place, '')) <> ''
        ORDER BY public.weekly_norm(u.place), (u.place ~ '\s') DESC, char_length(u.place) DESC
      ) AS picked
      GROUP BY picked.place, picked.first_ord
      ORDER BY picked.first_ord, picked.place
    LOOP
      places := array_append(places, place_rec.place);
    END LOOP;
    IF COALESCE(array_length(places, 1), 0) = 0 THEN
      line := group_rec.stem;
    ELSE
      line := array_to_string(places, ', ') || ' ' || group_rec.stem;
    END IF;
    INSERT INTO _ww_out VALUES (group_rec.first_ord, line);
  END LOOP;

  INSERT INTO _ww_out (sort, line)
  SELECT b.ord, b.bullet
  FROM _ww_bullet b
  WHERE NOT EXISTS (
    SELECT 1 FROM _ww_unit u
    WHERE u.ord = b.ord
      AND u.shared
  );

  INSERT INTO _ww_out (sort, line)
  SELECT u.ord, btrim(CASE WHEN u.place = '' THEN u.stem ELSE u.place || ' ' || u.stem END)
  FROM _ww_unit u
  WHERE NOT u.shared
    AND NOT u.companion
    AND EXISTS (
      SELECT 1 FROM _ww_unit shared_unit
      WHERE shared_unit.ord = u.ord
        AND shared_unit.shared
    );

  SELECT COALESCE(array_agg(o.line ORDER BY o.sort, o.line), ARRAY[]::text[])
  INTO result
  FROM _ww_out o;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.weekly_prepare_report_items()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  grp record;
  fresh text[];
  line text;
BEGIN
  UPDATE _ww_item
  SET work_name = NULLIF(btrim(regexp_replace(COALESCE(work_name, ''), '^\d{4}-\d{2}-\d{2}\s*', '')), '')
  WHERE project_id IS NOT NULL OR project_id IS NULL;

  UPDATE _ww_item AS item
  SET work_name = canon.work_name
  FROM (
    SELECT DISTINCT ON (project_id, company_name, public.weekly_norm(work_name))
      project_id,
      company_name,
      public.weekly_norm(work_name) AS nkey,
      work_name
    FROM _ww_item
    WHERE work_name IS NOT NULL
    ORDER BY project_id, company_name, public.weekly_norm(work_name),
      (work_name ~ '\s') DESC, char_length(work_name), work_name
  ) AS canon
  WHERE item.project_id = canon.project_id
    AND item.company_name = canon.company_name
    AND public.weekly_norm(item.work_name) = canon.nkey
    AND item.work_name IS DISTINCT FROM canon.work_name;

  DELETE FROM _ww_item
  WHERE bullet IS NOT NULL
    AND work_name IS NOT NULL
    AND public.weekly_norm(bullet) = public.weekly_norm(work_name);

  FOR grp IN
    SELECT project_id, company_name, work_name,
           array_agg(bullet ORDER BY bullet) AS bullets
    FROM _ww_item
    WHERE bullet IS NOT NULL
    GROUP BY project_id, company_name, work_name
  LOOP
    fresh := public.weekly_condense_bullets(grp.bullets);
    DELETE FROM _ww_item
    WHERE project_id = grp.project_id
      AND company_name = grp.company_name
      AND work_name IS NOT DISTINCT FROM grp.work_name
      AND bullet IS NOT NULL;
    IF fresh IS NULL THEN
      CONTINUE;
    END IF;
    FOREACH line IN ARRAY fresh LOOP
      INSERT INTO _ww_item (project_id, company_name, work_name, bullet, bkey)
      VALUES (
        grp.project_id,
        grp.company_name,
        grp.work_name,
        line,
        public.weekly_norm(line)
      );
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.weekly_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.weekly_work_parts(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.weekly_one_apart(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.weekly_condense_bullets(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.weekly_prepare_report_items() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_norm(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.weekly_work_parts(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.weekly_one_apart(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.weekly_condense_bullets(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.weekly_prepare_report_items() TO service_role;

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

  PERFORM public.weekly_prepare_report_items();

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
      '{}'::jsonb AS stats
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
        stats = public.owner_weekly_work_reports.stats,
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

DO $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_i integer;
BEGIN
  FOR v_i IN 0..3 LOOP
    PERFORM public.register_owner_weekly_work_reports(v_today - (v_i * 7));
  END LOOP;
END $$;
