DROP POLICY IF EXISTS "announcements_select" ON public.project_announcements;
CREATE POLICY "announcements_select"
  ON public.project_announcements FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
    OR EXISTS (
      SELECT 1 FROM public.project_announcement_recipients r
      WHERE r.announcement_id = project_announcements.id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "announcement_recipients_select" ON public.project_announcement_recipients;
CREATE POLICY "announcement_recipients_select"
  ON public.project_announcement_recipients FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_announcements a
      WHERE a.id = announcement_id
        AND (a.created_by = auth.uid() OR public.is_project_member(auth.uid(), a.project_id))
    )
  );

DROP POLICY IF EXISTS "announcement_acks_select" ON public.project_announcement_acks;
CREATE POLICY "announcement_acks_select"
  ON public.project_announcement_acks FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_announcements a
      WHERE a.id = announcement_id
        AND (a.created_by = auth.uid() OR public.is_project_member(auth.uid(), a.project_id))
    )
  );

GRANT SELECT ON public.project_announcements TO authenticated;
GRANT SELECT ON public.project_announcement_recipients TO authenticated;
GRANT SELECT ON public.project_announcement_acks TO authenticated;
GRANT ALL ON public.project_announcements TO service_role;
GRANT ALL ON public.project_announcement_recipients TO service_role;
GRANT ALL ON public.project_announcement_acks TO service_role;

CREATE OR REPLACE FUNCTION public.announcement_company_type_code(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE lower(btrim(COALESCE(_raw, '')))
    WHEN 'client' THEN 'client'
    WHEN '발주처' THEN 'client'
    WHEN 'owner' THEN 'client'
    WHEN 'gc' THEN 'gc'
    WHEN '시공사' THEN 'gc'
    WHEN '원도급' THEN 'gc'
    WHEN '원청' THEN 'gc'
    WHEN 'general_contractor' THEN 'gc'
    WHEN 'contractor' THEN 'contractor'
    WHEN '협력사' THEN 'contractor'
    WHEN '하청' THEN 'contractor'
    WHEN 'subcontractor' THEN 'contractor'
    WHEN 'vendor' THEN 'vendor'
    WHEN '공급사' THEN 'vendor'
    WHEN '납품사' THEN 'vendor'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.announcement_company_tree(_project_id uuid, _root uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH RECURSIVE walk AS (
    SELECT _root AS company_id
    WHERE _root IS NOT NULL
    UNION
    SELECT pc.company_id
      FROM public.project_companies pc
      JOIN walk w ON pc.parent_company_id = w.company_id
     WHERE pc.project_id = _project_id
       AND COALESCE(pc.is_deleted, false) = false
       AND pc.company_id IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT company_id), ARRAY[]::uuid[]) FROM walk;
$$;
