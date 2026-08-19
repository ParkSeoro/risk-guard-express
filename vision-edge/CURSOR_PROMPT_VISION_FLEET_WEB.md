# Cursor 실행 프롬프트 — SafeNex Vision Fleet 웹·모바일 관제

아래 내용을 Cursor에 그대로 전달하십시오. 이 프롬프트의 범위는 **SafeNex 웹·모바일 UI와 Supabase/Fleet Master 측 연동**이며, 현장 NVR 프로그램인 `vision-edge/`는 수정하지 않는다.

---

당신은 SafeNex 안전관리 플랫폼의 수석 프론트엔드·백엔드 통합 엔지니어다. 기존 저장소의 웹 구조와 인증·회사·프로젝트 범위 권한을 존중하면서, 전국 현장의 AI CCTV Gateway를 운영하는 **Vision Fleet** 기능을 구현하라.

## 0. 절대 원칙

기존 SafeNex 웹 앱은 Vite + React + TypeScript + shadcn-ui + Tailwind이며, 원격 Supabase를 백엔드로 사용한다. 기존 `AGENTS.md`의 지침을 반드시 준수하고, 패키지 관리는 Bun만 사용한다. 웹은 현장 NVR이나 RTSP에 직접 연결해서는 안 된다. Gateway는 외부로 Master에 연결하며, 웹은 Master가 권한을 확인해 제공하는 상태·이벤트·정책·감사·짧은 영상 접근 권한만 사용한다.

NVR 관리자 암호, RTSP URL, Gateway private key, 장기 영상 URL, NVR 공장 초기화·원본 삭제·공개 포트 개방·안전 인터록 해제 기능을 웹에 구현하지 않는다. 브라우저가 Gateway 또는 NVR의 사설 IP에 직접 요청하는 코드는 금지한다.

기능을 기존 `master`, `admin`, `site manager`, `safety manager` 권한 모델과 결합하되, 세부 권한은 backend RLS와 Edge Function에서 다시 검증한다. UI 가드는 보안 통제가 아니다.

## 1. 제품 목표

새 기능의 제품명은 **SafeNex Vision Fleet**이다. 목적은 ‘전국 NVR 원격 제어’가 아니라 다음 네 가지다.

1. 전국 Gateway·NVR·카메라·AI runtime 상태를 회사·프로젝트·현장 범위에서 관찰한다.
2. AI 안전 이벤트를 확인·분류·조치·감사하고, 오탐·누락 품질을 개선한다.
3. 검증된 AI 정책과 Gateway/모델 release를 Canary → Pilot → Regional → Nationwide 순으로 안전하게 배포한다.
4. 권한·사유·시간이 묶인 짧은 영상 접근만 제공하고 모든 열람을 감사한다.

## 2. 정보 구조와 라우트

기존 관리자 앱 내에 `Vision Fleet` 최상위 메뉴를 추가한다. 모바일에서도 하단 또는 적합한 안전 운영 메뉴로 접근 가능해야 하며, 작은 화면에서는 이벤트 큐와 단일 카메라 상세가 우선이다.

| Route | 화면 | 최소 권한 |
|---|---|---|
| `/admin/vision-fleet` | Fleet Overview | `master`, 권한 있는 관리자 |
| `/admin/vision-fleet/events` | Safety Event Command | master, site safety manager |
| `/admin/vision-fleet/gateways` | Gateway registry·health | master, delegated operator |
| `/admin/vision-fleet/policies` | AI policy registry·승인·배포 | master, security operations |
| `/admin/vision-fleet/deployments` | Canary/Pilot rollout | master, approver |
| `/admin/vision-fleet/audit` | 영상·명령·승인 감사 | master, auditor |
| `/admin/vision-fleet/cameras/:cameraId` | 카메라 상세·권한화된 라이브 요청 | 현장 범위 역할 |

기존 `AuthGuard`, `RoleGuard`, 회사·프로젝트 scope helper를 재사용한다. 역할명과 실제 DB claim은 저장소의 현재 schema를 확인해 맞춘다. 새로운 전역 role을 클라이언트에 하드코딩하지 않는다.

## 3. Supabase 데이터 모델과 RLS

기존 migration 스타일에 맞는 새 migration을 추가한다. 모든 테이블은 `tenant_id`, `company_id` 또는 프로젝트의 소속 체인을 통해 기존 회사·프로젝트 scope와 연결한다. `service_role`을 브라우저에 노출하지 않는다.

### 3.1 권장 테이블

