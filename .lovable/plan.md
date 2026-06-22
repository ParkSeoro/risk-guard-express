
요청이 워낙 크기 때문에 한 번에 다 치면 회귀 위험이 매우 큽니다. 아래 순서대로 진행하고, 각 단계가 끝날 때마다 ConsistencyAudit + SystemTestEngine 으로 작동을 검증합니다.

## A. 매뉴얼/도움말 정비 (먼저, 사용 경험 즉시 개선)
**문제**: HelpButton, TutorialOverlay, Manual.tsx, InstallPrompt 등 여러 도움말이 동시에/반복적으로 뜸.
**조치**:
1. `useHelpController` 훅 도입 — 페이지 라우트별로 "한 번만 자동 표시" + dismiss 영구 저장 (localStorage `help-seen:<route>`).
2. TutorialOverlay 는 최초 1회 + 명시적 "도움말" 버튼으로만 호출.
3. HelpButton 은 우측 하단 floating 단일 인스턴스로 통합 (사이드바/페이지별 중복 제거).
4. Manual.tsx = "전체 매뉴얼 뷰어" 한 곳으로만 유지. 각 페이지 안의 inline 매뉴얼 박스 제거 → "?" 아이콘 → 우측 Sheet 패널로 통일.
5. InstallPrompt 는 모바일 + 최초 방문 후 3분 경과 시에만 표시.

## B. Phase 1-3 + 1-4: 감사 로그 자동화 + 에러 가시화 표준화
1. `src/lib/dataAccess.ts` 에 `scopedInsert / scopedUpdate / scopedSoftDelete` wrapper 확장 — 모든 mutation 이 자동으로 `audit_logs` 에 기록.
2. `src/lib/errors.ts` 생성 — Supabase/RLS/Zod 에러를 한국어 메시지로 변환 (`translateError`).
3. `useToastError(error)` 헬퍼 — toast + console.error + 옵션으로 Sentry-style 로깅.
4. 전 페이지의 `catch` 블록을 `useToastError` 로 일괄 치환 (회귀 영향이 큰 핵심 25개 페이지 우선).
5. 글로벌 `ErrorBoundary` 를 `AppLayout` 에 부착해 React 런타임 에러도 한국어 토스트.

## C. 근로자 일일 QR 출퇴근 재설계
**현재**: workers 테이블에 영구 `qr_token`. 매일 새 토큰이 아님.
**변경 설계**:
- 신규 테이블 `worker_daily_qr (id, worker_id, project_id, work_date, qr_token UNIQUE, expires_at, created_at)` — 매일 0시 또는 최초 조회 시 자동 생성, `expires_at = 당일 23:59 KST`.
- RPC `issue_daily_qr(_worker_id, _date)` — 이미 있으면 반환, 없으면 생성.
- RPC `worker_scan(_token, _action 'entry'|'exit', _signature)` — 토큰 → daily_qr → worker 로 resolve, 만료 검증, `worker_entry_logs` 에 기록.
  - entry: 같은 날 open entry 있으면 거부.
  - exit: open entry 닫음.
- 현장 입구에서 근로자는 본인 폰의 "오늘의 QR"(WorkerPortal 에 큰 QR 표시)을 보여주고, 안전관리자가 모바일에서 `MobileScan` 으로 스캔 → 자동 entry/exit 판정.
- 또는 근로자 폰에서 직접 출근/퇴근 버튼 (자가 인증) — 위치/서명 포함.
- 신규 페이지/수정:
  - `src/pages/WorkerPortal.tsx` 개편: "오늘의 QR" 카드 + 출근/퇴근 상태 + 서명패드.
  - `src/pages/MobileScan.tsx` 개편: 카메라 스캔 → 토큰 → 어떤 worker인지 표시 → 출근/퇴근 액션.
  - `src/pages/WorkerAttendance.tsx`: 일자별 출퇴근 현황 + 미퇴근자 알림.
- 마이그레이션: 위 신규 테이블 + GRANT + RLS (project 멤버만 조회).

## D. Phase 2: 모듈 간 연동 규칙
1. `source_run_id`, `source_work_plan_id`, `source_permit_id` 표준 컬럼 점검 (이미 일부 존재) → 누락된 곳 추가.
2. 자동 파생 트리거 (애플리케이션 레벨):
   - 작업계획서 승인완료 → 위험성평가 run 자동 제안
   - 작업허가 발급 → 그날 TBM 세션 자동 생성
   - 사고 등록 → 동일 공정 재평가 To-Do 자동 생성
3. ProjectDetail 에 "안전관리 흐름도" 탭 추가 — 위 연결 시각화 (간단한 카드 체인).

## E. Phase 3: 법적 안전관리 모듈 보강
1. **안전점검 세분화**: 일상/정기/합동/자체/작업전 type 컬럼 추가, 각 템플릿 차별화.
2. **법정교육 관리**: `safety_education_materials` 옆에 `worker_education_logs (worker_id, material_id, completed_at, signature)` 추가. 법정교육 종류 (정기/특별/관리감독자/신규채용/작업내용변경) enum.
3. **사고·아차사고·재발방지**: `accident_cases` / `incident_reports` 에 `near_miss` 플래그, `recurrence_prevention_plan` 텍스트, "재발방지 완료" 워크플로우.
4. **법적업무 자동화**: `legal_duties` 의 주기(weekly/monthly/quarterly/yearly) 기반으로 To-Do 자동 생성 cron — `supabase/functions/legal-duty-scheduler` + pg_cron.

## F. Phase 4: QA 회귀 검증
1. `SystemTestEngine` 시나리오 추가:
   - 일일 QR 발급 → 스캔 → 출퇴근 라이프사이클
   - 작업계획서 → 위험성평가 자동 파생
   - 소프트 삭제 → 휴지통 복구
2. `ConsistencyAudit` 에 새 규칙 추가:
   - audit_logs 누락 mutation
   - daily_qr 만료 미처리
3. 매 Phase 종료 후 ConsistencyAudit 실행 → 점수 추적.

## 실행 순서 / 단계별 커밋
1. **A (매뉴얼 정비)** — 1턴
2. **B (감사+에러)** — 2턴
3. **C (일일 QR)** — 2턴 (마이그레이션 + UI)
4. **D (연동)** — 2턴
5. **E (법적 모듈)** — 3턴
6. **F (QA)** — 1턴

총 ~11턴 예상. 각 단계 끝에 `/consistency-audit` 와 `/system-test` 결과 캡처/확인.

## 확인 요청
- 위 순서 그대로 진행할까요, 아니면 **C(일일 QR)** 부터 먼저 처리할까요? (사용자가 명시적으로 요청한 새 기능이라 우선순위 조정 가능)
- 일일 QR 방식: **(가)** 근로자 폰의 오늘의 QR 을 관리자가 스캔 / **(나)** 근로자 본인이 폰에서 출근·퇴근 버튼 직접 클릭 / **(다)** 둘 다 지원 — 어느 쪽으로 갈까요?
- 매뉴얼 정비 시, 기존 페이지 내 인라인 매뉴얼 박스를 모두 제거하고 우측 Sheet 로 통일해도 될까요? (정보는 보존, 표시 방식만 변경)
