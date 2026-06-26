
-- 2026 산업안전보건법 기반 법정 교육/건강진단 매핑 확장
-- 기존 시스템 기본 항목 갱신을 위해 재설정
DELETE FROM public.worker_legal_education_mapping
WHERE is_system_default = true;

INSERT INTO public.worker_legal_education_mapping
  (project_id, job_type, education_type, interval_months, first_due_days, required_hours, legal_basis, is_system_default, is_deleted)
VALUES
  -- ───── 정기 안전보건교육 (시행규칙 §26 [별표4]) ─────
  (NULL,'office','regular',3,90,3,'산업안전보건법 시행규칙 제26조 [별표4] - 사무직 3개월 3시간',true,false),
  (NULL,'general','regular',3,90,6,'산업안전보건법 시행규칙 제26조 [별표4] - 일반근로자(건설일용 제외) 3개월 6시간',true,false),
  (NULL,'construction_perm','regular',3,90,6,'산업안전보건법 시행규칙 제26조 [별표4] - 건설업 상시근로자',true,false),
  (NULL,'manager','manager',12,90,16,'산업안전보건법 시행규칙 제26조 [별표4] - 관리감독자 연 16시간',true,false),
  (NULL,'safety_officer','manager',12,90,24,'산업안전보건법 §17·시행규칙 §29 - 안전보건관리책임자/관리자 직무교육',true,false),

  -- ───── 신규 채용시 / 작업변경시 (시행규칙 §26 [별표4]) ─────
  (NULL,'general','new_hire',0,1,8,'산업안전보건법 시행규칙 제26조 [별표4] - 일반 채용시 8시간',true,false),
  (NULL,'office','new_hire',0,1,1,'산업안전보건법 시행규칙 제26조 [별표4] - 사무직 채용시 1시간',true,false),
  (NULL,'short_term','new_hire',0,1,2,'산업안전보건법 시행규칙 제26조 [별표4] - 단시간/기간제 채용시 2시간',true,false),
  (NULL,'general','job_change',0,1,2,'산업안전보건법 시행규칙 제26조 [별표4] - 작업내용 변경시 2시간',true,false),
  (NULL,'hazardous','job_change',0,1,2,'산업안전보건법 시행규칙 제26조 [별표4] - 작업내용 변경시 2시간',true,false),

  -- ───── 건설업 기초안전보건교육 (산안법 §31, 4시간) ─────
  (NULL,'general','new_hire_construction',0,1,4,'산업안전보건법 §31 - 건설일용근로자 기초안전보건교육 4시간(최초 입직)',true,false),
  (NULL,'construction_perm','new_hire_construction',0,1,4,'산업안전보건법 §31',true,false),

  -- ───── 특별교육 (시행규칙 §26 [별표5] - 39개 작업) ─────
  -- 건설업 일용직 2시간, 그 외 16시간(+분할 가능)
  (NULL,'hazardous','special',24,1,16,'산업안전보건법 시행규칙 제26조 [별표5] - 유해·위험작업 16시간',true,false),
  (NULL,'chemical','special',24,1,16,'시행규칙 [별표5] §1 - 폭발성·인화성 화학물질 취급',true,false),
  (NULL,'asbestos','special',12,1,16,'산업안전보건법 §123 - 석면해체·제거작업자 특별교육',true,false),
  (NULL,'confined','special',12,1,16,'시행규칙 [별표5] §23 - 밀폐공간 작업 특별교육',true,false),
  (NULL,'welding','special',24,1,16,'시행규칙 [별표5] §4 - 용접·용단 작업 특별교육',true,false),
  (NULL,'height','special',24,1,16,'시행규칙 [별표5] §33 - 2m이상 고소작업 특별교육',true,false),
  (NULL,'scaffold','special',24,1,16,'시행규칙 [별표5] §27 - 비계 조립·해체 특별교육',true,false),
  (NULL,'formwork','special',24,1,16,'시행규칙 [별표5] §22 - 거푸집·동바리 조립 특별교육',true,false),
  (NULL,'demolition','special',24,1,16,'시행규칙 [별표5] §28 - 구조물 해체작업 특별교육',true,false),
  (NULL,'excavation','special',24,1,16,'시행규칙 [별표5] §35 - 굴착·흙막이 지보공 특별교육',true,false),
  (NULL,'electrical','special',24,1,16,'시행규칙 [별표5] §13 - 활선 전기작업 특별교육',true,false),
  (NULL,'crane_signal','special',24,1,16,'시행규칙 [별표5] §38 - 양중기 신호수 특별교육',true,false),
  (NULL,'heavy_equipment','special',24,1,16,'시행규칙 [별표5] §37 - 건설기계 운전 특별교육',true,false),
  (NULL,'rigging','special',24,1,16,'시행규칙 [별표5] §11 - 1톤 이상 줄걸이 양중작업',true,false),

  -- ───── MSDS 교육 (산안법 §114) ─────
  (NULL,'chemical','msds',0,30,2,'산업안전보건법 §114 - 신규 화학물질 사용 전 MSDS 교육',true,false),

  -- ───── 일반 건강진단 (산안법 §129) ─────
  (NULL,'office','general_health',24,30,NULL,'산업안전보건법 §129 - 사무직 2년 1회',true,false),
  (NULL,'general','general_health',12,30,NULL,'산업안전보건법 §129 - 비사무직(건설근로자) 연 1회',true,false),
  (NULL,'construction_perm','general_health',12,30,NULL,'산업안전보건법 §129',true,false),

  -- ───── 특수 건강진단 (산안법 §130 / 시행규칙 [별표22]) ─────
  (NULL,'hazardous','special_health',12,30,NULL,'산업안전보건법 §130 - 유해인자 노출 근로자(주기 유해인자별 6·12·24개월)',true,false),
  (NULL,'chemical','special_health',6,30,NULL,'산업안전보건법 §130 - 발암성/생식독성 6개월',true,false),
  (NULL,'asbestos','special_health',12,30,NULL,'산업안전보건법 §130 - 석면 노출 근로자',true,false),
  (NULL,'welding','special_health',24,30,NULL,'산업안전보건법 §130 - 용접흄(망간) 노출',true,false),
  (NULL,'confined','special_health',24,30,NULL,'산업안전보건법 §130 - 밀폐공간 산소·가스 노출',true,false),
  (NULL,'night_shift','night_health',6,30,NULL,'산업안전보건법 §130·시행규칙 §202의2 - 야간작업자 6개월',true,false),

  -- ───── 배치 전 건강진단 (시행규칙 §202) ─────
  (NULL,'hazardous','pre_placement_health',0,30,NULL,'시행규칙 §202 - 유해인자 노출 작업 배치 전',true,false),
  (NULL,'chemical','pre_placement_health',0,30,NULL,'시행규칙 §202',true,false),
  (NULL,'asbestos','pre_placement_health',0,30,NULL,'시행규칙 §202',true,false),

  -- ───── 근골격계 유해요인조사 (산안법 §39·고시) ─────
  (NULL,'general','msd_survey',36,180,NULL,'근골격계부담작업 유해요인조사 - 3년 주기(중대변경시 즉시)',true,false),

  -- ───── 보호 대상 ─────
  (NULL,'foreign','foreign_safety',0,15,4,'외국인 근로자 안전보건교육 가이드 - 입직 15일 이내 4시간',true,false),
  (NULL,'young','young_protection',0,15,4,'근로기준법 §65 / 산안법 §139 - 18세 미만 근로자 유해작업 금지·보호교육',true,false),
  (NULL,'pregnant','pregnant_protection',0,15,2,'산안법 §139 / 근기법 §74 - 임산부 보호교육 및 작업제한',true,false),
  (NULL,'elderly','general_health',12,30,NULL,'산안법 §129 - 고령자(55세↑) 매년 일반건강진단 권장',true,false);
