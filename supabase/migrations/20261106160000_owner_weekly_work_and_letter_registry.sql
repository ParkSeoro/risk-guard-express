-- Friday 15:00 KST = 06:00 UTC. One database job writes one weekly note per project.
-- Scanned outgoing letters live in the same numbering table as letters written here.

CREATE OR REPLACE FUNCTION public.can_manage_owner_safety(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_master(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.role::text = 'master'
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = _user_id
        AND p.display_name LIKE '%박서로%'
    )
    OR EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = _user_id
        AND lower(u.email) IN ('seoro.park@airliquide.com', 'psr1579@gmail.com')
    )
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = _user_id
        AND pm.position_new::text IN ('OWNER_SM', 'OWNER_HSE')
    )
    OR EXISTS (
      SELECT 1
      FROM public.project_members pm
      JOIN public.companies c ON c.id = pm.company_id
      WHERE pm.user_id = _user_id
        AND c.type = 'client'
        AND lower(pm.role_new::text) IN ('safety_manager', 'project_admin')
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_owner_safety(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_owner_safety(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.owner_weekly_work_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  week_end date NOT NULL,
  body text NOT NULL,
  permit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, week_start)
);

ALTER TABLE public.owner_weekly_work_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_weekly_work_reports_select ON public.owner_weekly_work_reports;
CREATE POLICY owner_weekly_work_reports_select
  ON public.owner_weekly_work_reports
  FOR SELECT TO authenticated
  USING (public.can_manage_owner_safety(auth.uid()));

CREATE TABLE IF NOT EXISTS public.owner_official_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  doc_number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('발신', '수신')),
  letter jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'upload')),
  ocr_text text,
  ocr_confidence numeric,
  ocr_status text,
  file_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_official_letters_doc_number_uidx
  ON public.owner_official_letters (doc_number);

ALTER TABLE public.owner_official_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_official_letters_select ON public.owner_official_letters;
CREATE POLICY owner_official_letters_select
  ON public.owner_official_letters
  FOR SELECT TO authenticated
  USING (public.can_manage_owner_safety(auth.uid()));

DROP POLICY IF EXISTS owner_official_letters_insert ON public.owner_official_letters;
CREATE POLICY owner_official_letters_insert
  ON public.owner_official_letters
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_owner_safety(auth.uid()));

DROP POLICY IF EXISTS owner_official_letters_update ON public.owner_official_letters;
CREATE POLICY owner_official_letters_update
  ON public.owner_official_letters
  FOR UPDATE TO authenticated
  USING (public.can_manage_owner_safety(auth.uid()))
  WITH CHECK (public.can_manage_owner_safety(auth.uid()));

