# Cursor 실행 프롬프트 — SafeNex Vision Fleet 페어링·웹·모바일 관제

> 이 문서를 Cursor에게 그대로 전달해 SafeNex 웹·모바일 영역만 구현한다. 현장 NVR Gateway의 `vision-edge` 모듈은 별도 프로그램이며, 웹 앱은 RTSP·NVR 비밀번호·원본 카메라 스트림에 직접 접속해서는 안 된다.

## 목표

SafeNex 관리자가 웹 또는 스마트폰에서 전국 현장의 Vision Edge Gateway를 등록하고, **일회용 페어링 코드**로 현장 프로그램을 회사·현장에 안전하게 연결할 수 있게 구현한다. 연결 후 웹은 Gateway 상태, 카메라 메타데이터, AI 안전 이벤트, 확인·조치 이력, 승인된 정책 배포 상태를 보여 준다. 일반 사용자는 복잡한 인증서 경로·토큰 URL·비밀값을 입력하지 않아야 한다.

## 절대 지켜야 할 경계

1. 브라우저·모바일 앱은 RTSP/RTSPS URL, NVR 비밀번호, Gateway 개인 키, mTLS PFX/PEM에 접근하지 않는다.
2. NVR 녹화·삭제·카메라 설정 변경 API를 웹에서 호출하지 않는다.
3. Gateway는 현장에서 outbound HTTPS만 만들며, Master가 현장 PC/NVR로 직접 접속하는 인바운드 경로를 만들지 않는다.
4. 회사·현장 범위는 현재 SafeNex의 `company_id`/프로젝트 접근 SSOT와 RLS에 반드시 결합한다. 플랫폼 마스터만 전국 조회가 가능하며, 회사 관리자·현장 관리자는 자기 범위만 본다.
5. 고소작업 안전고리·카라비너 관련 AI 이벤트는 자동 확정 위반이 아닌 **`requires_human_review=true` 확인 필요**로 표시한다.

## 사용자 흐름: 3분 현장 연결

### A. SafeNex 웹의 관리자

1. `관리자 > Vision Fleet > Gateway 추가`를 연다.
2. 회사를 선택하고, 권한 범위 안의 현장/프로젝트를 선택한다.
3. 표시 이름(예: `A동 NVR-01`)을 입력한다.
4. 시스템은 10분 뒤 만료되는 단 한 번 사용 가능한 pairing code를 생성한다. 웹은 다음을 크게 보여 준다.
   - Fleet 주소: `https://<safenex-host>/vision-fleet`
   - 페어링 코드
   - 만료 시각·상태·재생성 버튼
5. 현장 사용자에게 Fleet 주소와 코드를 전달한다. QR은 주소·코드만 담고 인증서·비밀값은 담지 않는다.

### B. 현장 Vision Edge 프로그램

1. 앱의 `설정 · 연동` 화면에서 Fleet 주소, pairing code, 이 현장 PC 이름을 입력한다.
2. Gateway는 로컬에서 RSA 3072 개인 키와 CSR을 생성한다. 개인 키는 현장 PC를 떠나지 않는다.
3. Gateway는 아래 Claim API를 HTTPS로 호출한다.
4. Master가 인증서를 반환하면 Gateway는 안전한 로컬 저장 경로에만 인증서·CA·Master Ed25519 공개키를 보관하고, 바로 heartbeat·이벤트·desired-state 동기화를 시작한다.
5. 웹의 Gateway 상태는 `Pairing code issued → Paired → Online/Degraded/Offline`으로 갱신된다.

## Gateway Claim API — 반드시 이 계약을 구현

현장 프로그램은 이미 아래 endpoint를 호출하도록 구현되어 있다.

### `POST /vision-fleet/v1/gateway-pairings/claim`

**인증:** pairing code 자체가 단일 사용 비밀이며 HTTPS가 필수다. 이 endpoint는 사용자의 브라우저 세션을 요구하지 않는다.

**Request**

```json
{
  "pairing_code": "J9dYQ7Kp-2uVf8mN",
  "device_name": "A동 NVR-01",
  "csr_pem": "-----BEGIN CERTIFICATE REQUEST-----\n...\n-----END CERTIFICATE REQUEST-----\n",
  "requested_at": "2026-08-19T09:00:00+00:00"
}
```

**서버 검증:** pairing code는 해시로만 저장한다. 만료 여부, 1회 사용 여부, 회사·현장 귀속 상태, CSR PEM 형식과 공개키 길이를 검증한다. 성공 시 코드 소비와 Gateway 생성은 트랜잭션으로 원자 처리한다. raw code·CSR·인증서 전문을 애플리케이션 로그에 남기지 않는다.

**Success Response `201`**

```json
{
  "gateway_id": "gw_01J...",
  "tenant_id": "company_uuid",
  "site_id": "project_uuid",
  "token_url": "https://<safenex-host>/vision-fleet/oauth/token",
  "client_id": "gw_01J...",
  "client_certificate_pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "ca_bundle_pem": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
  "master_public_key_pem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
}
```

**오류:** 잘못됨/만료/이미 사용됨은 세부 사유를 공개하지 않고 `422`로 처리한다. rate limit을 적용하며 동일 source에서 짧은 시간 반복 claim은 `429`로 차단한다. 인증서 서명용 CA 개인 키는 일반 프론트엔드 번들·DB 행·클라이언트 코드에 둘 수 없다. 서버 전용 비밀관리 경로에서만 사용한다.

## 페어링 이후 Gateway API

Gateway가 mTLS client-credentials token을 받도록 구현한다. access token은 짧게(예: 5분) 유지하고 다음 scope만 부여한다.

