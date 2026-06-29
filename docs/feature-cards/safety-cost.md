# 산업안전보건관리비 (Safety Cost) — Feature Card #10

법적 근거: 건설업 산업안전보건관리비 계상 및 사용기준 (고용노동부 고시)

## 8-Dimension Checklist

| Dim | Status | Note |
|---|---|---|
| Happy path | ✅ | 공사 등록 → 월별 내역서 → AI 자동분류 → 항목 입력 → 증빙 첨부 → 자동검토 → 결재 상신 → 승인 → 누계 반영 → 엑셀/PDF 출력 |
| Permission | ✅ | RLS + UI 이중 스코프. 마스터/PA = 전체, 그 외 = `userCompanyId` 공사만 노출 (`scopedConstructions`) |
| Scope | ✅ | 모든 조회 `project_id` 필터, 항목 `is_deleted=false`. 회사간 데이터 격리 (회사 드롭다운도 `scopedCompanies`) |
| Empty/Loading UI | ✅ | 공사 목록 Skeleton 3개, 빈 상태 CTA(공사 등록 버튼), 항목 빈/검색 무결과 메시지 분리 |
| Edge inputs | ✅ | `normalizeMoneyFields`로 수량/단가/공급가액/부가세 자동 계산, 한글 컬럼명(품목/규격/메이커/공급자) 호환, 음수/NaN 방어 |
| State sync | ✅ | 항목 변경시 `updateReportTotal`로 월 합계 재계산, 승인 누계는 `approved` 상태만 합산. 탭 배지에 baseItems 수·경고·증빙누락 실시간 |
| Audit | ✅ | 공사/항목 수정·삭제 `safety_cost_audit_logs` 기록. 증빙 보완 요청 `audit_logs` 기록 (수신자, 누락항목명 포함) |
| Rollback | ✅ | 항목 소프트 삭제(`is_deleted` + `deleted_reason` 필수). 승인된 월별 내역서는 수정/삭제/항목삭제 차단 |

## 추가된 Polish (이번 사이클)

- `scopedConstructions` 메모 + UI 필터: 시공사 사용자에게 타사 공사 노출 차단
- `itemSearch` (품명·공급자·분류·메이커) — 대용량 거래명세 검색
- 탭 배지: `사용 항목 N` · `자동검토 [경고+증빙누락]`
- 초기 로딩 Skeleton 및 빈 상태 CTA
- 검색 무결과 메시지 분리

## 알려진 한계

- 전월/누계 컬럼은 PDF/엑셀 출력 시 자리만 마련 — 자동 합산 후속 작업 필요
- 영수증 OCR 정확도는 Gemini 모델 한계 — 검토 필요 항목은 수동 보정 필수
