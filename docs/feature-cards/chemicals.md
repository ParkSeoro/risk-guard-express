# 화학물질 / MSDS · 사용계획 (Chemicals) — Feature Card #12

법적 근거: 산업안전보건법 제114조(MSDS 게시·교육), 화학물질관리법 시행규칙 제19조(연간 취급계획서)

## 8-Dimension Checklist

| Dim | Status | Note |
|---|---|---|
| Happy path | ✅ | 화학물질 등록(MSDS 업로드 포함) → 월/연간 사용계획 등록 → 발암·생식독성 표시 → 보관위치·최대보관량 관리 |
| Permission | ✅ | RLS + `applyCompanyFilter`. 시공사는 자기 회사 물질·사용계획만, 마스터/PA/안전관리자는 전사 조회·등록 가능 |
| Scope | ✅ | `project_id` + `company_id` + `is_deleted=false` 필터. 회사 미지정 물질은 owner-side 만 등록 가능 |
| Empty/Loading UI | ✅ | 로딩 텍스트, 빈 상태 안내 ("등록된 화학물질이 없습니다"), 사용계획 빈 안내 |
| Edge inputs | ✅ | 월/연간 유형 분기, 숫자 캐스팅(`Number(planned_qty)`), MSDS 파일 타입(application/pdf, image/*) 검증 |
| State sync | ✅ | 탭 전환(물질/사용계획) 후 즉시 재로딩, 발암성·생식독성 뱃지 즉시 반영 |
| Audit | ✅ | INSERT/UPDATE는 audit_logs 트리거 대상. MSDS 파일 업로드는 Storage 경로 `<projectId>/chemicals/`로 격리 |
| Rollback | ✅ | 소프트 삭제 컬럼(`is_deleted`) — 휴지통 `/admin/trash`에서 마스터 복구 |

## 알려진 한계

- MSDS 자동 갱신 알림(2년 주기) 후속 작업
- 사용량 누계 / 최대보관량 초과 경고 배지는 후속 폴리시 작업
- 특수건강진단 대상 물질 자동 매핑(`special_health_targets`) 연동 필요
