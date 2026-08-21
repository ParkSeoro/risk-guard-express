# Cursor 실행 프롬프트 — SafeNex 전국 중앙집중 AI CCTV Vision Fleet

## 당신의 역할과 작업 목표

당신은 기존 **SafeNex** 웹·모바일·Supabase 시스템을 확장하는 시니어 풀스택 엔지니어다. 전국의 건설현장 CCTV를 SafeNex에서 **하나의 중앙 관제 경험**으로 운영하도록 Vision Fleet 기능을 구현하라. 본사 안전관리자와 권한 있는 사용자는 SafeNex에서 회사·현장·구역·카메라·AI 위험 이벤트를 통합 조회하고, 권한이 허가된 경우에만 기간 제한된 live/playback/evidence 세션을 사용할 수 있어야 한다.

> 핵심 해석: 중앙집중은 **관제 화면, 권한, 정책, 감사, 선택 영상**의 중앙화다. 모든 현장 원본 영상을 무조건 중앙으로 복제하거나 사용자가 카메라의 RTSP 주소를 직접 받는 구조가 아니다.

현장 NVR는 원본 영상의 Primary 녹화와 증거 보존을 계속 담당한다. 현장 SafeNex Vision Edge Gateway는 AI 안전분석, NVR health, 암호화 event spool, 카메라 접근 제어를 담당한다. SafeNex는 전국 디렉터리·RBAC·AI 이벤트·감사·중앙 통합 관제의 control plane을 담당한다. 중앙 Media Relay/NVR는 허가된 live/playback/evidence만 처리한다.

---

## 1. 작업 경계 — 반드시 준수

| 구분 | 허용 작업 | 절대 금지 |
|---|---|---|
| SafeNex 웹·모바일 | 기존 `src/`, UI 컴포넌트, route, Supabase schema/RLS, server-side endpoint/Edge Function, 테스트 | 기존 인증·회사/프로젝트 접근 SSOT를 우회하는 별도 인증 체계 |
| Gateway 연동 | 문서화된 HTTPS API 계약, Fleet 화면, 상태/event 수신, grant·audit 관리 | `vision-edge/` 코드·Windows 설치 프로그램·NVR·카메라 설정 변경 |
| 영상 | 중앙 relay가 반환한 **권한화된 세션 URL**만 재생 | RTSP/RTSPS URL, NVR IP/비밀번호, local MJPEG loopback URL을 browser/mobile에서 호출·표시·저장 |
| 자격증명 | 서버 전용 secret manager, 승인된 relay/issuer service 호출 | CA private key, mTLS private key, bootstrap raw token, service role key를 client bundle·localStorage·일반 테이블에 저장 |

기존 SafeNex의 AuthGuard, RoleGuard, 회사/프로젝트/현장 권한 체계, Supabase RLS, 디자인 시스템을 먼저 분석하고 그대로 재사용한다. 기존 기능을 삭제·대체·리팩터링 범위 밖으로 변경하지 말라. 새로운 Vision 테이블·route·컴포넌트는 기존 naming convention과 migration 체계를 따른다.

---

## 2. 제품 모델

### 2.1 역할 분리

| 계층 | 역할 | 저장/처리 대상 |
|---|---|---|
| 현장 카메라·NVR | 상시 원본 녹화, 현장 playback, 사고 증거 보존 | 원본 main stream, NVR credential |
| Vision Edge Gateway | PPE·안전고리·위험구역 AI, event spool, camera health, signed grant 검증 | 현장 credential, local event queue |
| SafeNex Vision Fleet | 전국 camera directory, pairing, RBAC, event center, audit, policy, stream grant | metadata, health, event, approval state |
| Central Media Relay / 중앙 NVR | short-lived live relay, playback relay, high-risk evidence, 선택 중앙 녹화 | 승인된 substream/clip/recording만 |
| SafeNex 웹·모바일 | 권한별 관제, 알림, 조치, 승인, 감사 조회 | session URL과 필요한 metadata만 |

