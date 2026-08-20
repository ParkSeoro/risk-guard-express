# Cursor 실행 프롬프트 — SafeNex Vision Fleet 전국 확장

> **작업 경계:** 이 문서를 Cursor에 그대로 전달하여 SafeNex의 웹·모바일·Supabase 영역만 구현한다. `vision-edge/` Gateway 코드, 현장 PC 파일, NVR, RTSP 연결 방식을 변경하지 않는다. 웹·모바일은 원본 영상, RTSP 주소, NVR 비밀번호, Gateway private key에 접속하거나 저장할 수 없다.

## 1. 제품 목표

SafeNex Vision Fleet을 수십~수백 현장으로 확장한다. 현장 사용자가 Fleet URL·긴 pairing code·NVR IP를 반복 입력하지 않도록, 아래 **C형 혼합 온보딩**을 기본 제품 모델로 구현한다.

| 흐름 | 대상 | 현장 경험 | 중앙 운영 목적 |
|---|---|---|---|
| **QR 현장 승인** | 신규·소규모·예외 설치 | Vision Edge Console의 QR을 스마트폰 SafeNex에서 스캔하고 현장만 확인·승인 | 설치자와 현장 귀속을 명확히 감사 |
| **Provisioning Kit 자동 등록** | 본사 일괄 배포, Intune/GPO/USB 설치 | 현장 프로그램에서 1회용 키트 파일 선택 또는 silent install로 지정 현장에 즉시 등록 | 대량 배포·만료·폐기·재발급을 통제 |
| **현장 LAN 자동 찾기** | QR/키트 등록 뒤 NVR 연결 | Gateway가 ONVIF NVR 후보를 찾고 사용자는 후보 확인 후 읽기 전용 등록 | 중앙이 LAN에 직접 접근하지 않음 |

> 중앙 SafeNex는 현장 NVR이나 PC로 인바운드 접속하지 않는다. Gateway가 outbound HTTPS로 중앙에 연결하고, NVR 탐색·자격증명·RTSP 처리는 현장 PC 안에서만 수행한다.

## 2. 절대 보안·권한 경계

1. 웹·모바일·Supabase 일반 테이블·로그에 RTSP/RTSPS URL, NVR 비밀번호, Gateway private key, mTLS 인증서 전문, bootstrap raw token을 보관하거나 표시하지 않는다.
2. Gateway는 local encrypted store에만 원본 stream credential을 보관한다. 중앙에는 Gateway ID, 장비 메타데이터, 카메라 표시명·AI 프로필·health, AI 이벤트만 보낸다.
3. NVR 녹화·삭제·사용자·네트워크·펌웨어·카메라 설정을 수정하는 API를 만들지 않는다. ONVIF는 discovery와 읽기 전용 metadata/profile 조회에만 쓴다.
4. 모든 중앙 write API는 기존 `company_id`/프로젝트 접근 SSOT와 RLS를 사용한다. 플랫폼 마스터만 전국 조회가 가능하며, 회사·현장 관리자는 자기 범위 밖 Gateway·키트·이벤트를 볼 수 없다.
5. QR 승인, 키트 발급·claim, 인증서 발급, 코드 취소, 정책 rollout, 이벤트 조치는 `actor_id`, `company_id`, `site_id`, `gateway_id`, `request_id`, 시각, 결과를 audit ledger에 기록한다.
6. 안전고리·카라비너·고소작업 관련 AI 감지는 자동 확정 위반이 아니다. `requires_human_review=true` 배지와 확인·조치 흐름을 유지한다.

## 3. Gateway가 이미 제공하는 로컬 UX

현장 Windows 프로그램은 외부 Chrome/Edge를 열지 않고 독립 Console 창으로 실행된다. Agent는 별도 지속 실행 프로세스로 AI·NVR health·이벤트 spool·Fleet heartbeat를 수행한다. Console의 `설정 · SafeNex 연동` 첫 화면에는 다음 세 가지 동선이 있다.

