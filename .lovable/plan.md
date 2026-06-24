
# 시스템 전체 점검 — 진단 보고서

## 목적

기능을 하나씩 들어가서 눌러보면 "연동이 끊긴 곳", "동작은 하지만 데이터가 어디에도 안 쌓이는 곳", "법적으로 필수인데 비어있는 항목"이 반복적으로 발견됨. 즉흥적인 추천 기능(첨부 빨간 칩)을 무작정 넣지 말고, **시스템 전체를 사용자/근로자 관점에서 한 번 갈아엎는 진단**부터 진행. 본 문서가 진단 결과 + 수정 로드맵.

---

## 1. 끊긴 데이터 연동 (Data Linkage Breaks)

페이지마다 "보이긴 하는데 다른 화면에 영향이 없는" 사일로가 다수.

| # | 끊긴 지점 | 증상 | 원인(가설) |
|---|---|---|---|
| L1 | `project_members.role_new/position_new` ↔ `user_roles` | 프로젝트 직책을 바꿔도 전역 권한(`hasRole`)에 반영 안 됨. 결재선, 법적업무 담당자 매핑도 따로 놂 | 권한 SSOT 없음. 2개 테이블이 각자 사용됨 |
| L2 | `workers` ↔ `worker_entry_logs` ↔ `worker_daily_qr` | QR 인쇄는 되지만 출퇴근 찍어도 명부의 "오늘 출근" 카운트와 안 맞음. 입퇴장현황과 분포 대시보드 수치가 다름 | 같은 이벤트를 3곳에서 각자 집계 (단일 view 없음) |
| L3 | `companies` ↔ `project_members.company_id` ↔ `workers.company_id` | 소속 회사 바꾸면 근로자/보건 데이터가 따라오지 않음. GC/협력사 다중 지정 후 일부 페이지는 여전히 단일 컬럼만 봄 | 다중 회사 마이그레이션이 health/inspection 페이지엔 미적용 |
| L4 | `risk_items` ↔ `legal_duties` ↔ `todo_items` | 위험성평가에서 "High" 떠도 자동으로 할일/법적업무에 안 꽂힘 | 트리거/디스패처 없음 |
| L5 | `safety_inspections` ↔ `incident_reports` ↔ `risk_items` | 점검 부적합 → 위험성평가 갱신/사고예측 학습 루프 없음 | 피드백 루프 미구현 |
| L6 | `chemicals` ↔ `chemical_usage_plans` ↔ `health_checkups`(특수건강진단 대상자) | MSDS는 등록되지만 특수건강진단 자동 대상자 산출과 연결 안 됨 | 매핑 규칙 없음 (`is_carcinogen` 등 플래그만 있음) |
| L7 | `site_maps`/`site_zones` ↔ `worker_zone_events` ↔ 근로자 분포 | 사이트맵 업로드/구역 지정해도 모니터링 화면에 실시간 반영 잘 안 됨 | 채널 구독 키 불일치 (전번 업로드 실패 수정 후 미검증) |
| L8 | `approval_lines` ↔ `approval_route_templates` ↔ 실 결재 | 템플릿 변경해도 신규 결재선에 일부만 반영 | 템플릿 fetch 시점 캐싱 |
| L9 | `tbm_sessions` ↔ `tbm_participations` ↔ 근로자 출근 | TBM 참여 체크가 출근으로 자동 인정되지 않음 (법적 근거 있음) | 별도 로직 |
| L10 | `notifications` ↔ 결재/점검/사고/건강진단 만료 | 알림 발송 규칙이 일부 도메인에만 있음 | 통합 디스패처 없음 |

---

## 2. 작동 불완전 기능 (Half-Working Features)

| # | 기능 | 현 상태 |
|---|---|---|
| F1 | 검증엔진(`SystemTestEngine`, `ConsistencyAudit`) | **시나리오가 CRUD만 검증**. 위 L1~L10 같은 cross-table 일관성은 안 봄. 그래서 "엔진은 통과하는데 사용자는 깨진다" |
| F2 | 일일 QR 발급 | 발급/인쇄는 동작. 단, **만료 후 자동 정리, 재발급 이력, 출퇴근 매칭 정합성** 없음 |
| F3 | 보건관리 6개 페이지 | 회사 필터 적용. 단, **월간·연간 사용계획 → 실 사용량 차이 알림 / 특수건강진단 자동대상 산출 / 작업환경측정 주기 알림** 빠짐 (산안법 시행규칙 §202 등) |
| F4 | 안전점검 → 시정조치 | 부적합 등록 후 **시정 기한·재검사·미이행 에스컬레이션 자동화 없음** |
| F5 | 결재선 | 직책 변경 시 진행 중 결재의 결재자 자동 교체/위임 처리 없음 |
| F6 | 권한관리(설정) ↔ 프로젝트 멤버 | 화면 2곳에서 따로 편집 가능 → 충돌. SSOT 화면 한 곳으로 통합 필요 |
| F7 | 사고 예측 / AI 위험 추천 | 학습 데이터가 `accident_cases` 한 테이블에 고정. 점검·시정조치·사고보고 결과를 다시 안 먹임 |
| F8 | 작업계획서 ↔ 작업허가서 ↔ TBM | 같은 작업을 3번 입력. 한 곳에서 작성 → 자동 파생되는 흐름 없음 |

