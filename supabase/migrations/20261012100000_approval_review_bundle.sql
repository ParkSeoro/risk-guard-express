-- 상신 순간 결재 화면에 나오는 본문을 한 덩어리로 남긴다.
-- 결재 도장과 근로자 공유 서명은 이 덩어리에 넣지 않는다.

CREATE INDEX IF NOT EXISTS idx_risk_items_run_id ON public.risk_items (run_id);

CREATE OR REPLACE FUNCTION public.snapshot_approval_document(_entity_type text, _entity_id uuid, _version int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _run public.assessment_runs;
  _prev public.assessment_runs;
  _older public.assessment_runs;
  _plan public.work_plans;
  _payload jsonb := '{}'::jsonb;
  _rigging jsonb;
  _items jsonb;
  _prev_id uuid;
  _older_id uuid;
  _author uuid;
  _items_by_run jsonb := '{}'::jsonb;
  _feedback jsonb := '{}'::jsonb;
  _rid uuid;
BEGIN
  IF _entity_type = 'work_permit' THEN
    SELECT to_jsonb(p) - 'weather_snapshot' INTO _payload
      FROM public.work_permits p WHERE p.id = _entity_id;
  ELSIF _entity_type = 'work_plan' THEN
    SELECT * INTO _plan FROM public.work_plans p WHERE p.id = _entity_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    SELECT to_jsonb(r) INTO _rigging FROM public.rigging_plans r WHERE r.work_plan_id = _entity_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', a.id,
             'name', a.name,
             'category', a.category,
             'attachment_key', a.attachment_key,
             'file_url', a.file_url,
             'mime_type', a.mime_type,
             'description', a.description,
             'is_mandatory', a.is_mandatory
           ) ORDER BY a.is_mandatory DESC, a.created_at), '[]'::jsonb)
      INTO _items
      FROM public.work_plan_attachments a
     WHERE a.work_plan_id = _entity_id
       AND COALESCE(a.is_deleted, false) = false;
    _author := COALESCE(_plan.author_user_id, _plan.created_by);
    _payload := jsonb_build_object(
      'bundle_version', 2,
      'plan', to_jsonb(_plan),
      'rigging_plan', _rigging,
      'attachments', COALESCE(_items, '[]'::jsonb),
      'project', (SELECT to_jsonb(pr) FROM public.projects pr WHERE pr.id = _plan.project_id),
      'company_name', (SELECT c.name FROM public.companies c WHERE c.id = _plan.company_id),
      'creator_name', (SELECT pf.display_name FROM public.profiles pf WHERE pf.user_id = _author)
    );
  ELSIF _entity_type = 'assessment_run' THEN
    SELECT * INTO _run FROM public.assessment_runs r WHERE r.id = _entity_id;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    _prev_id := public.resolve_assessment_previous_run(_run, NULL);
    _older_id := NULL;
    IF _prev_id IS NOT NULL THEN
      SELECT * INTO _prev FROM public.assessment_runs WHERE id = _prev_id;
      IF NOT FOUND THEN
        _prev_id := NULL;
      ELSE
        _older_id := public.pick_previous_approved_assessment_run(_prev);
        IF _older_id IS NOT NULL THEN
          SELECT * INTO _older FROM public.assessment_runs WHERE id = _older_id;
          IF NOT FOUND THEN
            _older_id := NULL;
          END IF;
        END IF;
      END IF;
    END IF;

    FOR _rid IN
      SELECT v.run_id
        FROM (VALUES (_run.id), (_prev_id), (_older_id)) AS v(run_id)
       WHERE v.run_id IS NOT NULL
    LOOP
      SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.sort_order NULLS LAST, i.created_at), '[]'::jsonb)
        INTO _items
        FROM public.risk_items i
       WHERE i.run_id = _rid
         AND COALESCE(i.is_deleted, false) = false;
      _items_by_run := _items_by_run || jsonb_build_object(_rid::text, COALESCE(_items, '[]'::jsonb));

      SELECT COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
        INTO _items
        FROM public.risk_item_feedback f
       WHERE f.assessment_run_id = _rid;
      _feedback := _feedback || jsonb_build_object(_rid::text, COALESCE(_items, '[]'::jsonb));
    END LOOP;

    _author := COALESCE(_run.author_user_id, _run.created_by);
    _payload := jsonb_build_object(
      'bundle_version', 2,
      'risk_items', COALESCE(_items_by_run->_run.id::text, '[]'::jsonb),
      'items_by_run', _items_by_run,
      'feedback_by_run', _feedback,
      'previous_run', CASE WHEN _prev_id IS NULL THEN NULL ELSE to_jsonb(_prev) END,
      'previous_of_previous_run', CASE WHEN _older_id IS NULL THEN NULL ELSE to_jsonb(_older) END,
      'participants', COALESCE((
        SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at)
          FROM public.assessment_run_participants p
         WHERE p.run_id = _run.id
      ), '[]'::jsonb),
      'worker_opinions', COALESCE((
        SELECT jsonb_agg(to_jsonb(o) ORDER BY o.created_at)
          FROM public.worker_opinions o
         WHERE o.run_id = _run.id
      ), '[]'::jsonb),
      'assessment_accidents', COALESCE((
        SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
          FROM public.assessment_accidents a
         WHERE a.run_id = _run.id
      ), '[]'::jsonb),
      'health_hazards', COALESCE((
        SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at)
          FROM public.health_hazards h
         WHERE h.run_id = _run.id
      ), '[]'::jsonb),
      'validation_results', COALESCE((
        SELECT jsonb_agg(to_jsonb(v))
          FROM public.validation_results v
         WHERE v.run_id = _run.id
      ), '[]'::jsonb),
      'project', (SELECT to_jsonb(pr) FROM public.projects pr WHERE pr.id = _run.project_id),
      'company_links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'company_id', pc.company_id,
          'parent_company_id', pc.parent_company_id,
          'role_in_project', pc.role_in_project,
          'companies', CASE
            WHEN c.id IS NULL THEN NULL
            ELSE jsonb_build_object(
              'id', c.id,
              'name', c.name,
              'type', c.type,
              'parent_company_id', c.parent_company_id,
              'is_deleted', c.is_deleted
            )
          END
        ))
          FROM public.project_companies pc
          LEFT JOIN public.companies c ON c.id = pc.company_id
         WHERE pc.project_id = _run.project_id
           AND COALESCE(pc.is_deleted, false) = false
      ), '[]'::jsonb),
      'author_members', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'company_id', pm.company_id,
          'role_new', pm.role_new,
          'companies', CASE
            WHEN c.id IS NULL THEN NULL
            ELSE jsonb_build_object('name', c.name, 'type', c.type)
          END
        ))
          FROM public.project_members pm
          LEFT JOIN public.companies c ON c.id = pm.company_id
         WHERE pm.user_id = _author
           AND pm.project_id = _run.project_id
      ), '[]'::jsonb),
      'author_display_name', (
        SELECT pf.display_name FROM public.profiles pf WHERE pf.user_id = _run.author_user_id
      )
    );
  ELSIF _entity_type = 'safety_cost' THEN
    SELECT to_jsonb(r) INTO _payload FROM public.safety_cost_monthly_reports r WHERE r.id = _entity_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at), '[]'::jsonb)
      INTO _items FROM public.safety_cost_items i
     WHERE i.report_id = _entity_id AND COALESCE(i.is_deleted, false) = false;
    _payload := COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('items', _items);
  ELSE
    RETURN;
  END IF;

  INSERT INTO public.document_content_snapshots (entity_type, entity_id, approval_version, payload, created_by)
  VALUES (_entity_type, _entity_id, COALESCE(_version, 1), COALESCE(_payload, '{}'::jsonb), auth.uid())
  ON CONFLICT (entity_type, entity_id, approval_version)
  DO UPDATE SET payload = EXCLUDED.payload, created_at = now();