### 2.2 평상시와 사건 시의 영상 정책

평상시 SafeNex에는 camera inventory, online/degraded/offline health, AI event metadata, low-size thumbnail, encrypted evidence reference만 동기화한다. 유심·무선·저대역폭 현장은 main stream을 상시 중앙 전송하지 않는다.

사용자가 SafeNex에서 카메라를 열면 서버가 RBAC·현장 정책·WAN profile을 판정하고 짧은 TTL의 stream grant를 만든다. Gateway/Media Relay는 유효한 grant가 있을 때만 저비트레이트 substream 또는 승인된 main stream을 outbound relay한다. `critical` AI event는 event metadata와 정책상 허용된 thumbnail을 즉시 제공하고, clip은 evidence request 또는 retention policy에 의해 비동기 추출한다.

---

## 3. 구현 전 확인 절차

코드를 작성하기 전에 다음을 수행하고, 발견한 실제 파일·테이블·권한 모델을 기준으로 구현하라.

1. 기존 route, AuthGuard/RoleGuard, 사용자·회사·프로젝트·현장 테이블, RLS policy, Supabase client/server 사용 경계, UI component library를 확인한다.
2. 기존 프로젝트/현장 모델이 `company_id`, `project_id`, `site_id` 중 무엇을 SSOT로 사용하는지 확인하고, Vision의 `site_id`는 이를 중복 생성하지 말고 외래키 또는 일관된 mapping으로 연결한다.
3. 기존 알림·감사 로그·파일 저장·지도·모바일 화면 구현이 있다면 새로 만들기보다 확장한다.
4. 중앙 Media Relay와 certificate issuer가 아직 배포되지 않았다면 UI에서 임의의 성공 응답이나 가짜 playable URL을 만들지 않는다. `not_configured`, `relay_unavailable`, `approval_pending` 상태를 사용자에게 명확히 보여 주고, server adapter interface로만 연동 지점을 준비한다.

---

## 4. 필수 데이터 모델과 RLS

아래 명칭은 기존 naming convention에 맞게 조정할 수 있으나, 보안 의미와 필드는 유지한다. 모든 migration에는 적절한 index, created_at/updated_at, foreign key, soft revoke 또는 append-only audit 방식을 포함한다.

| 엔터티 | 필수 핵심 필드 | 보안 규칙 |
|---|---|---|
| `vision_gateways` | `id`, 회사/현장 FK, `display_name`, `device_fingerprint`, `connection_state`, `last_seen_at`, `software_version`, `wan_profile`, `policy_group` | 회사·현장 scope RLS; raw cert/token 금지 |
| `vision_camera_metadata` | `id`, `gateway_id`, `camera_external_id`, `display_name`, `zone_id`, `ai_profile`, `enabled`, `health_state`, `media_policy` | RTSP URL·NVR IP/password 금지 |
| `vision_gateway_health` | `gateway_id`, `reported_at`, `camera_count`, `online_count`, `spool_depth`, `disk_free_bytes`, `wan_profile` | Gateway service identity만 write |
| `vision_safety_events` | `id`, `gateway_id`, `camera_id`, `severity`, `event_type`, `occurred_at`, `requires_human_review`, `status`, `assignee_id`, thumbnail/evidence reference | 현장 scope RLS; AI 결과는 human review 전 확정 위반 아님 |
| `vision_role_bindings` | `subject_id`, `role`, 회사/현장/구역/camera scope, `valid_from`, `valid_to`, `revoked_at` | Platform Admin 또는 기존 권한 SSOT가 관리 |
| `vision_stream_grants` | `id`, `subject_id`, `camera_id`, `action`, `expires_at`, `max_bitrate_kbps`, `watermark`, `relay_session_id`, `state` | raw stream URL/reusable token 금지; request owner + authorized operator만 조회 |
| `vision_evidence_requests` | `event_id`, `camera_id`, `requested_by`, `reason`, `retention_class`, `state`, `object_reference`, `hash` | export는 별도 승인·감사 |
| `vision_device_authorizations` | `id`, `user_code_hash`, `session_hash`, `csr_fingerprint`, `expires_at`, approval/rejection fields | QR/session raw value 금지 |
| `vision_provisioning_kits` | `id`, 회사/현장 FK, `token_hash`, `expires_at`, `max_claims`, `claimed_count`, `revoked_at`, `policy_group` | bootstrap raw token 금지 |
| `vision_audit_ledger` | `actor_id`, `effective_role`, `action`, `scope`, `request_id`, `grant_id`, `outcome`, `reason`, `occurred_at` | append-only; UI update/delete 금지 |

