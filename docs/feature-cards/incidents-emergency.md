# Feature Card: 사고 관리 & 비상대피훈련 (Incidents & Emergency Drills)

법적근거: 산안법 §52 (비상조치계획·훈련), §57 (중대재해 24시간 보고)

## Incidents
| 차원 | 상태 | 비고 |
|---|---|---|
| Happy path | ✅ | 보고/노동청 보고 기록/카운트다운 |
| Permission | ✅ | RLS 프로젝트 스코프 |
| Scope | ✅ | `project_id` |
| Empty/Loading | ✅ | Skeleton + "사고 보고" CTA |
| Edge inputs | ✅ | 필수 항목 검증, 중대재해 자동 분류 (severity=high or type=major) |
| State sync | ✅ | 저장 후 refetch |
| Audit | ✅ | DB trigger로 24h 시한 자동 계산 |
| Rollback | ✅ | `incident_reports` 휴지통 지원 |

UX: 상태 탭(전체/중대/시한초과/보고완료) + 검색(신고자·위치·내용).

## Emergency Drills
| 차원 | 상태 | 비고 |
|---|---|---|
| Happy path | ✅ | 등록/수정/소프트삭제 |
| Permission | ✅ | RLS 프로젝트 스코프 |
| Scope | ✅ | `project_id` |
| Empty/Loading | ✅ | Skeleton + 첫 훈련 CTA, 법정주기 안내 |
| Edge inputs | ✅ | 훈련명 필수 |
| State sync | ✅ | 저장 후 refetch |
| Audit | ✅ | useSoftDelete → audit_logs |
| Rollback | ✅ | `emergency_drills` SSOT 추가, `/admin/trash` 복원 |