| Table | 주요 field | 용도 |
|---|---|---|
| `vision_gateways` | id, tenant/company/project/site, display_name, status, device_fingerprint, capabilities, last_heartbeat_at, applied_policy_version, applied_model_version | Gateway registry와 health |
| `vision_nvrs` | id, gateway_id, display_name, vendor, read_only, health_state | NVR 메타데이터. credential·host·RTSP는 저장 금지 또는 별도 Gateway-local only |
| `vision_cameras` | id, gateway_id, nvr_id, display_name, zone, health_state, last_frame_at, stream_profile_id | 카메라 메타데이터·상태 |
| `vision_safety_events` | id, gateway/site/project, camera_id, event_type, severity, confidence, policy_version, model_version, requires_human_review, occurred_at, status | AI·장비 이벤트 |
| `vision_event_reviews` | id, event_id, reviewer_id, disposition, note, corrective_action, reviewed_at | 오탐·확인·조치 이력 |
| `vision_policy_bundles` | id, version, digest, rollout_stage, config_json, status, created_by, approved_by | 버전형 AI policy |
| `vision_deployments` | id, policy/model/release, target selector, stage, status, health_gate_result, rollback_of | 단계 배포 |
| `vision_commands` | id, target_gateway_id, risk_level, type, reason, expires_at, approval refs, status | 중앙 명령 ledger |
| `vision_command_acks` | id, command_id, gateway_id, status, detail, error_code, occurred_at | Gateway ACK |
| `vision_video_access_audit` | id, user_id, camera_id, site/project, reason, session_started_at, session_ended_at, result | 영상 열람 감사 |
| `vision_audit_log` | id, actor, action, resource_type/id, company/project/site, request_id, before/after hashes, occurred_at | 불변 운영 감사 |

### 3.2 RLS 원칙

- 사용자는 자신의 `company_id`·프로젝트·현장 범위에 속하는 행만 조회할 수 있어야 한다.
- `master`는 권한이 부여된 범위에서 gateway·event·policy·audit을 조회할 수 있으나, NVR credential이나 원본 영상 저장 URL은 읽을 수 없다.
- 정책 변경·배포 생성·red command 승인·break-glass는 일반 관리자와 분리한다.
- Gateway ingest API는 browser session JWT가 아닌 mTLS/OAuth device identity를 검증하는 Edge Function 또는 별도 Master service가 담당한다. RLS는 사용자 데이터 조회에 사용하고, Gateway device identity 검증은 backend에서 별도 수행한다.
- RLS 정책은 `auth.uid()`만으로 회사 구분을 추정하지 말고, 기존 `user_profiles`/회사 scope function을 재사용한다.

## 4. Fleet Overview UX

**전국 영상을 기본으로 띄우지 않는다.** 첫 화면은 운영 건강도와 안전 이벤트다.

상단에는 선택 가능한 회사·프로젝트·현장 필터와 시간 범위를 제공한다. 그 아래에는 Gateway online/degraded/offline, NVR 연결 상태, 카메라 정상률, 미확인 high/critical 이벤트, 배포 중인 정책 수를 KPI로 보여준다. 각 KPI는 클릭 시 해당 필터가 적용된 상세 화면으로 이동한다.

주 화면은 현장·Gateway 리스트와 상태 중심이어야 한다. 행에는 현장명, Gateway 상태, 마지막 heartbeat, 카메라 online/total, event spool warning, 적용 policy/model version, deployment 상태를 보여 준다. `degraded`, `offline`, certificate expiry, spool backlog는 명확한 운영 경고로 보이되, 빨간색만 남발하지 않는다.

## 5. Safety Event Command UX

이벤트 화면은 모바일에서도 우선 동작해야 한다. severity, event type, 회사·프로젝트·현장, 카메라, rule outcome, human review 필요 여부, 시간으로 필터링한다.

이벤트 상세에는 AI confidence만 표시하지 말고 policy version, model version, camera·zone, 발생 시간, rule outcome, 같은 track의 반복 여부, evidence availability, 조치 이력을 보여 준다. 검토자는 `확인됨`, `오탐`, `추가 확인`, `조치 완료` 같은 disposition과 사유·시정조치를 기록할 수 있어야 한다. 안전고리/하네스 관련 이벤트는 UI에서 **“AI 보조 신호 — 현장 확인 필요”**로 표기하고, 자동 처벌 판정처럼 보이게 하지 않는다.

## 6. 정책·배포 UX

정책은 JSON 편집기 하나가 아니라 버전·요약·차이·승인·대상 범위가 보이는 운영 도구여야 한다. 한 번 승인된 bundle은 불변으로 취급하고, 수정은 새 version을 만든다.

배포는 다음 단계만 허용한다.