### 4.1 RLS 및 접근 범위

RLS는 반드시 기존 회사/현장 멤버십 SSOT를 이용한다. 권한 판정은 다음 교집합을 적용한다.

```text
tenant/company → site/project → zone → camera → action → validity time window
```

사용자는 권한 밖 gateway/camera/event를 **목록에서도 식별할 수 없어야** 하며, UUID를 추측한 직접 요청도 차단되어야 한다. 모든 write endpoint는 server-side에서 actor scope를 재검증한다. `Gateway Service Identity`는 자기 `gateway_id`의 heartbeat/event/approved relay 상태만 write할 수 있고, 사람용 RLS 권한을 갖지 않는다.

---

## 5. 역할과 action 매트릭스

| 역할 | 기본 scope | 허용 action | 제한 |
|---|---|---|---|
| Platform Super Admin | tenant 전체 | gateway/site/role/policy 관리, 전국 audit 조회 | RTSP·NVR credential·Gateway private key 조회 불가 |
| Central Safety Controller | 할당 company/site | 멀티뷰, AI event acknowledge, `live_substream`, 승인된 playback | camera/NVR 설정과 원본 삭제 금지 |
| Site Safety Manager | 자기 site/zone | site live/playback, evidence request, 현장 조치 기록 | 타 현장·Fleet rollout 변경 금지 |
| Subcontractor Supervisor | 위임 zone/camera/time | 작업 시간의 `live_substream`, 자기 팀 event 확인 | playback export, 타 구역 접근 금지 |
| Auditor / Client Viewer | assigned read-only scope | watermark live/playback, audit evidence 조회 | PTZ/download/export 금지 |
| Gateway Service Identity | 자기 gateway | heartbeat, event batch, signed grant 실행 결과 | human UI login 및 타 gateway 접근 금지 |

`live_substream`, `live_mainstream`, `playback`, `evidence.request`, `evidence.export`, `ptz.control`, `policy.rollout`, `break_glass`는 서로 다른 action으로 모델링한다. 고해상도 영상, evidence export, PTZ, break-glass에는 더 강한 role·사유·승인이 필요하다.

---

## 6. SafeNex 화면 구현

### 6.1 Vision Fleet Overview

기존 admin/dashboard 안에 `Vision Fleet` 진입점을 추가한다. 플랫폼 권한은 전국 요약을, 회사·현장 권한은 허용 범위만 볼 수 있어야 한다. 화면에는 다음이 필요하다.

| 영역 | 내용 |
|---|---|
| Fleet health summary | online, degraded, offline, approval pending, unclaimed gateway 수; P1/P2 AI event; event spool backlog |
| Filter | 회사, 현장, 구역, gateway 상태, WAN profile, AI severity, policy group, software version |
| 전국 목록/지도 | 기존 지도 컴포넌트가 있으면 재사용; 없으면 현장 목록 우선. 범위 밖 현장은 표시 금지 |
| 운영 알림 | offline threshold, heartbeat stale, critical AI event, update rollout failure, evidence job failure |
| drill-down | gateway detail, camera detail, event center, audit로 이동 |

### 6.2 Central Live Wall

`Central Live Wall`은 raw URL을 받는 화면이 아니다. 사용자에게 허용된 camera card만 렌더링하고, 사용자가 카드를 열 때 `stream-grant`를 요청한다. 기본은 `live_substream`이며, high-cost/metered site는 정책상 허가 전 `mainstream` 버튼을 비활성화한다.

