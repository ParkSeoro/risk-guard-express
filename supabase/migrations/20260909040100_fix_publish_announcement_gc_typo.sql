-- Live apply of announce_accounts_and_ra_notice briefly had a typo
-- (시공앗) in the GC exception. 20260909040000 already has the correct
-- publish_project_announcement body; this records the hotfix.
-- Idempotent: re-apply the same function from the previous migration.
-- The exception text must be: 다른 시공사에는 공지할 수 없습니다.

DO $$
BEGIN
  IF position('다른 시공사에는 공지할 수 없습니다' IN
       pg_get_functiondef('public.publish_project_announcement(uuid,text,text,jsonb,boolean,timestamptz,uuid)'::regprocedure)
     ) = 0 THEN
    RAISE EXCEPTION 'publish_project_announcement is missing the corrected GC exception copy';
  END IF;
END $$;
