# SafeNex 중앙집중 Vision Fleet 아키텍처

## 1. 설계 결정

사용자 방향을 채택한다. 관리자는 SafeNex에서 전국의 현장·카메라·AI 위험 이벤트를 하나의 관제 경험으로 보고, 역할·회사·현장·구역·시간대에 따라 허용된 영상만 접근한다. 다만 중앙집중의 대상은 **관제 경험·권한·정책·감사·선택 영상**이며, 모든 원본 영상을 항상 중앙으로 복제하는 것이 아니다.

> **중앙은 전국의 카메라를 하나의 가상 NVR로 보이게 하고, 현장은 끊겨도 스스로 녹화·AI 분석·증거 보존을 계속한다.**

이 구조를 `Central Vision Fleet Federation`으로 정의한다. 중앙에 실제 대용량 NVR/VMS cluster 또는 approved object storage를 두되, 각 현장 NVR는 원본 primary recorder, Vision Edge는 AI·접속제어·현장 연결 agent, SafeNex는 권한 중심 control plane으로 역할을 분리한다.

## 2. 구성 요소와 책임

| 계층 | 구성 요소 | 책임 | 원본 영상 보관 |
|---|---|---|---|
| 현장 카메라 | IP Camera, LTE/5G camera, PTZ | RTSP/ONVIF stream, edge buffer | 선택 사항: SD card failover |
| 현장 기록 계층 | Site NVR | 상시 원본 녹화, 현장 playback, 사고 시 증거 보존 | **Primary** |
| 현장 제어 계층 | SafeNex Vision Edge | AI PPE/위험구역/안전고리 분석, health, event spool, stream grant enforcement | Event snapshot/clip buffer만 |
| 중앙 media 계층 | Central VMS/NVR relay + evidence storage | 승인된 live relay, on-demand playback, high-risk clip/장기보존 | **Selected / policy-based** |
| 중앙 control 계층 | SafeNex Vision Fleet | 전국 디렉터리, pairing, policy, stream grant, rollout, audit | metadata only |
| 사용자 계층 | SafeNex 웹·모바일 | RBAC 기반 live/playback/evidence/현장 상태 조회 | 브라우저 cache 금지 |

## 3. 영상 집결 정책

### 3.1 평상시

평상시 중앙으로는 camera inventory, online/offline health, AI event metadata, thumbnail 또는 짧은 encrypted evidence reference만 전송한다. 고비용 셀룰러 현장은 main stream을 중앙에 계속 보내지 않는다. SafeNex에서 사용자가 특정 카메라를 열면 권한 확인 후 제한 시간의 stream grant를 발급하고, Gateway가 low bitrate substream 또는 필요한 경우 main stream을 Central relay에만 outbound로 제공한다.

### 3.2 사고·고위험 이벤트

`critical` 등급의 PPE·추락 위험·위험구역 침입 같은 이벤트는 이벤트 메타데이터와 저용량 snapshot을 즉시 중앙에 알린다. 중앙 policy가 요구하면 해당 시점 전후의 clip을 현장 NVR 또는 Gateway buffer에서 추출하여 encrypted evidence storage로 전송한다. 현장 회선이 끊기면 Edge spool에 event와 pending media job을 보존하고, 복구 뒤에는 우선순위·retention 정책에 따라 재전송한다.

### 3.3 중앙 장기보존

중앙 NVR/VMS에는 법정 보존·사고 조사·교육·고위험 구역처럼 명시적으로 지정된 stream만 녹화한다. 이 대상도 현장 NVR를 대체하지 않는다. 중앙 record가 실패해도 현장 원본은 계속 유지해야 하며, 중앙 record 성공 여부는 health/audit 지표로 관리한다.

## 4. SafeNex 권한 모델

| 역할 | 범위 | 허용 행동 | 금지 또는 추가 승인 |
|---|---|---|---|
| Platform Super Admin | tenant 전체 | 조직·site·role·retention policy 관리, audit 조회 | raw credential·Gateway private key 조회 금지 |
| Central Safety Controller | 할당된 organization/site | 전국 멀티뷰, AI event acknowledge, 승인된 live/playback | camera 설정·NVR 녹화 삭제 금지 |
| Site Safety Manager | 자신의 site/zone | 해당 현장 live/playback, evidence request, 현장 대응 기록 | 타 현장 접근·Fleet policy 변경 금지 |
| Subcontractor Supervisor | 위임된 zone/camera/time | 작업 시간 live와 자기 팀 관련 event | playback export·다른 zone 접근 금지 |
| Auditor/Client Viewer | read-only assigned scope | 워터마크 live/playback, audit evidence view | PTZ·download·export 금지 |
| Gateway Service Identity | 자기 gateway only | mTLS heartbeat, event upload, approved stream relay | 다른 gateway impersonation·human UI login 금지 |