카드에는 camera name, site/zone, health, AI profile, connection quality, user/time watermark, grant 만료 countdown, 종료 버튼을 표시한다. grant가 만료·취소·role revoke되면 video element/relay session을 즉시 종료하고 재요청 안내를 보여 준다. Media Relay가 미배포인 경우에는 정직하게 `중앙 영상 relay 준비 중` 상태를 표시한다. 테스트를 위해 임의의 fake CCTV video를 실제 관제 화면에 넣지 않는다.

### 6.3 Gateway 추가 Wizard

신규 현장 연결의 첫 화면은 **QR 현장 승인**과 **Provisioning Kit 일괄 배포**다. 수동 pairing code는 `고급/복구`로 숨긴다.

| 흐름 | SafeNex 화면 | 중앙 책임 |
|---|---|---|
| QR 승인 | mobile/웹에서 QR deep link 열기, Console user code 대조, 회사·현장 선택, 승인/거절 | device authorization 상태 관리, CSR 검증, enrollment 발급 |
| Provisioning Kit | 회사·현장·표시명 prefix·설치 수·정책 그룹·만료 선택, kit 파일 발급·폐기·audit | one-time kit hash, max claims, revoke, claim transaction |
| 수동 fallback | 만료되는 pairing code 생성·취소 | recovery path, rate limit, audit |

중앙은 현장 LAN에 inbound 연결하거나 ONVIF discovery를 하면 안 된다. Gateway가 현장 LAN에서 ONVIF 후보를 찾고, SafeNex에는 discovery 결과 중 안전한 metadata만 동기화한다.

### 6.4 Gateway Detail

탭은 `개요`, `카메라`, `AI 이벤트`, `권한화 영상`, `정책·업데이트`, `감사`로 구성한다. 카메라 화면에는 표시명·AI profile·health·scope만 보여 주며 NVR credential이나 URL은 절대 보이지 않는다. 정책 rollout은 `dry-run → site canary → policy group → fleet` 순서를 시각화한다.

### 6.5 Event Center와 Evidence

AI event는 severity, camera, site/zone, timestamp, AI detection, human review requirement, assignee, acknowledgement, action log를 중심으로 보여 준다. `critical` event는 상단 고정 알림과 모바일 push 대상이 될 수 있지만, AI 감지만으로 자동 징계·출입 차단·법적 판단을 확정하지 않는다.

Evidence 요청은 reason 또는 event ID를 필수로 하고 비동기 job 상태를 보여 준다. export는 dual approval과 immutable audit가 없는 한 비활성화한다. legal hold가 있으면 retention delete flow는 보류해야 한다.

### 6.6 모바일

390px 폭 기준으로 QR 승인, 승인 대기 상태, P1/P2 event 확인·담당자 배정·조치 완료, 권한 범위의 `live_substream`을 제공한다. 모바일에는 NVR 설정, credential, local Gateway URL, CA/certificate 관리 UI를 제공하지 않는다.

---

## 7. 중앙 API 계약

### 7.1 Gateway Onboarding API

Gateway는 browser session 없이 outbound HTTPS로 아래 API를 호출한다. 무거운 certificate issuance와 CA private key 접근은 browser·Supabase client에서 수행하면 안 된다. 승인된 server-only issuer 서비스 또는 secret manager를 통해 구현하고, 아직 issuer가 없으면 UI만 success로 위장하지 말고 `issuer_not_configured`로 처리한다.

| 목적 | API |
|---|---|
| QR authorization 생성 | `POST /vision-fleet/v1/gateway-device-authorizations` |
| QR poll | `POST /vision-fleet/v1/gateway-device-authorizations/{authorization_id}/poll` |
| Provisioning kit 발급 | `POST /vision-fleet/v1/provisioning-kits` |
| Kit claim | `POST /vision-fleet/v1/gateway-bootstrap/claim` |
| Manual pairing fallback | `POST /vision-fleet/v1/gateway-pairings/claim` |
| Heartbeat | `POST /vision-fleet/v1/gateways/{gateway_id}/heartbeats` |
| Event batch | `POST /vision-fleet/v1/gateways/{gateway_id}/events:batch` |
| Desired state | `GET /vision-fleet/v1/gateways/{gateway_id}/desired-state` |
| Command acknowledgment | `POST /vision-fleet/v1/gateways/{gateway_id}/commands/{command_id}/ack` |

