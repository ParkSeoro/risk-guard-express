
-- Allow attachment uploads where ANY folder segment is a valid project UUID the user belongs to.
-- This unblocks legacy paths like 'work-plans/{uuid}/...', 'feedback/{uuid}/...', 'worker-photos/{uuid}/...', 'safety-cost/{uuid}/...'
-- while preserving prior allowances (first folder = auth.uid() or a project UUID).

CREATE OR REPLACE FUNCTION public.attachment_path_belongs_to_member(_path text, _uid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seg text;
  seg_uuid uuid;
BEGIN
  IF _uid IS NULL THEN RETURN FALSE; END IF;
  IF public.is_master(_uid) THEN RETURN TRUE; END IF;
  FOREACH seg IN ARRAY storage.foldername(_path) LOOP
    BEGIN
      seg_uuid := seg::uuid;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF seg_uuid = _uid THEN RETURN TRUE; END IF;
    IF public.is_project_member(_uid, seg_uuid) THEN RETURN TRUE; END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.attachment_path_belongs_to_member(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attachment_path_belongs_to_member(text, uuid) TO authenticated;

DROP POLICY IF EXISTS "Project members can upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Project members can list attachments" ON storage.objects;
DROP POLICY IF EXISTS "Project members can update attachments" ON storage.objects;
DROP POLICY IF EXISTS "Project members can delete attachments" ON storage.objects;

CREATE POLICY "Attachments: members can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND public.attachment_path_belongs_to_member(name, auth.uid())
  );

CREATE POLICY "Attachments: members can list"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND public.attachment_path_belongs_to_member(name, auth.uid())
  );

CREATE POLICY "Attachments: members can update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND public.attachment_path_belongs_to_member(name, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'attachments'
    AND public.attachment_path_belongs_to_member(name, auth.uid())
  );

CREATE POLICY "Attachments: members can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND public.attachment_path_belongs_to_member(name, auth.uid())
  );