권한 판정은 `tenant_id → organization_id → site_id → zone_id → camera_id → action → validity window` 순서로 좁힌다. 모든 live start/stop, playback, evidence export, PTZ command, role 변경, policy 변경은 immutable audit log에 actor, scope, reason, timestamp, request ID를 남긴다.

## 5. Stream Grant 계약

SafeNex는 raw RTSP URL을 사용자에게 주지 않는다. 사용자가 live 또는 playback을 요청하면 SafeNex API가 RBAC과 camera policy를 통과시킨 뒤 다음의 짧은 수명 grant를 Gateway에 전달한다.

```json
{
  "grant_id": "uuid",
  "tenant_id": "tenant-a",
  "site_id": "site-seoul-01",
  "camera_id": "gate-north-01",
  "action": "live_substream",
  "subject_id": "user-uuid",
  "expires_at": "2026-08-20T03:15:00Z",
  "max_bitrate_kbps": 700,
  "relay_url": "https://relay.safenex.example/sessions/uuid",
  "watermark": "company · user · timestamp",
  "signature": "ed25519"
}
```

Gateway는 signed grant의 audience·tenant/site/camera·expiry·action·bandwidth ceiling을 검증한다. 유효한 grant에 대해서만 local stream을 relay로 **outbound** publish한다. 인바운드 port forward, 공유 RTSP password, 공용 camera URL은 금지한다. `main_stream`, `playback`, `evidence_export`, `ptz`는 별도 action과 더 강한 role/approval을 요구한다.

## 6. 중앙 NVR의 두 가지 운영 형태

| 선택지 | 사용 시점 | 장점 | 전제/주의 |
|---|---|---|---|
| 중앙 VMS/NVR Federation | 본사 관제실이 24/7 모니터링하고 selected camera의 중앙 recording도 필요 | 기존 NVR/VMS operator 경험, wall display, local NVR federation | VMS vendor API/라이선스, relay bandwidth, DR site 필요 |
| SafeNex Central Media Relay + Object Evidence | SafeNex를 중심으로 웹·모바일 권한 관제를 빠르게 확장 | vendor-agnostic, event-first, 셀룰러 비용 통제, mobile integration | media relay/WebRTC/HLS 규모화, object retention policy 필요 |

권고는 **두 방식을 공존**시키는 것이다. 본사 기존 NVR/VMS는 관제실의 selected stream/법정 보존을 담당하고, SafeNex는 전국 directory·권한·AI event·모바일·감사·stream grant를 담당한다. 따라서 중앙 NVR 하나가 모든 현장 카메라의 단일 장애점이 되지 않는다.

## 7. 가용성·재해복구

현장 WAN, Central relay, SafeNex control plane 중 어느 하나가 끊겨도 현장 NVR recording과 Vision Edge AI는 계속 동작한다. Gateway는 events/media jobs를 encrypted durable spool에 보존한다. Central relay는 region/availability zone 이중화, time-boxed sessions, per-tenant quota, no-store cache header를 적용한다. 중앙 NVR failure도 현장 primary recording을 지우거나 변화시키지 않는다.

## 8. 단계별 구현 순서

| 우선순위 | 산출물 | 완료 기준 |
|---|---|---|
| 1 | SafeNex camera inventory + site/zone RBAC | 사용자가 허가 scope 밖 camera ID를 enumeration할 수 없음 |
| 2 | Event-first 전국 Fleet dashboard | 현장 online/AI alarm을 중앙 지도·목록에서 조회 |
| 3 | Signed stream grant + outbound relay | SafeNex live 요청에서 RTSP 비밀 미노출, grant expiry 시 relay 종료 |
| 4 | Central selected recording/evidence archive | 지정 camera/event clip만 중앙 retention policy로 저장 |
| 5 | VMS/NVR Federation connector | 본사 관제실 display와 SafeNex audit/RBAC가 일치 |
| 6 | DR·load·security exercise | site WAN 단절, central outage, revoked role, compromised token 시나리오 검증 |

## References

[1] [Axis Communications — Edge storage](https://www.axis.com/products/edge-storage)