| Console 동작 | Gateway 로컬 API | 중앙 SafeNex가 제공해야 할 API |
|---|---|---|
| QR로 현장 연결 시작 | `POST /api/v1/setup/onboarding/qr/start` | `POST /vision-fleet/v1/gateway-device-authorizations` |
| QR 승인 상태 확인 | `GET /api/v1/setup/onboarding/status` | `POST /vision-fleet/v1/gateway-device-authorizations/{authorization_id}/poll` |
| Provisioning Kit 자동 등록 | `POST /api/v1/setup/onboarding/kit/claim` | `POST /vision-fleet/v1/gateway-bootstrap/claim` |
| NVR 자동 찾기 | `POST /api/v1/setup/discovery/onvif` | 없음 — 현장 LAN 내부만 사용 |

## 4. 중앙 API 계약 — 반드시 구현

### 4.1 QR Device Authorization 생성

`POST /vision-fleet/v1/gateway-device-authorizations`

이 endpoint는 인증 전 Gateway가 outbound HTTPS로 호출한다. 일반 브라우저 세션은 요구하지 않으며, 강한 rate limit과 abuse telemetry를 적용한다.

```json
{
  "device_name": "A동 NVR-01",
  "device_fingerprint": "32-char-sha256-prefix",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n",
  "requested_at": "2026-08-19T10:00:00+00:00"
}
```

성공 시 `201`을 반환한다. `authorization_id`는 추측 불가능한 UUID/ULID이고, `user_code`는 사람이 화면에서 비교할 수 있는 짧은 코드다. `verification_uri_complete`는 QR에만 넣으며, Console은 `user_code`를 별도로 표시한다.

```json
{
  "authorization_id": "gda_01J...",
  "user_code": "KOREA-42",
  "verification_uri": "https://safenex.example.com/vision/approve-device",
  "verification_uri_complete": "https://safenex.example.com/vision/approve-device?session=opaque",
  "expires_in": 600,
  "interval": 5
}
```

### 4.2 QR 승인 화면과 모바일 흐름

`/vision/approve-device`는 로그인한 SafeNex 사용자만 볼 수 있다. QR link의 opaque session을 서버에서 검증하고 다음 정보를 크게 표시한다.

- Gateway 표시 이름과 device fingerprint 앞 6~8자리
- 요청 시간, 만료 시각, 회사·현장 선택 UI
- Console에 보인 user code와 일치 여부를 사용자가 확인하는 입력/확인 UI
- `승인`, `거절` 버튼 및 이유 입력

승인 권한은 플랫폼 마스터, 회사 관리자, 해당 현장/프로젝트의 Vision Fleet 관리 권한 보유자로 제한한다. 승인 전 사용자에게 **승인하면 이 현장 Gateway가 선택 현장의 상태·AI 이벤트·승인 정책을 동기화한다**는 설명을 표시한다. QR link만으로 자동 승인하면 안 된다.

### 4.3 QR 상태 Poll과 mTLS Enrollment

`POST /vision-fleet/v1/gateway-device-authorizations/{authorization_id}/poll`

```json
{ "device_fingerprint": "32-char-sha256-prefix" }
```

| 상태 | HTTP | 응답 규칙 |
|---|---:|---|
| 승인 대기 | `202` | 빈 body 또는 `{ "status": "authorization_pending" }` |
| 승인 완료 | `201` | 아래 enrollment payload |
| 거절·만료·소비 | `422` | 세부 사유는 Gateway에 과도하게 노출하지 않음 |
| 과도한 poll | `429` | `Retry-After`와 audit event |

성공 enrollment payload는 기존 수동 pairing claim과 **동일한 정확한 필드**를 포함해야 한다.