---

## 3. 법적 누락/약함 (Legal Gaps)

산안법·산안보법·시행규칙 기준.

| # | 법적 요구 | 현재 | 보완안 |
|---|---|---|---|
| Lg1 | **산안법 §29** 안전보건교육 (정기/특별/채용시/관리감독자) | 교육자료 페이지만 있음. 이수자·시간·증빙 미관리 | `worker_education_records` (대상·과정·시수·증빙·다음 주기) |
| Lg2 | **시행규칙 §202** 작업환경측정 6개월 주기·결과보고 | 측정 등록만 가능 | 주기 알림 + 결과 공지(법정 30일내) 워크플로 |
| Lg3 | **시행규칙 §201** 특수건강진단 12개월/24개월 주기, 대상자 자동산출 | 수동 등록만 | MSDS 발암성/생식독성 ↔ 노출 근로자 자동 매핑 |
| Lg4 | **산안법 §57** 중대재해 24시간 내 보고 / **중처법** 보고 | 사고 보고는 있음. **법정시한 카운트다운/보고서 자동 생성 없음** | 시한·산재미보고 알림, 관할 노동청 양식 PDF |
| Lg5 | **산안법 §15~17** 안전보건관리책임자/관리감독자/안전관리자 선임/직무 | 직책은 있으나 **선임신고·직무체크리스트·교체이력 없음** | 선임 이력 + 22개 직무(이미 일부 존재) 체크 게이지 |
| Lg6 | **시행령 §73~75** 도급 사업주의 안전보건 협의체/순회점검/합동안전점검 | 점검 메뉴 있음. **합동/협의체 구분·주기 강제 없음** | 점검 유형 분리, 도급사 참여 의무화 |
| Lg7 | **산안법 §63** 도급인의 안전보건조치 — 협력사 근로자 안전관리 | 협력사 다중 지정만 됨. **협력사별 안전성적표/사고율 트래킹 없음** | 협력사 대시보드 + 평가 |
| Lg8 | **산안법 §54** 작업중지권 | UI 없음 | 모바일에서 근로자 작업중지권 발동 → 알림 즉시 |
| Lg9 | **고용노동부 고시 2024-XX** 산업안전보건관리비 사용 항목/증빙 | 항목·증빙 등록 가능. 월별 정산보고 자동 생성·법정 비율 검증 부분만 있음 | 자동 정산보고서 + 위반 경고 |
| Lg10 | **위험성평가 고시** 연 1회+수시 + 근로자 참여 + 결과 공지 | 평가는 있음. **공지·근로자 의견수렴 증빙·연간 계획서 약함** | 공지함 + 의견수렴 증빙(이미 worker_opinions 일부 활용) |
| Lg11 | **개인정보보호법** 근로자 전화/주민번호 보호 | 일부 finding 이미 처리. 명부에 여전히 평문 노출 영역 있음 | 마스킹 + 다운로드 감사로그 |

---

## 4. 추천 작업 — 우선순위 로드맵

너무 큰 작업이라 단계별로 끊어서 진행해야 함. **모두 한 번에 진행하면 회귀가 커지므로 PR 단위로 분리 권고.**

### Phase A — 데이터 연동 SSOT 정비 (회귀 예방의 기반)
- A1. **권한 SSOT 단일화**: `project_members.position_new` 변경 → `user_roles` 동기 트리거. 설정/프로젝트 두 화면을 같은 훅(`useProjectMembership`)으로 통합 (L1·F6)
- A2. **다중 회사 컬럼 사용 통일**: 모든 health/inspection 페이지가 `gc_company_ids ∪ sub_company_ids ∪ owner_company_id` 기준으로 필터링 (L3)
- A3. **출근 SSOT view**: `v_worker_attendance_today` (QR/입퇴장/TBM 합산) 생성, 모든 카운트 화면이 view 참조 (L2·L9·F2)
- A4. **검증엔진 확장**: cross-table 시나리오 추가 — "직책 변경 → user_roles 반영", "QR 스캔 → 분포 대시 +1", "MSDS 등록 → 특수검진 대상" 등 (F1)

### Phase B — 끊긴 워크플로 자동화
- B1. 위험성평가 High → 할일/법적업무 자동 디스패처 (L4)
- B2. 점검 부적합 → 시정조치(기한/재검/에스컬레이션) (F4·L5)
- B3. 결재 위임/교체 처리 (F5)
- B4. 알림 디스패처 통합 (L10) — 결재·검진·측정·시정·산재시한

