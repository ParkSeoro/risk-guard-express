# Feature Card: 안전보건교육 이수관리 (Worker Education)

법적근거: 산안법 §29 (정기/채용시/작업변경시/특별/관리감독자/기초안전보건)

| 차원 | 상태 | 비고 |
|---|---|---|
| Happy path | ✅ | 등록/수정/소프트삭제, 차기 예정일 자동 계산 |
| Permission | ✅ | Master/PM/안전관리자는 전사, 일반 사용자는 자사 데이터만 조회 |
| Scope | ✅ | `project_id` + 회사 스코프 |
| Empty/Loading | ✅ | Skeleton + 0건 CTA + 검색결과 0건 안내 |
| Edge inputs | ✅ | 과정명/근로자 미입력 차단, hours 0.5단위 |
| State sync | ✅ | 저장 후 list refetch |
| Audit | ✅ | useSoftDelete → audit_logs 자동 기록 |
| Rollback | ✅ | `/admin/trash` 에서 복원 (worker_education_records SSOT 등록) |

### UX
- 유형별 탭 + 카운트 뱃지
- 근로자/과정/강사 검색
- 차기 예정일 만료 시 destructive 뱃지
