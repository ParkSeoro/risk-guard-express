-- 작업계획서 첨부: 기본 필수를 결재차단 공통키만으로 재설정
-- (이전 템플릿 required=true / 설정 저장으로 거의 전부가 필수로 남은 데이터 정리)
-- 잠긴(결재 완료) 행은 유지. 커스텀 항목의 관리자 지정 필수도 유지.

UPDATE public.work_plan_attachment_defs
SET is_mandatory = false
WHERE COALESCE(is_custom, false) = false
  AND COALESCE(is_mandatory, false) = true
  AND attachment_key NOT IN (
    'biz_license',
    'insurance_cert',
    'safety_training',
    'risk_assessment',
    'work_instruction'
  );

UPDATE public.work_plan_attachments
SET is_mandatory = false
WHERE COALESCE(is_deleted, false) = false
  AND COALESCE(is_mandatory, false) = true
  AND COALESCE(locked, false) = false
  AND attachment_key NOT IN (
    'biz_license',
    'insurance_cert',
    'safety_training',
    'risk_assessment',
    'work_instruction'
  );
