# 근로자 360° 통합 관리 시스템

분산된 근로자/교육/건강/출퇴근/TBM 기능을 **하나의 근로자 마스터** 중심으로 묶고, 등록 한 번으로 모든 의무 사항이 자동 계산·알림되도록 재설계합니다.

---

## 1단계: DB 스키마 확장

### workers 테이블 컬럼 추가
- `birth_date` (date) — 만 나이 자동 계산용
- `job_type` (text) — 직종 코드 (일반작업/관리감독자/유해위험작업/특수작업 등)
- `hire_date` (date)
- `assigned_processes` (text[]) — 배정 공정
- `assigned_chemicals` (uuid[]) — 노출 화학물질 (chemicals 참조)
- `requires_daily_health_log` (boolean) — 일일 건강일지 대상 자동 플래그
- `health_grade` (text) — A/C1/C2/D1/D2 등 건진 등급
- `outdoor_worker` (boolean) — 옥외 작업자 (혹서기/혹한기 대상 판별 보조)

### 신규 테이블
**`worker_legal_education_mapping`** (시스템 기본 + 프로젝트 편집)
- `job_type`, `education_type`, `interval_months`, `first_due_days`, `legal_basis`, `is_system_default`, `project_id` (null = 시스템 기본)

**`worker_daily_health_logs`** (일일 건강일지)
- `worker_id`, `log_date`, `body_temp`, `bp_systolic`, `bp_diastolic`, `sleep_hours`, `symptoms` (jsonb), `fit_to_work` (boolean), `signature_data`, `reason` (age65/health_d/heat/cold), `created_at`

**`worker_required_items`** (자동 생성 의무사항 큐)
- `worker_id`, `item_type` (education/checkup/daily_log), `subtype`, `due_date`, `status` (pending/done/overdue), `source` (auto/manual), `legal_basis`, `completed_at`, `completed_ref_id`

### 시스템 기본 교육 매핑 시드 (산안법 기준)
- 일반작업: 신규교육(채용 시 8h, 1회) + 정기교육(분기 6h)
- 관리감독자: 연 16h
- 특별교육: 유해위험작업 배정 시 16h (2년 주기 갱신)
- 일반건강진단: 사무직 2년 / 그 외 1년
- 특수건강진단: 유해인자 노출 시 6개월~24개월 (인자별)

---

## 2단계: 자동화 엔진

### DB 트리거
- `trg_worker_auto_requirements`: workers INSERT/UPDATE 시 job_type/연령/배정 화학물질을 보고 `worker_required_items`에 due_date 자동 산출하여 행 생성
- `trg_health_checkup_complete_requirement`: health_checkups INSERT 시 매칭되는 required_item을 done 처리하고 다음 주기 행 생성
- `trg_health_education_complete_requirement`: health_education_logs INSERT 시 동일 처리
- `trg_worker_daily_log_flag`: 만 65세 이상 또는 health_grade in (D1,D2) → requires_daily_health_log=true 자동 갱신

### Edge Function 신설
**`worker-daily-scheduler`** (매일 06:00 cron)
- D-7 만료 임박 → `notifications` insert (푸시는 기존 트리거가 자동 전송)
- 오늘 일일 건강일지 미작성자 (대상자만) → 본인 + 안전관리자 알림
- 출근했는데 미이수 항목 있는 근로자 일일 리포트

### 출근 QR 플로우 보강
- `worker_daily_scan` 함수 확장: 일일 건강일지 대상자가 오늘 작성 안 했으면 경고 반환 → 모바일에서 일지 입력 화면으로 유도

---

## 3단계: 통합 UI

### 신규: `/workers/:id` 근로자 360° 상세 페이지
탭 구조:
1. **개요** — 기본정보 + 경고 배지 + 다음 의무 D-day 리스트
2. **법정 교육** — 매핑 기반 필수 교육표, 이수일/만료일/상태, 교육 등록 버튼
3. **건강관리** — 일반/특수 건진 이력, 다음 일자, 등급, 작업제한
4. **일일 건강일지** (대상자만 표시) — 캘린더형 작성 현황
5. **출퇴근/TBM** — 최근 30일 이력
6. **유해인자** — 배정 공정/화학물질/MSDS 링크

### PC: `/workers` 목록 개편
- 필터: 만료임박 / 미이수 / 고령자 / 유소견 / 미등록
- 일괄 작업: 알림 발송, CSV 내보내기, 교육/건진 일정 일괄 등록
- 상태 컬럼에 색 배지 (위험·주의·정상)

### 모바일: `/m/workers/:id`
- 동일 데이터, 모바일 최적화 카드 뷰
- **공통 `useWorker(id)` 훅** — PC/모바일이 같은 소스 사용 (단절 방지)

### `/workers/legal-education-mapping` (관리자)
- 시스템 기본 매핑 조회 + 프로젝트별 오버라이드 편집

---

## 4단계: 일일 건강일지 운영

### 대상 자동 산정
- 만 65세 이상 (상시, 연중)
- 건진 등급 D1/D2 (상시)
- (확장 여지) 혹서기 옥외 작업자 — 토글로 후속 가능

### 입력 UX
- **모바일 출근 QR 스캔 → 대상자면 일지 입력 화면 자동 표시 → 작성 후 출근 처리**
- 미작성 시 안전관리자에게 즉시 알림
- 입력 항목: 체온, 혈압(선택), 수면시간, 증상 체크리스트(두통/어지러움/가슴통증 등), 작업 가능 여부 + 서명

### 대시보드 위젯
- 보건관리 대시보드에 "오늘 일일 건강일지 현황" 카드 (작성/미작성/이상소견)

---

## 기술 메모

- 모든 신규 테이블: `GRANT` + RLS (`is_project_member` / `can_access_company_data` 기반)
- soft delete 패턴 준수 (`is_deleted`)
- `useWorker(id)` 훅으로 PC/모바일 데이터 SSOT 통일
- 기존 `notifications` 트리거 활용 → 푸시 자동 발송 (추가 작업 불필요)
- 시드: 시스템 기본 교육 매핑은 별도 insert (마이그레이션에서 1회)

---

## 작업 순서
1. 마이그레이션 1: workers 컬럼 확장 + 신규 3개 테이블 + GRANT/RLS + 시드
2. 마이그레이션 2: 트리거 + `worker_daily_scan` 함수 보강
3. Edge Function `worker-daily-scheduler` + cron 등록
4. `useWorker` 훅 + `/workers/:id` 상세 페이지
5. `/workers` 목록 개편
6. `/m/workers/:id` 모바일 뷰
7. 일일 건강일지 입력 화면 + 모바일 출근 플로우 연결
8. 법정 교육 매핑 관리 화면

승인하시면 1번부터 순차 진행하겠습니다.