```json
{
  "gateway_id": "gw_01J...",
  "tenant_id": "company_uuid",
  "site_id": "project_uuid",
  "token_url": "https://safenex.example.com/vision-fleet/oauth/token",
  "client_id": "gw_01J...",
  "client_certificate_pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "ca_bundle_pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "master_public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

서버는 CSR 형식·RSA 공개키 강도·device fingerprint·승인 scope를 확인하고, 인증서 subject/client ID와 `gateway_id`를 1:1로 바인딩한다. 인증서 CA private key는 Supabase client, Edge Function browser bundle, 일반 DB 테이블에 두지 말고 서버 전용 secret management에서만 접근한다.

### 4.4 Provisioning Kit 발급

`POST /vision-fleet/v1/provisioning-kits`

웹 관리자 Wizard에서 회사·현장·표시명 prefix·설치 수·정책 그룹·만료 시각을 설정한다. 중앙은 짧은 수명의 one-time bootstrap token을 포함한 **서명된 opaque kit**을 생성하여 `.safenex-kit` 다운로드로 제공한다. browser localStorage에는 raw token을 저장하지 않고, 발급 뒤 재다운로드가 필요하면 새 kit을 발급한다.

Kit payload에는 최소한 `fleet_base_url`, `bootstrap_token`, `kit_id`, `company_id`, `site_id`, `expires_at`, `max_claims`, `policy_group`, `signature`가 필요하다. Gateway는 첫 base64url payload에서 `fleet_base_url`과 `bootstrap_token` 형식을 읽을 수 있지만, **신뢰 판단은 반드시 중앙 claim endpoint가 서명·만료·소비 상태를 검증한 뒤에만** 한다.

```json
{
  "company_id": "company_uuid",
  "site_id": "project_uuid",
  "display_name_prefix": "A동-NVR",
  "max_claims": 5,
  "expires_at": "2026-08-26T00:00:00Z",
  "policy_group": "construction-ppe-v1"
}
```

### 4.5 Provisioning Kit Claim

`POST /vision-fleet/v1/gateway-bootstrap/claim`

```json
{
  "kit": "base64url(payload).base64url(signature)",
  "device_name": "A동 NVR-01",
  "device_fingerprint": "32-char-sha256-prefix",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n",
  "requested_at": "2026-08-19T10:00:00+00:00"
}
```

이 endpoint는 Kit의 서명, `kid`, 만료, 폐기 여부, one-time token hash, `max_claims`, 현장 귀속, CSR, device fingerprint policy를 모두 검사한다. 성공 시 token consume·Gateway 생성·인증서 발급·audit log를 하나의 transaction으로 처리하고, **4.3과 동일한 enrollment payload**를 `201`으로 반환한다. 실패는 raw token/서명 상태를 유추할 수 없게 `422`로 통일한다.

관리자는 `POST /vision-fleet/v1/provisioning-kits/{id}/revoke`로 미사용 Kit을 즉시 폐기할 수 있어야 하며, 폐기 후 claim은 거부해야 한다. 발급·다운로드·claim·폐기는 감사 로그와 Gateway detail에 표시한다.

### 4.6 기존 수동 pairing fallback

기존 Gateway는 다음 endpoint도 계속 호출할 수 있다. QR/Kit을 우선 UX로 배치하되, 현장 네트워크/정책 문제 복구용으로 제거하지 않는다.

`POST /vision-fleet/v1/gateway-pairings/claim`

```json
{
  "pairing_code": "J9dYQ7Kp-2uVf8mN",
  "device_name": "A동 NVR-01",
  "device_fingerprint": "32-char-sha256-prefix",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n",
  "requested_at": "2026-08-19T10:00:00+00:00"
}
```

응답은 동일 enrollment payload다. pairing raw code는 salted hash로만 저장하고, 10분 내외 만료·단일 사용·rate limit·취소·감사 로그를 적용한다.

## 5. Gateway 이후 Fleet API와 대규모 운영

mTLS client credential과 인증서 subject/client ID가 URL의 `gateway_id`와 일치해야 한다. Gateway에는 `gateway.heartbeat`, `gateway.events`, `gateway.state:read`, `gateway.commands:ack` 최소 scope만 발급한다.

| 목적 | Gateway → Master endpoint | 중앙 처리 원칙 |
|---|---|---|
| heartbeat | `POST /vision-fleet/v1/gateways/{gateway_id}/heartbeats` | release·last seen·camera health·spool depth 저장 |
| AI/장비 이벤트 | `POST /vision-fleet/v1/gateways/{gateway_id}/events:batch` | idempotency key·event batch·회사/현장 귀속 검증 |
| desired state | `GET /vision-fleet/v1/gateways/{gateway_id}/desired-state` | signed policy version만 반환 |
| command ack | `POST /vision-fleet/v1/gateways/{gateway_id}/commands/{command_id}/ack` | 사용자·승인·만료·결과 audit |

Central orchestration은 `unclaimed → approval_pending → enrolling → online/degraded/offline → revoked` 상태 모델을 사용한다. 전체 Fleet 동시 재시작을 피하기 위해 reconnect/heartbeat jitter와 exponential backoff를 설계하고, 정책 배포는 `dry-run → site canary → policy group → fleet` 순서로만 확장한다.

## 6. 권장 데이터 모델과 RLS

| 테이블 | 핵심 필드 | 보안 요구 |
|---|---|---|
| `vision_gateways` | `id`, `company_id`, `site_id`, `display_name`, `device_fingerprint`, `connection_state`, `last_seen_at`, `software_version` | 회사/현장 scope RLS |
| `vision_device_authorizations` | `id`, `user_code_hash`, `session_hash`, `csr_fingerprint`, `expires_at`, `approved_by`, `approved_at`, `denied_at` | raw session/user code 미노출 |
| `vision_provisioning_kits` | `id`, `company_id`, `site_id`, `token_hash`, `expires_at`, `max_claims`, `claimed_count`, `revoked_at`, `policy_group` | raw bootstrap token 미저장 |
| `vision_nvr_metadata` | `gateway_id`, `display_name`, `vendor`, `host_label` | IP·credential·RTSP 저장 금지 |
| `vision_camera_metadata` | `gateway_id`, `camera_external_id`, `display_name`, `ai_profile`, `enabled`, `last_health` | stream URL 저장 금지 |
| `vision_safety_events` | `gateway_id`, `camera_id`, `severity`, `event_type`, `requires_human_review`, `status`, `assignee_id` | 회사/현장 RLS |
| `vision_command_ledger` | `gateway_id`, `command_type`, `risk_level`, `state`, `requested_by`, `approved_by`, `expires_at` | signed command 원문 노출 최소화 |
| `vision_audit_ledger` | `actor_id`, `action`, `entity_type`, `entity_id`, `request_id`, `occurred_at`, `outcome` | append-only 정책 |

## 7. 웹·모바일 화면 요구사항

### 7.1 Vision Fleet Overview

전국/회사/현장/정책 그룹/release/상태 필터를 제공한다. 플랫폼 마스터는 전국 요약을 볼 수 있지만, 회사 관리자는 자신에게 할당된 회사·현장만 본다. 화면은 online, degraded, offline, approval_pending, unclaimed 수와 P1/P2 이벤트·마지막 heartbeat·spool backlog를 보여 준다.

### 7.2 `Gateway 추가` Wizard

첫 화면은 **QR 현장 승인**과 **Provisioning Kit 일괄 배포** 두 카드다. QR 승인 흐름에서는 회사·현장·표시 이름을 선택하고 QR approval session을 만든다. 운영자는 현장 Console의 QR을 모바일로 스캔해 company/site를 마지막으로 확인·승인한다. Kit 흐름에서는 설치 수·만료·정책 그룹을 지정하고 `.safenex-kit` 다운로드, 복사 가능한 kit ID, 폐기 버튼을 제공한다. 기존 pairing code는 `고급/복구 수단`으로 접어 둔다.

### 7.3 Gateway Detail

`개요`, `카메라`, `AI 이벤트`, `정책 rollout`, `감사` 탭을 제공한다. 카메라에는 이름·AI profile·enabled·최근 health만 표시한다. Gateway loopback MJPEG 또는 RTSP를 인터넷에 노출하지 않는다. 모바일 live video는 후속 단계에서 권한화된 short-lived HLS/WHEP relay가 설계·보안 검토된 뒤에만 제공한다.

### 7.4 모바일 승인과 현장 대응

스마트폰 390px 폭에서 QR scan/deep link, user code 대조, 현장 선택, 승인/거절, Gateway 상태, P1/P2 이벤트 확인·담당자 배정·조치 완료가 가능해야 한다. 모바일에는 NVR credential·RTSP 설정·인증서 관리 UI를 제공하지 않는다.

## 8. 수용 기준

1. 신규 현장 사용자는 Vision Edge Console의 QR을 스캔해 Fleet 주소·긴 code 입력 없이 Gateway를 회사·현장에 승인할 수 있다.
2. 본사는 1개 이상의 지정 현장·만료·설치 수가 포함된 Provisioning Kit을 발급·폐기·감사할 수 있고, 현장 Gateway는 성공 시 즉시 mTLS enrollment를 완료한다.
3. QR/Kit/pairing fallback은 같은 `vision_gateways`와 인증서 모델로 합류하며 중복 Gateway·중복 claim이 생기지 않는다.
4. 모든 claim은 CSR, 현장 귀속, one-time 사용, 만료, rate limit, audit ledger를 검증한다.
5. QR status는 Gateway poll interval을 지키며, 대규모 Fleet에서 thundering herd를 만들지 않는다.
6. Gateway 상태·camera metadata·AI event는 회사/현장 RLS를 통과한 사용자에게만 보인다.
7. 웹·모바일·DB·로그에 RTSP, NVR password, Gateway private key, raw pairing/bootstrap token이 노출되지 않는다.
8. 모바일에서 QR 승인 및 P1/P2 이벤트 조치가 가능하고, 웹에서 policy group canary rollout 상태·감사 내역을 확인할 수 있다.

## 9. 구현 금지

- 기존 AuthGuard, RoleGuard, RLS, company/project access SSOT를 우회하는 독립 권한 체계를 만들지 말 것.
- 중앙 서버가 현장 LAN/NVR/PC로 인바운드 연결하거나 UDP discovery를 시도하지 말 것.
- mTLS CA private key, Supabase service role key, pairing raw code, bootstrap raw token을 프론트엔드·localStorage·일반 select 테이블에 넣지 말 것.
- 중앙 웹에서 Gateway의 `live.mjpeg` loopback 주소를 사용하거나 프록시하지 말 것.
- AI 경보만으로 안전고리 미체결 등에 자동 처벌·차단·징계를 확정하지 말 것.

## References

[1] [IETF RFC 8628 — OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)

[2] [ONVIF Core Specification](https://www.onvif.org/specs/core/ONVIF-Core-Specification-v241.pdf)

[3] [Microsoft — Distribute your app and the WebView2 Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)


## 10. 중앙집중 Vision Federation 확장 — 반드시 이 모델로 구현

### 10.1 제품 해석

SafeNex는 전국 카메라의 **중앙 관제 경험·권한·감사**를 집중한다. 그러나 browser/mobile/Supabase가 raw RTSP URL, NVR password, 현장 VPN 주소를 직접 받거나 모든 main stream을 상시 중앙 복제하면 안 된다. 현장 NVR는 원본 primary recorder, Vision Edge는 AI와 현장 연결 agent, SafeNex는 access-control/control plane, 중앙 media relay/VMS는 승인된 live·playback·evidence 경로라는 역할을 유지한다.

### 10.2 중앙 데이터 모델 추가

기존 company/project access SSOT와 RLS를 재사용해 아래 모델을 추가한다. 모든 table은 `company_id`, `site_id`와 append-only `vision_audit_ledger` 연결을 갖고, camera의 raw stream URL이나 NVR secret는 넣지 않는다.

| 테이블 | 핵심 필드 | 금지 필드 |
|---|---|---|
| `vision_camera_scopes` | `camera_id`, `gateway_id`, `company_id`, `site_id`, `zone_id`, `display_name`, `health`, `media_policy` | RTSP URL, NVR password |
| `vision_role_bindings` | `subject_id`, `role`, `company_id`, `site_id`, `zone_id`, `valid_from`, `valid_to` | role을 browser only flag로 처리 |
| `vision_stream_grants` | `id`, `subject_id`, `camera_id`, `action`, `expires_at`, `max_bitrate_kbps`, `watermark`, `status` | raw RTSP, reusable bearer token |
| `vision_evidence_requests` | `event_id`, `camera_id`, `requester_id`, `reason`, `retention_class`, `state` | public permanent media URL |
| `vision_audit_ledger` | `actor_id`, `action`, `scope`, `grant_id`, `request_id`, `outcome`, `occurred_at` | update/delete UI |

### 10.3 권한 판정과 stream grant

권한은 `tenant/company → site → zone → camera → action → time window`의 교집합이다. 모든 live/playback/evidence 요청은 서버에서 RLS와 explicit action 권한을 먼저 검증한다. 허가 시에만 5분 기본 TTL의 one-camera/one-user/one-action stream grant를 생성한다. grant는 `live_substream`, `live_mainstream`, `playback`, `evidence_request`, `ptz` action을 엄격히 구분하고, 만료·role revoke·browser foreground loss 때 종료해야 한다.

Gateway 또는 Central media relay는 signed grant의 tenant/site/camera/audience/expiry/max bitrate를 검증하고, 유효한 grant에 대해서만 outbound relay를 시작한다. 중앙 웹은 `live.mjpeg` loopback URL을 호출하거나 RTSP를 노출하지 않는다. 모든 session 화면에는 company·user·time watermark를 표시한다.

### 10.4 SafeNex API 계약

| 목적 | endpoint | 보안 요구 |
|---|---|---|
| Camera 목록 | `GET /vision-fleet/v1/cameras?site_id=&zone_id=` | RLS 후 permitted metadata만 반환 |
| Live grant | `POST /vision-fleet/v1/cameras/{camera_id}/stream-grants` | action/time/RBAC 확인, short TTL, audit |
| Session 종료 | `POST /vision-fleet/v1/stream-grants/{grant_id}/close` | subject 또는 operator authorization, audit |
| Playback 요청 | `POST /vision-fleet/v1/cameras/{camera_id}/playback-grants` | retention + reason + RLS |
| Evidence 추출 | `POST /vision-fleet/v1/events/{event_id}/evidence-requests` | reason required, async job/audit |
| Break-glass | `POST /vision-fleet/v1/break-glass-grants` | reason + incident ref + dual/auth policy + 15min TTL |

`stream-grant`은 Gateway에 전달되는 signed command이며, 아래처럼 signed payload를 가진다. signature verification은 Gateway에서 fail-closed로 수행한다.

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
  "relay_url": "https://relay.safenex.example/sessions/opaque",
  "watermark": "company · user · timestamp",
  "signature": "ed25519"
}
```