END;
$function$;

-- 이미 올라간 결재는 지금 잠긴 본문으로 덩어리를 채운다. 작성중 문서는 건드리지 않는다.
DO $backfill$
DECLARE
  _row record;
BEGIN
  FOR _row IN
    SELECT DISTINCT ON (a.entity_id) a.entity_id, a.approval_version
      FROM public.approvals a
      JOIN public.assessment_runs r ON r.id = a.entity_id
     WHERE a.entity_type = 'assessment_run'
       AND COALESCE(r.status, '') NOT IN (
         '작성중', '제출됨', '검증중', '검증대기', '검토대기', '보완요청', '보완중', '반려', '검증완료', '임시저장'
       )
     ORDER BY a.entity_id, a.approval_version DESC NULLS LAST
  LOOP
    PERFORM public.snapshot_approval_document('assessment_run', _row.entity_id, _row.approval_version);
  END LOOP;

  FOR _row IN
    SELECT DISTINCT ON (a.entity_id) a.entity_id, a.approval_version
      FROM public.approvals a
      JOIN public.work_plans p ON p.id = a.entity_id
     WHERE a.entity_type = 'work_plan'
       AND COALESCE(p.status, '') NOT IN ('작성중', '반려', '임시저장')
     ORDER BY a.entity_id, a.approval_version DESC NULLS LAST
  LOOP
    PERFORM public.snapshot_approval_document('work_plan', _row.entity_id, _row.approval_version);
  END LOOP;
END;
$backfill$;