### Phase C — 법적 보강
- C1. 안전보건교육 이수관리 (Lg1)
- C2. 특수건강진단 자동대상자 산출 (Lg3·L6) + 측정 주기 알림 (Lg2)
- C3. 중대재해 보고 카운트다운 + 보고서 자동 생성 (Lg4)
- C4. 선임이력 & 도급 협의체/순회/합동 점검 (Lg5·Lg6)
- C5. 협력사 안전성적표 (Lg7)
- C6. 모바일 작업중지권 (Lg8)
- C7. 산안비 자동 정산보고 + 위반 경고 (Lg9)
- C8. 위험성평가 공지·의견수렴 증빙 (Lg10)
- C9. 근로자 PII 마스킹/접근 감사 (Lg11)

### Phase D — UX 일관성
- D1. 작업계획서 → 작업허가서 → TBM 자동 파생 (F8)
- D2. 협력사/회사별 데이터 격리 보장 회귀 테스트 (Phase A의 검증엔진으로)

---

## 5. 진행 방식 제안

이번 턴에서 **전부 코딩**하지 않음 — 너무 크고 회귀 위험. 다음 중 **어느 Phase부터 시작할지** 알려주면 그 Phase만 PR로 끊어서 진행.

권장 시작점: **Phase A (특히 A1·A3·A4)**.
- 이걸 먼저 안 하면 B/C 작업도 또 사일로가 생김
- A4가 검증엔진을 실효성 있게 만들어서, 앞으로 "엔진은 통과하는데 깨진다" 문제를 막음

---

## 6. 기술 메모 (개발자용)

- 권한 SSOT: `project_members` BEFORE UPDATE trigger → `user_roles` upsert. Master는 예외.
- 출근 view: `worker_daily_qr` 스캔 이벤트 + `worker_entry_logs` + `tbm_participations.attended_at` UNION → `worker_id, date, in_at, out_at, source`
- 검증엔진: `src/lib/systemTest/scenarios.ts`에 cross-table assertion 추가. 시나리오는 "행동 → 30초 내 다른 화면의 카운트/플래그 변화" 형태로 작성.
- 법정 주기 알림: `notifications` + `notification_preferences` + cron edge function (이미 `worker-daily-scheduler` 존재 → 확장)
- 협력사 격리: `useProjectAccess` 훅에 `companyScopeIds` getter 추가, 모든 list 쿼리에서 `.in('company_id', companyScopeIds)` 강제.

---

## 다음 단계

위 진단이 사용자가 느낀 문제와 맞는지 확인 후, **Phase A부터 진행해도 될지** 알려주세요. 또는 우선순위 조정/추가하고 싶은 항목 있으면 말씀해 주세요.

---

## 진행 현황 업데이트 (2026-06-24)

### 완료
- **Phase A (기반)**: `v_worker_attendance_today` view, `check_data_integrity()` RPC, 검증엔진 `xtbl` 시나리오
- **Phase B**: 위험성평가→할일 디스패처(B1), 결재 위임 RPC + 통합 알림 디스패처(B3·B4), 점검 부적합→할일 자동화(F4·L5)
- **Phase C — 법적 보강 (대부분 완료)**:
  - C1 안전보건교육 이수관리: `worker_education_records` + 차기주기 자동산정 트리거, `/worker-education`
  - C2 특수건강진단 자동 의무 매핑 (MSDS 발암성→근로자)
  - C3 중대재해 24시간 보고 카운트다운
  - C4 안전관리자 선임이력: `safety_appointments`, 점검 분류(자체/순회/합동/협의체) 컬럼 추가, `/safety-appointments`
  - C5 협력사 안전성적표: `v_contractor_safety_scorecard` view + 점수/등급 산정, `/contractor-scorecard`
  - C6 작업중지권: `work_stop_requests` + 접수 즉시 관리자 critical 알림 트리거, 데스크톱 `/work-stop` + 모바일 `/m/work-stop`
  - C8 위험성평가 공지: `assessment_notices` 테이블 (UI는 후속)
  - C9 PII 접근 감사: `pii_access_logs` (Master 전용 조회)
- **신규 — 사고·비상 도메인**: `incident_reports` 확장, `emergency_drills`, `/incidents`, `/emergency-drills`, 사이드바 "사고·비상" 그룹
- **검증엔진 확장**: `check_data_integrity`에 7가지 체크 (HIGH_RISK_NO_TODO, MAJOR_INCIDENT_OVERDUE, EMERGENCY_DRILL_MISSING, INSPECTION_ACTION_OVERDUE, EDUCATION_OVERDUE, SAFETY_MANAGER_MISSING, WORK_STOP_PENDING)
- **사이드바**: 신규 "법정 이행" 그룹 추가 (교육이수·선임이력·협력사 안전성적표)

### 남은 항목
- Phase A2 — 보건/점검 페이지 다중 회사 필터 UI 통일
- C7 — 산안비 자동 정산보고 + 위반 경고
- C8 UI — 평가 공지 작성/근로자 확인 화면
- Phase D — 작업계획서→허가서→TBM 자동 파생, 회귀 테스트
