
# 계획: Phase B 완료 + 산업보건 통합 모듈

## Step 1 — Phase B 일괄 적용 (에러/감사 표준화)

**목표**: 모든 페이지에서 동일한 에러 메시지·감사 로그·소프트 삭제 패턴 사용.

대상 (25+ 페이지):
- 핵심: `Projects`, `ProjectDetail`, `WorkerManagement`, `WorkerAttendance`, `WorkerPortal`, `RiskAssessment`, `AssessmentRuns`, `AssessmentRunDetail`, `WorkPlans`, `WorkPlanDetail`, `WorkPermits`, `SafetyCost`, `SafetyInspections`, `TbmLogs`, `LegalDuties`, `TodoDashboard`, `Approvals`, `VerificationCenter`, `MasterData`, `UserManagement`, `Settings*`
- 모바일: `MobileScan`, `MobileWorkers`, `MobileInspect`, `MobileIncident`, `MobilePermits`

작업:
1. 모든 `catch (e: any) { toast({...}) }` → `useToastError()` 의 `handle(e, '...작업명')`
2. 모든 `.delete()` → `useSoftDelete()` 또는 `scopedSoftDelete()`
3. 모든 직접 `supabase.from(x).select()` (프로젝트 격리 필요한 테이블) → `scopedSelect()`
4. 일관된 토스트 톤(성공/실패/경고) 한국어 통일

검증: 페이지별 build, 핵심 시나리오 5개 Playwright 스모크 테스트.

---

## Step 2 — 산업보건(Health) 통합 데이터 모델

신규 테이블 (모두 `project_id`/`company_id` 격리 + RLS + GRANT + soft delete):

```text
health_checkups            건강진단 마스터 (worker_id, type[일반/특수/배치전/수시], scheduled_date, conducted_date, result[정상/요관찰/유소견], institution, restrictions, attachment_url)
health_checkup_targets     대상자 자동 추출 캐시 (worker_id, due_date, type, status)
work_env_measurements      작업환경측정 (round[1H/2H], measure_date, agency, target_factors jsonb, results jsonb, exceed_items jsonb)
work_env_factors           유해인자 마스터 (project_id, category[소음/분진/화학/물리], name, exposure_limit)
chemicals                  화학물질 (cas_no, name, hazard_class, msds_file_url, warning_label_url, location, monthly_usage)
chemical_workers           화학물질 취급 근로자 매핑 (chemical_id, worker_id, education_at)
health_education_logs      보건교육 이력 (worker_id, type[정기/특별/관리감독자/MSDS], hours, conducted_at, attachment_url)
hazard_surveys             유해요인조사 (type[근골격계/뇌심혈관/직무스트레스], survey_date, target_count, response_count, findings jsonb, actions jsonb, next_due_date)
hazard_survey_responses    개별 응답 (worker_id, scores jsonb, risk_level)
```

기존 테이블 확장:
- `workers`: `health_checkup_status` (정상/요관찰/유소견/미수검), `last_checkup_date`, `special_education_required_until`
- `worker_entry_logs`: `health_warning_shown` (boolean) — 미이수자 경고 후 출근 시 기록

---

## Step 3 — 4개 통합 연동 (한 번에)

### A. 위험성평가 ↔ 작업환경측정/MSDS
- `risk_items`에 `linked_chemical_ids uuid[]`, `linked_env_factor_ids uuid[]` 추가
- AI 위험성평가 생성 시 프로젝트의 화학물질·유해인자 목록을 context로 주입
- 측정값이 노출기준 초과면 해당 risk_item의 grade를 자동 상향(`override_reason='측정초과'`)
- 개선조치 RPC: `apply_env_exceedance_to_risk(measurement_id)` → 자동 To-Do 생성

