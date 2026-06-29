# 작업환경측정 / 특수건강진단 (Work Env & Health Checkups) — Feature Card #11

법적 근거: 산업안전보건법 제125조(작업환경측정), 제129~131조(건강진단)

## 8-Dimension Checklist

| Dim | Status | Note |
|---|---|---|
| Happy path | ✅ | 유해인자 등록 → 반기 측정 등록 → 노출기준 초과 자동 판정 → 개선조치 기록 → 차회 기한 알림 / 근로자 건강진단 등록 → 결과·작업제한 기록 → 차회 기한 알림 |
| Permission | ✅ | RLS + UI 이중 스코프. 마스터/PA/안전관리자 = 전체, 시공사 = 자기 회사 근로자/측정만 (`applyCompanyFilter`) |
| Scope | ✅ | 모든 조회 `project_id`, `is_deleted=false`. 근로자 목록은 `is_active=true`. |
| Empty/Loading UI | ✅ | Skeleton 로더, 빈 상태 CTA(유해인자/측정/건강진단 등록), 검색 무결과 메시지 분리 |
| Edge inputs | ✅ | 측정값 숫자 캐스팅, 노출기준 미입력시 판정 보류, 차회 기한 자동 산정 입력 가능 |
| State sync | ✅ | 탭 카운트(전체/초과/기한임박/유소견), 측정값 ≥ 노출기준 → 자동 `is_exceeded=true`, `action_required=true` |
| Audit | ✅ | 모든 INSERT/UPDATE는 `audit_logs` 트리거 대상. 소프트 삭제시 사유 필수. |
| Rollback | ✅ | `useSoftDelete` 표준 — 휴지통 `/admin/trash`에서 마스터 복구 |

## 추가된 Polish (이번 사이클)

- 탭 + 실시간 배지: 전체 / 초과(측정) · 유소견(건강) / 기한 30일 이내
- 인자명·장소·기관/근로자명·기관 검색 필터
- 초기 로딩 Skeleton 3행, 빈 상태 CTA, 검색 무결과 분리 메시지
- 노출기준 초과시 행 강조 + 차회 기한 D-Day 배지
- 소프트 삭제(`useSoftDelete`) 적용 — 휴지통 표준 경로

## 알려진 한계

- 측정 결과 PDF/엑셀 출력은 별도 후속 작업
- 특수건강진단 대상자 자동 산정은 `special_health_targets` 후속 연동 필요
