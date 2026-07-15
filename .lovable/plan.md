# 3단계 통합 안정화 · 연동 · 현장 가드 스프린트

3개 단계를 순차 구현합니다. 각 단계는 독립 배포 가능하며, DB 스키마 변경 없이 기존 테이블(assessment_runs, risk_items, work_plans, work_permits, tbm_sessions, tbm_participations)을 그대로 활용합니다. 신규 RPC 2개(`sync_ra_to_wp`, `act_on_entity_approval` 보강)와 스케줄러 1개(`permit-expiry-notifier`)만 추가됩니다.

---

## 1단계 — 한글 폰트 임베딩 & 용어 표준화

**PDF/인쇄 한글 안정화**
- `index.html` `<head>`에 Google Fonts로 **Noto Sans KR** preconnect + `<link>` 프리로드 추가 (400/500/700).
- `src/index.css` 전역 `body` 및 `@media print` 규칙에 `font-family: 'Noto Sans KR','Malgun Gothic','맑은 고딕',sans-serif` 1순위 지정.
- `src/lib/permitOverlayPrint.ts`:
  - 새 창 `<head>`에 동일한 Noto Sans KR `<link>` 삽입, `@page`/`@media print` font-family 지정.
  - canvas에 그리기 전 `await document.fonts.load('16px "Noto Sans KR"')` + `await document.fonts.ready` 가드.
  - print 트리거 전 새 창 쪽에서도 `win.document.fonts.ready` 대기(가능한 경우).
- `src/pages/WorkPermitDetail.tsx` 인쇄 버튼: `await document.fonts.ready` 후 `window.print()` / `printOverlay()` 호출.
- `src/lib/pdfRender.ts`도 동일 폰트 대기 가드 추가(서버 PDF와 클라 미리보기 일치).

**실시간 용어 표준화(IME 안전)**
- `src/components/IMESafeInput.tsx`는 이미 `correctTerms` 커밋 적용. 추가 매핑을 `src/lib/termCorrection.ts`에 보강:
  - `중장비 → 건설기계`, `굴삭 → 굴착`, `안전그물 → 안전방망`.
- 주요 폼(위험성평가/작업계획서/점검표)에서 아직 `<Input>` 직접 사용 중인 한글 필드를 `IMESafeInput`으로 교체. 대상 파일:
  - `src/pages/AssessmentRunDetail.tsx` (공정/위험요인/대책 컬럼)
  - `src/pages/WorkPlanDetail.tsx` + `src/components/work-plan/StructuredSectionForm.tsx`
  - `src/pages/SafetyInspections.tsx` (점검 항목 텍스트)
- `IMESafeTextarea.tsx`에도 동일 termCorrection 옵션이 이미 있는지 확인해 없으면 동일 패턴 적용.

---

## 2단계 — RA → WP → Permit 수직 데이터 연동

**RA→WP 자동 추천 + 동기화**
- `src/pages/WorkPlanDetail.tsx` "위험성평가 연계" 탭:
  - 같은 `project_id`의 `assessment_runs`에서 `status='approved'` AND `is_deleted=false` 최신 회차 자동 조회.
  - 사용자에게 "최신 승인 회차 자동 연결" 배지 표시, 수동 변경 가능한 드롭다운 유지.
- 신규 클라 헬퍼 `src/lib/workPlanAttachments.ts`에 `syncRaToWp(runId, workPlanId)`:
  - `risk_items` where `risk_grade in ('상','high','H')` AND `is_deleted=false` 조회.
  - `hazard` + `improvement_measure`를 `work_plans.risk_measures`(JSONB) 섹션에 `{source_run_id, item_id}` 키로 upsert. 사용자가 편집한 항목은 `manually_edited=true`로 보존.

**최종 승인 시 허가서 자동 잠금**
- Supabase RPC `act_on_entity_approval` 보강(SECURITY DEFINER):
  - 대상이 `work_plan`이고 최종 승인 처리 시, `work_permits where work_plan_id = ...` 로우도 `status='approved'`, `is_locked=true`, `approved_at=now()`로 UPDATE.
  - 트랜잭션 내부에서 감사 로그(`audit_logs`)에 `action='cascade_lock'` 기록.

---

## 3단계 — 현장 실시간 가드 & 만료 알림

**TBM 미참여 입장 차단**
- `src/pages/MobileScan.tsx` (및 `WorkerPortal.tsx` 입장 처리부): QR 인식 → 서버 사이드로 검증.
- 신규 Edge Function `verify-worker-entry` 또는 기존 진입 지점에서 아래 규칙 실행:
  - 오늘 자 `tbm_sessions where project_id AND company_id AND session_date=today AND status='completed'` 존재하는지 확인.
  - 해당 세션들에 대한 `tbm_participations where worker_id=... AND signed_at is not null` 존재 여부 확인.
  - 없으면 `entry_denied` 반환 → 모바일에서 **"TBM 미참여 — 작업장 입장 불가"** 팝업 표시하고 `worker_entry_logs` INSERT 차단.
- 마스터/안전관리자는 우회 허용(감사 로그에 override_reason 요구).

**허가서 유효성 가드**
- `src/pages/WorkPermitDetail.tsx`:
  - `permit_date !== today` 또는 `status !== 'approved'`인 경우 **인쇄** / **작업 시작** 버튼 `disabled` + 툴팁("승인/당일 허가만 실행 가능").
  - 시간 만료(`valid_until < now`) 시에도 동일 처리.

**만료 1시간 전 푸시 알림**
- 신규 Edge Function `supabase/functions/permit-expiry-notifier/index.ts`:
  - `work_permits where status='approved' AND valid_until BETWEEN now()+55min AND now()+65min AND expiry_notified_at IS NULL` 조회.
  - 시공사 관리자(`company_managers`) 및 요청자에게 `sendNotification` + `send-push` 호출.
  - `expiry_notified_at=now()` 마킹으로 중복 방지.
- `pg_cron`으로 매 10분 스케줄 등록(`cron.schedule`).

---

## 완료 정의 (검증 시나리오)

1. **인쇄**: SF003 허가서 PDF 미리보기에서 "굴착기/안전난간" 텍스트가 Noto Sans KR로 선명하게 렌더.
2. **연동**: 위험성평가 회차를 승인 → 새 작업계획서 작성 시 최신 회차 자동 표시 & "위험도 상 항목 자동 불러오기" 성공. 작업계획서 승인 시 연결된 허가서 자동 `잠금`.
3. **차단**: TBM 미참여 근로자 QR 스캔 시 입장 거부 팝업. 만료 55분 전 관리자에게 푸시 도착.

---

## 기술 상세 (개발자용)

- **DB 변경**: 없음(스키마), RPC 1개 신규(`sync_ra_to_wp`는 클라 헬퍼로 처리 가능), `act_on_entity_approval` 보강, `work_permits.expiry_notified_at`(신규 컬럼) 추가.
- **Edge Functions**: `verify-worker-entry`, `permit-expiry-notifier` 신규. 기존 `send-notification-email`/`send-push` 재사용.
- **Cron**: `permit-expiry-notifier`를 10분 주기.
- **폰트 로딩 실패 대비**: `Malgun Gothic` 폴백 유지, `document.fonts.ready`가 5초 초과 시 강제 진행.
- **RLS**: 신규 컬럼/RPC 모두 기존 프로젝트 스코프 정책 준수.

승인해 주시면 1→2→3 순서로 구현하고, 각 단계 완료 시 스크린샷/테스트 결과와 함께 보고드리겠습니다.