Enrollment 성공 응답은 다음의 의미를 유지한다. 인증서 전문과 CA bundle은 Gateway가 encrypted local store에 저장하는 대상이며 browser에 절대 반환하지 않는다.

```json
{
  "gateway_id": "gw_01J...",
  "tenant_id": "company_uuid",
  "site_id": "project_uuid",
  "token_url": "https://api.example.com/vision-fleet/oauth/token",
  "client_id": "gw_01J...",
  "client_certificate_pem": "SERVER-TO-GATEWAY ONLY",
  "ca_bundle_pem": "SERVER-TO-GATEWAY ONLY",
  "master_public_key_pem": "SERVER-TO-GATEWAY ONLY"
}
```

### 7.2 Stream Grant API

| 목적 | API | 규칙 |
|---|---|---|
| camera directory | `GET /vision-fleet/v1/cameras?site_id=&zone_id=` | RLS 후 허용 metadata만 반환 |
| live grant | `POST /vision-fleet/v1/cameras/{camera_id}/stream-grants` | RBAC·WAN·action 검증, short TTL, audit |
| grant 종료 | `POST /vision-fleet/v1/stream-grants/{grant_id}/close` | subject 또는 authorized operator만, audit |
| playback grant | `POST /vision-fleet/v1/cameras/{camera_id}/playback-grants` | retention/reason/RLS 검증 |
| evidence 요청 | `POST /vision-fleet/v1/events/{event_id}/evidence-requests` | reason 필수, async job·audit |
| break-glass | `POST /vision-fleet/v1/break-glass-grants` | incident ref + 사유 + 강화 인증 + 15분 TTL |

서버는 grant를 one-camera, one-subject, one-action, one-relay-session으로 발급한다. 기본 TTL은 5분이며 `subject_id`, tenant/site/camera scope, action, expiry, max bitrate, watermark, relay session ID를 포함한다. Gateway/relay가 Ed25519 서명을 fail-closed로 검증할 수 있도록 canonical signed payload를 사용한다.

```json
{
  "grant_id": "uuid",
  "tenant_id": "company_uuid",
  "site_id": "project_uuid",
  "camera_id": "gate-north-01",
  "action": "live_substream",
  "subject_id": "user_uuid",
  "expires_at": "2026-08-20T03:15:00Z",
  "max_bitrate_kbps": 700,
  "relay_url": "https://relay.example.com/sessions/opaque",
  "watermark": "company · user · timestamp",
  "signature": "ed25519"
}
```

---

## 8. 보안·감사·비상 접근

모든 live start/stop, playback, seek, PTZ command, grant issue/deny/revoke, evidence request/export, QR approve/deny, kit issue/claim/revoke, role grant/revoke, policy rollout, break-glass를 `vision_audit_ledger`에 append-only로 기록한다. record에는 actor, effective role, tenant/site/zone/camera scope, action, reason, request ID, grant ID, device/IP, timestamp, outcome을 남긴다.

`break_glass`는 인명 위험·중대재해·재난에 한정한다. 사유와 incident reference, 강화 인증 또는 이중 승인을 요구하고 15분 내 자동 만료한다. 사용 뒤 보안책임자와 현장책임자에게 통지한다. 이 권한도 NVR firmware 변경, 녹화 삭제, credential 열람을 허용하지 않는다.

다음은 security analytics에서 high severity로 탐지해야 한다: 짧은 시간의 다수 현장 enumeration, 만료/타인 grant replay, scope 밖 stream request, 장시간 high bitrate 셀룰러 사용, 대량 evidence export, 반복 break-glass, pairing/kit brute-force.

