
-- =========================================================================
-- Legacy role / position / approval_lines 정규화 마이그레이션
-- =========================================================================

-- 1) user_roles: master 외 모든 값은 프로젝트 스코프로 이동해야 하므로 삭제
--    (project_members.role_new이 프로젝트 권한의 SSOT)
DELETE FROM public.user_roles
WHERE role IS NOT NULL AND role <> 'master';

-- 2) project_members.role_new 정규화 (텍스트 컬럼이므로 UPDATE로 안전)
UPDATE public.project_members
SET role_new = (CASE lower(role_new::text)
  WHEN 'contractor'    THEN 'worker'
  WHEN 'user'          THEN 'worker'
  WHEN 'inspector'     THEN 'supervisor'
  ELSE role_new::text
END)::project_role
WHERE role_new IS NOT NULL
  AND lower(role_new::text) IN ('contractor', 'user', 'inspector');

-- 알 수 없는 값 → viewer로 강등 (silent 승격 없이 최소 권한)
UPDATE public.project_members
SET role_new = 'viewer'::project_role
WHERE role_new IS NOT NULL
  AND lower(role_new::text) NOT IN (
    'master','project_admin','safety_manager','site_manager','supervisor','worker','viewer'
  );

-- 3) profiles.position 정규화 (대문자 enum과 매칭되도록)
UPDATE public.profiles
SET position = CASE lower(position)
  WHEN 'safety_manager'   THEN 'HSE_MANAGER'
  WHEN 'sm'               THEN 'HSE_MANAGER'
  WHEN 'hse_manager'      THEN 'HSE_MANAGER'
  WHEN 'site_manager'     THEN 'SITE_MANAGER'
  WHEN 'site_director'    THEN 'SITE_MANAGER'
  WHEN 'cm'               THEN 'CONSTRUCTION_MGR'
  WHEN 'owner_pm'         THEN 'OWNER_PM'
  WHEN 'owner_hse'        THEN 'OWNER_HSE'
  WHEN 'construction_mgr' THEN 'CONSTRUCTION_MGR'
  WHEN 'field_engineer'   THEN 'FIELD_ENGINEER'
  WHEN 'foreman'          THEN 'FOREMAN'
  WHEN 'supervisor'       THEN 'SUPERVISOR'
  WHEN 'inspector'        THEN 'SUPERVISOR'
  WHEN 'worker'           THEN 'WORKER'
  WHEN 'ceo'              THEN 'CEO'
  WHEN 'executive'        THEN 'EXECUTIVE'
  WHEN 'manager'          THEN 'CONSTRUCTION_MGR'
  ELSE position
END
WHERE position IS NOT NULL
  AND lower(position) IN (
    'safety_manager','sm','hse_manager','site_manager','site_director','cm',
    'owner_pm','owner_hse','construction_mgr','field_engineer','foreman',
    'supervisor','inspector','worker','ceo','executive','manager'
  );

-- 4) project_members.position_new 정규화 (회사 타입 반영)
UPDATE public.project_members pm
SET position_new = (
  CASE
    WHEN lower(pm.position_new::text) IN ('safety_manager','sm','hse_manager') THEN
      CASE WHEN c.type IN ('client') THEN 'OWNER_HSE' ELSE 'HSE_MANAGER' END
    WHEN lower(pm.position_new::text) IN ('site_manager','site_director') THEN
      CASE WHEN c.type IN ('client') THEN 'OWNER_PM' ELSE 'SITE_MANAGER' END
    WHEN lower(pm.position_new::text) = 'cm'                THEN 'CONSTRUCTION_MGR'
    WHEN lower(pm.position_new::text) = 'owner_pm'          THEN 'OWNER_PM'
    WHEN lower(pm.position_new::text) = 'owner_hse'         THEN 'OWNER_HSE'
    WHEN lower(pm.position_new::text) = 'construction_mgr'  THEN 'CONSTRUCTION_MGR'
    WHEN lower(pm.position_new::text) = 'field_engineer'    THEN 'FIELD_ENGINEER'
    WHEN lower(pm.position_new::text) = 'foreman'           THEN 'FOREMAN'
    WHEN lower(pm.position_new::text) IN ('supervisor','inspector') THEN 'SUPERVISOR'
    WHEN lower(pm.position_new::text) = 'worker'            THEN 'WORKER'
    WHEN lower(pm.position_new::text) = 'ceo'               THEN 'CEO'
    WHEN lower(pm.position_new::text) = 'executive'         THEN 'EXECUTIVE'
    WHEN lower(pm.position_new::text) = 'manager'           THEN 'CONSTRUCTION_MGR'
    ELSE pm.position_new::text
  END
)::project_position
FROM public.companies c
WHERE pm.company_id = c.id
  AND pm.position_new IS NOT NULL
  AND (pm.position_new::text) <> upper(pm.position_new::text);

-- 5) approval_lines.position 을 SSOT 5단계 키로 재매핑
--    발주 vs 협력 구분을 위해 결재자(user_id)의 project_members 회사 타입을 조회
WITH approver_ctx AS (
  SELECT
    al.id,
    lower(al.position) AS legacy_pos,
    c.type AS company_type
  FROM public.approval_lines al
  LEFT JOIN public.project_members pm
    ON pm.project_id = al.project_id AND pm.user_id = al.user_id
  LEFT JOIN public.companies c
    ON c.id = COALESCE(al.company_id, pm.company_id)
)
UPDATE public.approval_lines al
SET position = mapped.new_pos
FROM (
  SELECT
    ctx.id,
    CASE
      -- 이미 SSOT 키면 유지
      WHEN ctx.legacy_pos IN (
        'contractor_supervisor','contractor_safety_manager','contractor_site_director',
        'owner_cm','owner_sm','cooperator'
      ) THEN ctx.legacy_pos

      WHEN ctx.legacy_pos IN ('supervisor','contractor_pic') THEN 'contractor_supervisor'

      WHEN ctx.legacy_pos IN ('safety_manager','hse_manager','sm','safety_pic') THEN
        CASE
          WHEN ctx.company_type IN ('client','gc') THEN 'owner_sm'
          WHEN ctx.company_type IN ('contractor','vendor') THEN 'contractor_safety_manager'
          ELSE 'cooperator' -- 회사 불명 → 보류
        END

      WHEN ctx.legacy_pos IN ('site_manager','site_director') THEN
        CASE
          WHEN ctx.company_type IN ('client','gc') THEN 'owner_cm'
          WHEN ctx.company_type IN ('contractor','vendor') THEN 'contractor_site_director'
          ELSE 'cooperator'
        END

      WHEN ctx.legacy_pos IN ('project_admin','cm','owner_pm') THEN 'owner_cm'
      WHEN ctx.legacy_pos IN ('owner_hse') THEN 'owner_sm'

      ELSE 'cooperator'
    END AS new_pos
  FROM approver_ctx ctx
) mapped
WHERE al.id = mapped.id
  AND al.position IS DISTINCT FROM mapped.new_pos;