### 10.5 화면 요구사항

`Vision Fleet Overview`에는 회사/현장/구역/online/degraded/offline/AI severity를 필터로 제공한다. `Central Live Wall`은 RBAC이 허가한 카메라만 카드로 만들고, 사용자가 누른 카드만 stream grant를 생성한다. `Event Center`는 event first timeline과 clip request 상태를 보여 주며, 모든 main-video 요청·export·PTZ·break-glass는 사유와 audit trail을 표시한다. 모바일은 권한 범위의 event·live substream·acknowledge를 지원하되, credential·NVR 설정·raw URL은 노출하지 않는다.

### 10.6 중앙 장기보존 정책

기본은 현장 NVR 원본 보존이다. central storage에는 high-risk evidence, 법정 보존 지정 camera, 운영자 승인 clip, low bitrate proxy만 넣는다. 셀룰러/저대역폭 site의 평시 정책은 `metadata + event thumbnail`이고, stream grant·evidence request가 있을 때만 substream/clip을 relay한다. 중앙 media/VMS 장애가 있어도 현장 NVR recording·Vision Edge AI·event spool은 계속 동작해야 한다.

### 10.7 추가 수용 기준

1. 사용자는 권한 없는 site/zone/camera를 list API에서 식별할 수 없고, ID를 추측해도 grant를 받을 수 없다.
2. SafeNex 화면은 raw RTSP, NVR password, local gateway URL을 한 번도 표시·저장·로그하지 않는다.
3. live session은 5분 기본 TTL이며, renew/revoke/close가 audit ledger에 남는다.
4. camera main stream의 상시 중앙 복제는 정책상 허용된 camera만 가능하고, metered site는 기본 거부한다.
5. 현장 WAN/중앙 relay가 끊겨도 local NVR recording과 Vision Edge AI 이벤트 spool은 유지된다.
6. evidence export와 break-glass는 강화된 승인·사유·immutable audit 규칙을 통과해야 한다.
