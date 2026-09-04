# Feature Card — 작업허가서 ↔ TBM 연동 (#6)

- 담당자: -
- 관련 라우트: `/work-permits`, `/tbm`, `/m/tbm`
- 관련 테이블: `work_permits`, `tbm_sessions`, `tbm_participations`, `assessment_runs`, `work_plans`
- 관련 컴포넌트: `WorkPermits.tsx`, `TbmManager.tsx`

---

## 1. Happy path
- [x] 작업허가서 작성 시 위험성평가/작업계획서/TBM 세션 연결 (`assessment_run_id`, `work_plan_id`, `tbm_session_id`)
- [x] "게이트체크" 실행 → 결재용(평가+계획서)/실행용(당일 TBM) 두 단계 분리 표시
- [x] 결재 완료 후에도 당일 TBM 미실시면 작업 실행 차단 배지 표시
- [x] 유효기간 배지: 과거 = 만료(빨강), 오늘 = 유효(녹색), 미래 = 예정(회색)

## 2. Permission
- [x] 작성/수정: 작성자 + safety_manager + project_admin (`useProjectAccess`)
- [x] 검토/승인/반려: isAdmin 만 (검토대기 → 검토완료 → 승인)
- [x] 결재상신은 `SubmitApprovalDialog` 사용 — 결재선 지정 가능

## 3. Scope
- [x] `project_id` RLS 격리
- [x] 시공사: 자기 회사 작성 허가서만 SELECT
- [x] TBM 선택지는 같은 프로젝트 50건으로 제한

## 4. Empty / Loading / Error UI
- [x] 0건: "등록된 작업허가서가 없습니다" + 생성 버튼
- [x] 게이트 체크 다이얼로그 검사 중 상태
- [x] 결재불가/실행불가 사유를 인라인 배지로 즉시 표시

## 5. Edge inputs
- [x] 작업 내용 필수
- [x] TBM 미연결 시 "TBM 미실시 - 당일 TBM 필요" 안내
- [x] 같은 날 TBM 인지 여부 자동 판별 (`tbm_date === today`)

## 6. State sync
- [x] 게이트체크 결과는 `gate_check_result` JSON 에 저장 → 새로고침 후 유지
- [x] 결재 상신은 `SubmitApprovalDialog` → `act_on_entity_approval` 가 work_permit status 캐스케이드
- [x] TBM 참여 인원 수 실시간 카운트 (`tbm_participations`)

## 7. Audit
- [x] 모든 상태 변경(상신/검토/승인/반려)이 `submitted_by_name`, `reviewed_by_name`, `approved_by_name` 와 시각으로 기록
- [x] 삭제는 사유 필수 + `audit_logs` 기록

## 8. Rollback
- [x] 소프트 삭제 → `/admin/trash`
- [x] 반려 시 사유 저장 + 작성자 재상신 가능
- [x] 승인 후 수정은 확인 프롬프트 후 추적

---

## 남은 작업
- (선택) 만료된 허가서 자동 클로즈 cron
- 상세 흐름: [`docs/tbm-attendance-permit-link.md`](../tbm-attendance-permit-link.md)
  (허가서 명단은 예상 배정 유지. TBM/실출근으로 허가서를 덮어쓰지 않음. 출근 서명 → TBM)
