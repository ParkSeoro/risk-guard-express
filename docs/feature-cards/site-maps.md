# Feature Card #17 — 현장 사이트맵 / 구역 (`site_maps` + `site_zones` + `zone_qr_codes`)

## 1. Happy Path
- PC 「통합 현장 관제맵」에서 평면도/드론 사진 업로드 → **모바일 워킹 보정**으로 지오레프 → 구역(폴리곤) 그리기 → QR 발급.
- 위성 TL/TR/BL 수동 정렬은 **선택(고급)** — 필수가 아님.
- 근로자 GPS/지오펜스는 워킹 보정(또는 고급 위성 정렬) 이후 활성.

## 2. Permission
- 사이트맵·구역 작성/수정/삭제: `master`, `project_admin`, `safety_manager` (storage RLS는 `project_id/*` 경로로 격리).
- 조회: 같은 프로젝트 멤버 전체.
- QR 코드 활성/비활성: 위 3개 역할.

## 3. Scope
- 모든 쿼리는 `project_id` 로 스코프되고 `is_deleted=false` 필터를 적용한다.
- 사이트맵 이미지 경로는 반드시 `${projectId}/site-maps/...` 로 시작 (storage RLS 매칭).

## 4. Empty / Loading UI
- `loading` 중에는 Skeleton(헤더·이미지·구역 영역).
- 사이트맵 없음 → "사이트맵을 업로드해 시작하세요" 안내.
- 구역 없음 / 필터 결과 없음 분리 메시지.

## 5. Edge Inputs
- 폴리곤 점 < 3 → 저장 차단(toast).
- 좌표 4개 중 일부만 입력 → 저장 차단.
- Wi-Fi 지문 JSON 파싱 실패 → toast 로 명확히 안내.

## 6. State Sync
- 구역 추가/삭제/QR 변경 후 `loadZones()` 재호출로 우측 패널·SVG 오버레이 동기화.
- 사이트맵 추가 시 `setActiveMap` 후 `loadMaps()` 로 탭 갱신.

## 7. Audit
- 구역 삭제는 `useSoftDelete('site_zones', ...)` 를 통해 `audit_logs` 에 사유와 함께 기록.
- 사이트맵 자체도 `site_maps` 가 SSOT 화이트리스트에 포함되어 있어 동일 흐름으로 삭제 가능.

## 8. Rollback
- 소프트 삭제이므로 `/admin/trash` 에서 마스터가 복구 가능 (`is_deleted=false`).
- QR 코드는 활성/비활성 토글로 즉시 무효화 가능.

## 검색·필터
- 우측 패널: 이름·설명 검색 + 전체/위험/제한/작업/일반 카운트 배지 필터.
