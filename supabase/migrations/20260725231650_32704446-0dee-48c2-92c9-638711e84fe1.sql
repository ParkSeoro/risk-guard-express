
DO $$
DECLARE
  DUP uuid := '905f2d5d-9bbe-4f3b-be2e-873a316ea51d';
  CANON uuid := 'd313393e-0458-4790-a537-808ca7e76589';
  r RECORD;
  sql text;
BEGIN
  -- 1) Resolve project_members conflicts: if same (project_id,user_id) exists on both, keep canonical, delete dup
  DELETE FROM public.project_members pm_dup
   WHERE pm_dup.company_id = DUP
     AND EXISTS (
       SELECT 1 FROM public.project_members pm_c
        WHERE pm_c.company_id = CANON
          AND pm_c.project_id = pm_dup.project_id
          AND pm_c.user_id = pm_dup.user_id
     );

  -- 2) Resolve project_companies conflicts: if same (project_id, company_id) already canonical, delete dup link
  DELETE FROM public.project_companies pc_dup
   WHERE pc_dup.company_id = DUP
     AND EXISTS (
       SELECT 1 FROM public.project_companies pc_c
        WHERE pc_c.company_id = CANON
          AND pc_c.project_id = pc_dup.project_id
     );

  -- 3) Dynamically update every public.* table with a company_id column
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('company_id','parent_company_id')
      AND table_name NOT IN ('companies') -- handled last
      AND table_name IN (SELECT table_name FROM information_schema.tables
                          WHERE table_schema='public' AND table_type='BASE TABLE')
  LOOP
    sql := format('UPDATE public.%I SET %I = %L WHERE %I = %L',
                  r.table_name, r.column_name, CANON, r.column_name, DUP);
    BEGIN
      EXECUTE sql;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Skipped % due to unique conflict: %', r.table_name, SQLERRM;
    END;
  END LOOP;

  -- 4) Fix canonical project_companies rows: ensure parent = 에어리퀴드코리아 where NULL
  UPDATE public.project_companies
     SET parent_company_id = 'bdaf0cc1-0755-4249-95a2-540c11ef5e5a'
   WHERE company_id = CANON
     AND parent_company_id IS NULL;

  -- 5) Update companies.parent_company_id references pointing to dup
  UPDATE public.companies SET parent_company_id = CANON WHERE parent_company_id = DUP;

  -- 6) Delete the duplicate company record
  DELETE FROM public.companies WHERE id = DUP;

  -- 7) Audit log
  INSERT INTO public.audit_logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (NULL, 'system', '회사병합', 'company', CANON::text,
          jsonb_build_object('merged_from', DUP, 'merged_into', CANON, 'reason', '중복 청원산기 통합'));
END $$;

-- Fix signup RPC: use valid enum value ('viewer' instead of 'user')
CREATE OR REPLACE FUNCTION public.process_signup_company_selection(_user_id uuid, _project_id uuid, _company_id uuid, _position text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.project_companies
                 WHERE project_id = _project_id AND company_id = _company_id AND is_deleted = false) THEN
    RAISE EXCEPTION '유효하지 않은 프로젝트/업체 조합입니다';
  END IF;
  UPDATE public.profiles
     SET account_status = 'pending',
         company = COALESCE((SELECT name FROM public.companies WHERE id = _company_id), company)
   WHERE user_id = _user_id;
  INSERT INTO public.project_members (project_id, user_id, company_id, position_new, role_new)
  VALUES (_project_id, _user_id, _company_id, _position::project_position, 'viewer'::project_role)
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET company_id = EXCLUDED.company_id,
        position_new = EXCLUDED.position_new;
END $function$;

GRANT EXECUTE ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text) TO anon, authenticated;