### B. LegalDuties ↔ 건강진단/측정 일정
- 신규 `legal_duty_templates` 시드: 일반건강진단(연1회), 특수건강진단(주기), 작업환경측정(반기), 보건교육(분기) 등
- 프로젝트 생성 시 자동 인스턴스화 → `todo_items` 자동 생성
- 건강진단 conducted_date 입력 시 해당 todo 자동 완료 + 다음 회차 자동 예약(트리거)

### C. Worker(QR) ↔ 건강진단/특수교육 이수
- `WorkerPortal` 일일 QR 진입 시 RPC `worker_daily_scan`에서 미이수 체크
- 정책: "경고 후 출근 허용 + 관리자 알림"
  - 미수검/교육 미이수면 응답에 `warnings: [...]` 포함
  - 출근은 정상 처리하되 `health_warning_shown=true` 기록
  - 안전관리자에게 `notifications` 자동 발송(미이수 항목 명시)
- WorkerPortal UI: 경고 배지 + 확인 후 진행 버튼

### D. 보건교육 ↔ 기존 교육 모듈
- `safety_education_materials`에 `category=health` 옵션 추가
- 보건교육 완료 시 `health_education_logs` 자동 기록
- 분기별 미이수자 To-Do 자동 생성 (cron)

---

## Step 4 — 신규 페이지 / 사이드바

신규 메뉴 그룹: **보건관리**
- `/health/checkups` — 건강진단 대시보드 (대상자/기한/결과 매트릭스, Excel 업로드)
- `/health/measurements` — 작업환경측정 (반기별 그리드, 초과항목 자동 알림)
- `/health/chemicals` — MSDS/화학물질 (목록, MSDS PDF 첨부, 취급자 매핑)
- `/health/education` — 보건교육 이력 (Worker별 매트릭스)
- `/health/hazard-surveys` — 유해요인조사 (근골격계/뇌심혈관/스트레스 설문 발급·집계)
- `/health/dashboard` — 보건관리자 종합 대시보드 (KPI: 수검률·이수율·초과건수·차회기한)

사이드바: 기존 "안전관리" 그룹 아래 "보건관리" 섹션 추가 (역할 `safety_manager`/`health_manager`/`project_admin`/`master`만 노출).

신규 role: `health_manager` 추가 (선택)? — 일단은 `safety_manager`가 겸임, 추후 분리.

---

## Step 5 — Edge Functions & 자동화

- `health-checkup-scheduler` (cron 매일 09:00): 다가오는 건강진단/측정 기한 7·30일 전 알림
- `health-target-recalc` (cron 매일): 신규 입사자/특수공정 배치자 자동으로 건강진단 대상 추가
- `analyze-hazard-survey` (Lovable AI): 근골격계 설문 응답을 위험등급으로 분류

---

## Step 6 — QA / 회귀

`SystemTestEngine`에 시나리오 추가:
1. 건강진단 등록 → LegalDuties todo 자동 완료
2. 측정 결과 초과 입력 → 해당 위험성평가 grade 상향
3. MSDS 등록된 화학물질 → AI 위험성평가 생성 시 자동 포함
4. 미이수 근로자 QR 출근 → 경고 표시 + 알림 발송
5. 분기 보건교육 미이수자 → 자동 To-Do 생성

---

## 진행 순서 (실 구현 단계)

1. **B-1**: `useToastError` + `scopedSelect/SoftDelete` 일괄 치환 (5개 핵심 → 전체)
2. **H-1**: 신규 보건 테이블 마이그레이션 + RLS + GRANT (한 번에)
3. **H-2**: 보건 모듈 페이지 6개 + 사이드바
4. **H-3**: 4개 연동 (RPC + 트리거 + AI context)
5. **H-4**: cron edge functions
6. **QA**: SystemTestEngine 시나리오 추가, Playwright 스모크

큰 작업이라 단계별로 끊어가며 진행하고, 매 단계 끝에 확인 받겠습니다.

승인하시면 **B-1 → H-1** 순서로 바로 시작합니다.