| Stage | 대상 | 통과 조건 |
|---|---|---|
| Canary | 내부 테스트 또는 단일 Gateway | 기능·보안·health check 통과 |
| Pilot | 조명·작업이 다른 소수 현장 | 탐지율·오탐·지연·GPU 안정성 검토 |
| Regional | 동일 현장군 | rate limit·자동 중단·운영 SLO 통과 |
| Nationwide | 승인된 표준 현장 | 서명 release·rollback·지원 runbook 준비 |

배포 생성 화면은 대상 Gateway preview, 영향 수, 현재 버전, 목표 버전, rollout stage, risk, rollback plan, 승인자, 사유를 반드시 보여 준다. `Nationwide`와 `model.activate` 등 red command는 2인 승인과 만료 시간을 요구한다. UI에서 삭제나 강제 활성화가 기본 버튼으로 노출되지 않도록 한다.

## 7. 영상 접근 UX

카메라 상세에서 사용자가 라이브 재생을 요청하면, 먼저 목적·사유·시간 범위를 입력받고 backend로 video access request를 보낸다. backend가 역할·회사·프로젝트·현장·카메라·시간 조건을 검증해 짧은 one-time playback ticket 또는 relay URL을 반환할 때만 player를 열어야 한다.

RTSP URL, NVR credential, 영구 HLS URL을 프론트엔드 상태·로그·URL query에 저장하지 않는다. 재생 종료·실패·사용자·카메라·사유를 `vision_video_access_audit`에 기록한다. 모바일에서는 한 번에 한 스트림만 재생하고, 이벤트와 카메라 정보가 항상 함께 보이도록 한다.

## 8. API client와 상태 관리

`src/lib/visionFleetApi.ts`와 typed Zod 또는 TypeScript schema를 만들고, network 요청·오류·empty state·realtime 구독을 한곳에서 관리한다. Supabase Realtime은 사용자가 RLS로 접근 가능한 event·gateway 상태의 UI 갱신에만 사용한다. Gateway command·certificate·mTLS 처리 로직을 브라우저에 넣지 않는다.

모든 mutation에는 optimistic update를 무조건 적용하지 말고, policy·command·approval처럼 안전 영향이 있는 작업은 server-confirmed state만 반영한다. 각 오류는 `request_id`가 있으면 표시하고, 권한 없음·범위 불일치·만료 명령·health gate 실패를 사용자가 이해할 수 있는 한국어로 설명한다.

## 9. 디자인 기준

기존 SafeNex 디자인 시스템을 존중하되 Vision Fleet은 전문 관제 제품처럼 보여야 한다. dark mode-only로 만들지 말고 기존 앱 theme와 일관되게 통합한다. 상태를 색상 하나로만 전달하지 말고 텍스트·아이콘·시간·정렬을 함께 사용한다. 큰 화면에서는 데이터 밀도를 확보하되 카드 남발을 피하고, 모바일에서는 KPI → 미확인 이벤트 → 단일 현장 상태 순으로 정보 계층을 재배치한다.

## 10. 테스트와 완료 조건

다음 테스트를 구현하고 실행하라.

1. 회사·프로젝트·현장 범위를 벗어난 gateway/event/camera를 조회할 수 없는 RLS 테스트.
2. 권한 없는 사용자가 policy deployment, red command, video access request를 생성·승인할 수 없는 테스트.
3. `degraded/offline` Gateway, empty event queue, Fleet API error, expired video ticket, rollback 상태의 UI 테스트.
4. 모바일 viewport에서 event queue, camera detail, video permission dialog가 작동하는 Playwright 또는 기존 프론트엔드 테스트.
5. typecheck, Bun test, production build를 모두 통과시킨다. 기존 lint 오류와 새 변경의 오류를 구분해 보고한다.

## 11. 산출물

구현 완료 시 다음을 제공한다.

- migration SQL 및 RLS 정책
- React route·페이지·컴포넌트·typed API client
- 관리자 메뉴·mobile navigation 연동
- event·policy·deployment·audit UI
- 영상 접근 request UI와 감사 로직
- 테스트 결과와 남은 backend 전제 사항
- 기존 `vision-edge/`의 Gateway API 규격과 맞지 않는 부분이 있으면 코드 변경 전 명확한 비교표

웹을 완성하더라도 현장 Gateway, NVR 또는 RTSP에 대한 직접 접속을 추가하지 말라. Master backend의 API는 `reports/SafeNex_Vision_Fleet_NVR_Gateway_보안통신_API_연동규격서_초안_v0.1.md`의 Gateway 계약을 따른다.