DROP POLICY IF EXISTS owner_official_letters_delete ON public.owner_official_letters;
CREATE POLICY owner_official_letters_delete
  ON public.owner_official_letters
  FOR DELETE TO authenticated
  USING (public.can_manage_owner_safety(auth.uid()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('official-letters', 'official-letters', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS official_letters_storage_select ON storage.objects;
CREATE POLICY official_letters_storage_select
  ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'official-letters' AND public.can_manage_owner_safety(auth.uid()));

DROP POLICY IF EXISTS official_letters_storage_insert ON storage.objects;
CREATE POLICY official_letters_storage_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'official-letters' AND public.can_manage_owner_safety(auth.uid()));

DROP POLICY IF EXISTS official_letters_storage_delete ON storage.objects;
CREATE POLICY official_letters_storage_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'official-letters' AND public.can_manage_owner_safety(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_work_permits_permit_date_open
  ON public.work_permits (permit_date)
  WHERE is_deleted IS NOT TRUE;

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

  PERFORM set_config('statement_timeout', '5s', true);

  INSERT INTO public.owner_weekly_work_reports (project_id, week_start, week_end, body, permit_count, updated_at)
  WITH issued AS (
    SELECT DISTINCT ON (wp.id)
      wp.id,
      wp.project_id,
      CASE
        WHEN pc.role_in_project = 'contractor'
         AND parent.id IS NOT NULL
         AND COALESCE(parent.type, '') <> 'client'
        THEN parent.name
        ELSE COALESCE(c.name, '업체 미지정')
      END AS company_name,
      btrim(regexp_replace(COALESCE(wp.work_name, ''), '\s+', ' ', 'g')) AS work_name,
      COALESCE(wp.work_description, '') AS work_description
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
  keyed AS (
    SELECT
      project_id,
      company_name,
      lower(regexp_replace(company_name, '\s+', '', 'g')) AS company_key,
      work_name,
      lower(regexp_replace(work_name, '\s+', '', 'g')) AS work_key,
      work_description
    FROM issued
  ),
  company_pick AS (
    SELECT DISTINCT ON (project_id, company_key)
      project_id, company_key, company_name
    FROM keyed
    ORDER BY project_id, company_key, char_length(company_name), company_name
  ),
  work_pick AS (
    SELECT DISTINCT ON (project_id, company_key, work_key)
      project_id, company_key, work_key, work_name
    FROM keyed
    ORDER BY project_id, company_key, work_key, char_length(work_name), work_name
  ),
  pieces AS (
    SELECT DISTINCT ON (k.project_id, k.company_key, k.work_key, bullet_key)
      k.project_id,
      k.company_key,
      k.work_key,
      cleaned AS bullet
    FROM keyed k
    CROSS JOIN LATERAL regexp_split_to_table(
      replace(replace(k.work_description, chr(13), ''), '／', '/'),
      '[' || '/' || chr(10) || ']'
    ) AS piece
    CROSS JOIN LATERAL (
      SELECT btrim(regexp_replace(btrim(piece), '^\s*([0-9]+[.)]|[가-하][.)])\s*', '')) AS cleaned
    ) s
    CROSS JOIN LATERAL (
      SELECT lower(regexp_replace(cleaned, '\s+', '', 'g')) AS bullet_key
    ) bk
    WHERE cleaned <> ''
      AND char_length(cleaned) >= 2
      AND bullet_key <> k.work_key
      AND cleaned NOT IN ('작업내용', '작업 내용')
    ORDER BY k.project_id, k.company_key, k.work_key, bullet_key, char_length(cleaned), cleaned
  ),
  work_blocks AS (
    SELECT
      w.project_id,
      w.company_key,
      w.work_name,
      '■ ' || COALESCE(NULLIF(w.work_name, ''), '작업') ||
      COALESCE(E'\n' || (
        SELECT string_agg(' * ' || p.bullet, E'\n' ORDER BY p.bullet)
        FROM pieces p
        WHERE p.project_id = w.project_id
          AND p.company_key = w.company_key
          AND p.work_key = w.work_key
      ), '') AS block
    FROM work_pick w
  ),
  company_blocks AS (
    SELECT
      c.project_id,
      c.company_name,
      '(' || c.company_name || ')' || E'\n' ||
      string_agg(wb.block, E'\n' ORDER BY wb.work_name) AS block
    FROM company_pick c
    JOIN work_blocks wb
      ON wb.project_id = c.project_id
     AND wb.company_key = c.company_key
    GROUP BY c.project_id, c.company_name
  ),
  reports AS (
    SELECT
      cb.project_id,
      string_agg(cb.block, E'\n\n' ORDER BY cb.company_name) AS body,
      (SELECT count(*) FROM issued i WHERE i.project_id = cb.project_id) AS permit_count
    FROM company_blocks cb
    GROUP BY cb.project_id
  )
  SELECT project_id, v_week_start, v_week_end, body, permit_count::integer, now()
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

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'register-owner-weekly-work-reports';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'register-owner-weekly-work-reports',
  '0 6 * * 5',
  $$SELECT public.register_owner_weekly_work_reports();$$
);

SELECT public.register_owner_weekly_work_reports();
