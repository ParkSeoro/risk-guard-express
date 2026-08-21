# SafeNex Vision Fleet SSOT

이 문서가 CCTV/비전 기능의 **유일한 계약**이다. 아래 문서는 역사적 초안이며 이 SSOT와 충돌하면 **이 파일을 따른다.**

- `docs/CURSOR_PROMPT_VISION_FLEET_PAIRING_AND_MONITORING.md`
- `docs/CURSOR_PROMPT_Vision_Fleet_Web_Mobile.md`
- `vision-edge/CURSOR_PROMPT_VISION_FLEET_WEB.md`

상태: **파일럿**. NVR을 대체하지 않는다. 기존 SafeNex 결재·GPS·공지 모듈과 스키마를 공유하지 않는다(알림 라우팅·사이드바 진입만 연동).

## 역할

| 계층 | 책임 | 비밀 |
|---|---|---|
| 현장 NVR | 원본 24h 녹화·현장 재생·증거 | NVR 암호는 현장에만 |
| Vision Edge Gateway (`vision-edge/`) | 읽기 전용 RTSP health, AI 규칙, 이벤트 spool, grant 검증 후 outbound 중계 | RTSP는 로컬 secret store |
| Vision Fleet API (`supabase/functions/vision-fleet`) | `/v1/...` 제어면 | 메타·이벤트·grant. RTSP 없음 |
| SafeNex UI | `/app/admin/vision-fleet`, 모바일 페어링·이벤트 | 세션 URL만 |
| Media relay | grant 세션의 outbound 수신 (파일럿은 세션 레코드 + 스텁 publish) | RTSP를 브라우저에 주지 않음 |

## API prefix

Gateway·웹 모두 **`/v1/...`**. 함수 base: `https://<project>.supabase.co/functions/v1/vision-fleet`.

Gateway가 호출하는 제어 API:

- `POST /v1/oauth/token`
- `POST /v1/gateways/{id}/heartbeats`
- `POST /v1/gateways/{id}/events:batch` → `{ data: { accepted_event_ids } }`
- `GET /v1/gateways/{id}/desired-state`
- `POST /v1/gateways/{id}/command-acks`
- `GET /v1/gateways/{id}/stream-grants` (유효 grant 폴링)
- `POST /v1/gateways/{id}/relay-sessions` (outbound 세션 선언)

페어링:

- `POST /v1/gateway-device-authorizations`
- `POST /v1/gateway-device-authorizations/{id}/poll`
- `POST /v1/gateway-device-authorizations/{id}/approve` (사람 JWT)
- `POST /v1/gateway-bootstrap/claim`
- `POST /v1/provisioning-kits` (사람 JWT)

사람 UI(Supabase RLS SELECT + 일부 UPDATE):

- `vision_gateways`, `vision_nvrs`, `vision_cameras`, `vision_gateway_health`
- `vision_safety_events` (ack)
- `vision_stream_grants` (요청은 edge function)
- `vision_audit_ledger` (append-only, SELECT)

## 화면 우선순위

1. 운영 상태 + 이벤트 큐 (Live 모자이크 아님)
2. QR/Kit 페어링
3. Stream grant (5분, `live_substream`)
4. AI 실모델은 interlock 전에는 사이렌 금지

## 역할 매핑

기존 `master` / `safety_manager` / `site_manager` / `project_admin`. 새 슈퍼롤 없음. 협력사 계정은 비전 관제 메뉴 비표시(RoleGuard).

## 알림

`type = vision_safety_event`. 위험구역 사이렌 채널에 넣지 않는다. `severity`는 기본 NULL. PA/사이렌은 `vision_gateways.alarm_interlock_enabled = true` 이후 별도 에픽.

## 하네스

`harness_review_required`만. 자동 미체결 확정 금지.

## 랩

실 NVR 체크리스트: [`vision-edge/docs/NVR_COMPATIBILITY_LAB.md`](../vision-edge/docs/NVR_COMPATIBILITY_LAB.md)