---

## 9. 명시적 금지 사항

1. 기존 SafeNex 웹 코드의 인증·권한·회사/프로젝트 SSOT를 우회하지 말 것.
2. `vision-edge/`, NVR, 카메라, RTSP URL, 현장 PC 파일을 변경하지 말 것.
3. 중앙 서버가 현장 LAN/NVR/Gateway로 inbound 연결, port-forward, UDP ONVIF discovery를 시도하지 말 것.
4. raw RTSP/RTSPS URL, NVR password, local MJPEG URL, VPN 주소, Gateway private key, mTLS private key, CA private key, raw bootstrap/pairing token을 frontend·mobile·localStorage·일반 DB/log에 넣지 말 것.
5. central relay가 없을 때 fake playable CCTV video, fake success pairing, 임의의 certificate를 만들지 말 것.
6. AI event만으로 사람에 대한 처벌·차단·법적 결정을 자동 확정하지 말 것.
7. 중앙 집중을 이유로 현장 NVR의 원본 녹화·현장 AI·단절 복구를 제거하지 말 것.

---

## 10. 구현 순서

| Phase | 구현 범위 | 완료 조건 |
|---|---|---|
| 1 | Vision schema, RLS, role binding, audit ledger | scope 밖 camera/gateway/event을 enumeration할 수 없음 |
| 2 | Fleet overview, gateway/camera detail, event center | 기존 권한 모델에 맞는 전국/현장별 drill-down |
| 3 | QR/Kit onboarding UI와 server-side state/audit | raw token/cert 노출 없이 승인·폐기·상태 확인 |
| 4 | Stream grant, relay adapter, Central Live Wall | raw URL 미노출, 5분 TTL/close/revoke audit |
| 5 | evidence request, retention/hold, mobile event response | export/review rule와 async job 상태 반영 |
| 6 | policy/update rollout UI, canary, security/load/DR tests | canary→fleet 순서, offline/role revoke/relay outage 테스트 |

각 phase를 완료한 뒤 type check, lint, unit/integration test를 실행한다. schema migration과 RLS test를 반드시 포함한다. 신규 endpoint에는 authorization negative test, expired/revoked grant test, cross-company/cross-site access test, audit write test를 추가한다.

---

## 11. 최종 수용 기준

1. 플랫폼 관리자는 전국 Fleet 상태·AI 이벤트를 보되, 회사/현장 관리자는 자기 scope만 본다.
2. 권한 밖 camera/gateway/event은 UI와 API 모두에서 보이지 않는다.
3. QR 및 Provisioning Kit은 현장 Gateway 등록을 지원하되 raw code/token/certificate를 browser에 노출하지 않는다.
4. SafeNex는 허가된 사용자의 on-demand video session만 만들고 raw RTSP/NVR credential을 절대 노출하지 않는다.
5. grant 만료·revoke·close 시 relay session이 종료되고 audit record가 남는다.
6. 유심/저대역폭 현장은 평상시 event-first로 동작하고, 고해상도 영상은 명시적 권한과 정책에서만 허용된다.
7. 현장 WAN·중앙 relay·SafeNex 중 하나가 장애여도 현장 NVR 원본 녹화와 Vision Edge AI·event spool은 계속 동작한다.
8. evidence export와 break-glass에는 사유·승인·만료·immutable audit 규칙이 적용된다.
9. 기존 SafeNex 기능, auth, RLS, UI 디자인 시스템이 회귀하지 않는다.

## 참고 설계 문서

- `docs/ARCHITECTURE_CENTRALIZED_VISION_FLEET.md`
- `docs/POLICY_CENTRAL_VISION_RBAC_AND_EVIDENCE.md`
- `docs/ARCHITECTURE_VISION_EDGE_ZERO_TOUCH_FLEET.md`
- `docs/ARCHITECTURE_VISION_EDGE_SECURE_UPDATES.md`
- `docs/diagrams/safenex_centralized_vision_federation.mmd`