| 기능 | Gateway → Master endpoint | 최소 scope |
|---|---|---|
| 상태 heartbeat | `POST /vision-fleet/v1/gateways/{gateway_id}/heartbeats` | `gateway.heartbeat` |
| AI/장비 이벤트 | `POST /vision-fleet/v1/gateways/{gateway_id}/events:batch` | `gateway.events` |
| 승인 정책 조회 | `GET /vision-fleet/v1/gateways/{gateway_id}/desired-state` | `gateway.state:read` |
| 명령 확인 | `POST /vision-fleet/v1/gateways/{gateway_id}/commands/{command_id}/ack` | `gateway.commands:ack` |

Master는 `X-Gateway-Id`와 인증서 subject/client id를 비교하고, URL의 gateway가 해당 certificate의 gateway와 일치하지 않으면 거부한다. 모든 write API는 `request_id`, 호출 시각, 결과를 audit ledger에 남긴다.

## 데이터 모델 및 RLS

기존 회사·프로젝트 권한 모델을 사용해 다음 테이블 또는 동등 모델을 만든다.

| 모델 | 핵심 필드 |
|---|---|
| `vision_gateway_pairings` | `id`, `company_id`, `site_id`, `display_name`, `code_hash`, `expires_at`, `consumed_at`, `created_by` |
| `vision_gateways` | `id`, `company_id`, `site_id`, `display_name`, `certificate_subject`, `connection_state`, `last_seen_at`, `software_version`, `last_error` |
| `vision_nvrs` | `id`, `gateway_id`, `display_name`, `vendor`, `host_label`; IP/credential는 웹에 저장하지 않음 |
| `vision_cameras` | `id`, `gateway_id`, `camera_external_id`, `display_name`, `ai_profile`, `enabled`, `last_health` |
| `vision_safety_events` | `id`, `gateway_id`, `camera_id`, `severity`, `event_type`, `occurred_at`, `requires_human_review`, `status`, `assignee_id`, `resolution_note` |
| `vision_command_ledger` | `id`, `gateway_id`, `command_type`, `risk_level`, `state`, `requested_by`, `approved_by`, `expires_at`, `ack_payload` |

RLS는 `company_id`와 현재 사용자 회사 범위 SSOT를 기준으로 한다. 회사 관리자에게 다른 회사 gateway 목록·이벤트·카메라를 반환하면 안 된다. pairing code hash·certificate PEM·token response·NVR credential은 일반 select API에서 절대 노출하지 않는다.

## 웹·모바일 화면 구현

### 1. Vision Fleet Overview

전국/회사/현장 필터, 온라인·저하·오프라인 Gateway 수, 최근 고위험 이벤트, Gateway 카드 목록을 제공한다. 카드는 연결 상태·마지막 heartbeat·카메라 수·미전송 이벤트·적용 정책 버전을 보여 준다.

### 2. Gateway Detail

`개요`, `카메라`, `AI 이벤트`, `정책`, `감사 로그` 탭을 제공한다. 카메라 탭은 이름·AI 프로필·최근 health만 표시한다. 원본 RTSP URL은 표시하지 않는다. live video는 별도 후속 단계의 **권한화된 단기 HLS/WHEP 프록시**가 갖춰질 때만 표시하고, Gateway loopback MJPEG를 인터넷으로 노출하지 않는다.

### 3. Gateway 등록 Wizard

현장 선택 → 표시 이름 → pairing code 생성 → QR/복사 → `Paired` 확인의 4단계다. 코드 재발급은 기존 미사용 코드를 즉시 무효화한다.

### 4. AI 이벤트 운영

고위험 PPE 이벤트는 알림·상세·담당자 지정·확인·조치 완료·증거/메모 흐름을 제공한다. `requires_human_review=true`인 이벤트에는 “AI 보조 경보 — 현장 확인 전 확정 금지” 배지를 명확히 표시한다.

### 5. 모바일 반응형

스마트폰은 카드형 Gateway 목록, P1/P2 이벤트, 확인·담당자 배정·상태 필터를 우선한다. 모바일에서 RTSP 설정이나 인증서 관리 기능을 제공하지 않는다.

## 수용 기준

1. SafeNex 관리자는 자기 회사·현장 범위에서 일회용 pairing code를 만들고 취소·재발급할 수 있다.
2. 현장 Gateway가 claim에 성공하면 웹에서 30초 이내 `Paired` 상태가 보인다.
3. Gateway heartbeat와 AI event가 해당 회사·현장 범위에만 보인다.
4. 웹 API/DB/UI 어디에도 RTSP URL, 카메라 비밀번호, Gateway 개인 키, pairing raw code가 노출·로그·저장되지 않는다.
5. 다른 회사 관리자가 URL·ID를 추측해도 Gateway·이벤트·카메라를 읽거나 pairing을 만들 수 없다.
6. 최신 Gateway 상태, 이벤트 처리, pairing code 감사 이력이 사용자와 시각을 포함해 남는다.
7. 모바일 390px 폭에서 Gateway 상태 조회와 고위험 이벤트 확인·조치가 완료된다.

## 구현 금지

- 기존 `AuthGuard`, `RoleGuard`, 회사 범위/RLS를 우회하는 별도 권한 판단을 만들지 말 것.
- 브라우저에서 NVR/카메라를 직접 호출하지 말 것.
- pairing code·mTLS private key·service role key를 localStorage, 프론트엔드, 일반 테이블에 저장하지 말 것.
- “안전고리 미체결” 이벤트를 AI만으로 자동 처벌·차단 판정하지 말 것.
