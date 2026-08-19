# Cursor 실행 프롬프트 — SafeNex Vision Fleet 웹·모바일 관제

아래 지시를 그대로 수행하세요. 이 작업의 범위는 **SafeNex 기존 웹·모바일 애플리케이션과 Supabase 백엔드**입니다. 현장 NVR에서 실행되는 Python Gateway 프로그램은 별도 `vision-edge/` 모듈이 담당하므로, RTSP 수신·NVR 비밀 저장·AI 추론·현장 경보를 웹에 구현하거나 웹에서 직접 실행하지 마세요.

## 0. 최우선 원칙

SafeNex는 전국 현장의 NVR을 직접 조작하는 원격 NVR 관리자 도구가 아닙니다. SafeNex Vision Fleet는 현장 **Vision Edge Gateway**의 상태·AI 안전 이벤트·정책·감사·승인된 배포를 중앙 운영하는 제품입니다.

다음은 절대 구현하지 마세요.

- 브라우저·Supabase Edge Function에서 현장 RTSP URL, NVR 관리자 비밀, ONVIF 비밀번호를 수집·저장·노출하는 기능
- 인터넷에서 현장 NVR 관리 포트, RTSP, SSH, RDP에 직접 접근하는 기능
- NVR 공장 초기화, 원본 녹화 삭제, 방화벽/공개 포트 변경, 안전 인터록 원격 해제 기능
- 일반 CCTV 단일 프레임을 근거로 안전고리·카라비너 미체결을 ‘확정’ 또는 처벌성 결과로 표시하는 기능

Vision Edge Gateway의 Master API 계약은 `reports/SafeNex_Vision_Fleet_NVR_Gateway_보안통신_API_연동규격서_초안_v0.1.md`를 읽고 따른다. 웹은 Gateway API를 직접 호출하지 않는다. Gateway는 outbound mTLS로 Master control plane에 연결하고, 웹은 SafeNex 권한 API를 통해 Fleet의 저장된 상태·이벤트·감사 기록만 조회·승인한다.

## 1. 현재 프로젝트 원칙을 먼저 확인

기존 SafeNex는 Vite + React + TypeScript + shadcn-ui + Tailwind, remote Supabase로 구성되어 있다. 현재 인증·회사 범위·프로젝트 범위·역할 가드 구현을 먼저 검토하고, Vision Fleet 기능도 기존 권한 SSOT와 RLS 패턴을 그대로 재사용하세요. 새로운 ‘관리자 우회 권한’을 프론트엔드에서 만들지 마세요.

기존 마스터·회사·프로젝트·현장 경계를 보존하고, 모든 Fleet row는 최소한 `company_id`, `project_id` 또는 `site_id`, `tenant/company ownership` 기준으로 범위가 명확해야 합니다. UI의 route guard는 편의 기능일 뿐이며, Supabase RLS와 RPC/Edge Function 서버 검증이 최종 권한 경계입니다.

## 2. 구현 목표

다음 네 가지를 구현하세요.

| 영역 | 목표 |
|---|---|
| Vision Fleet Console | 마스터·권한 있는 안전 운영자가 Gateway·NVR·카메라·AI 상태를 전국/회사/프로젝트/현장 기준으로 확인 |
| Safety Event Command | AI 안전 이벤트의 확인·오탐 표기·조치·담당자·SLA·감사 이력 관리 |
| Policy & Deployment | AI 정책/모델/Gateway release의 버전·승인·Canary·Pilot·Regional·Nationwide rollout 상태 관리 |
| Mobile Monitoring | 모바일에서도 현재 현장·카메라 상태, 고위험 이벤트, 승인된 짧은 재생 세션을 확인하고 조치 가능 |

제품 언어는 한국어이며, 기존 SafeNex 디자인 시스템을 존중하세요. 관제 화면은 진한 slate 기반의 전문 운영 UI로 설계하되, 과도한 카드·그림자·장식은 피하고 상태·심각도·책임·시간이 즉시 읽히게 만드세요.

## 3. 권한 모델

기존 역할 체계에 새 역할 또는 capability가 필요하면 최소 범위로 추가하세요. 아래 역할은 개념적 권한 분리이며, 실제 role enum과 기존 정책에 맞춰 mapping하세요.

| 역할 | 허용 범위 | 핵심 기능 |
|---|---|---|
| Platform Master | 전체 허용된 tenant/company | Fleet registry, 정책 템플릿, 전국 상태·감사, rollout 승인 |
| Security Operations Master | 전체 또는 지정 리전 | 이벤트 운영, 상태 진단 요청 생성, 모델 배포 요청 |
| Regional/Site Administrator | 지정 회사·프로젝트·현장 | 카메라 메타데이터, 현장 정책 적용 승인, 이벤트 조치 |
| Safety Manager | 지정 회사·프로젝트 | 이벤트 확인, 오탐/조치 기록, 규칙 요청. 전역 배포 불가 |
| Viewer | 명시적으로 허용된 범위 | 상태·이벤트 열람, 승인된 재생 세션만 사용 |
| Emergency Approver | 별도 최소 역할 | red 명령/배포의 2인 승인. 일반 운영 권한 최소화 |

모든 민감 조작은 UI 버튼 비활성화만으로 보호하지 말고, 서버 RPC 또는 Edge Function에서 사용자의 회사·프로젝트·현장 권한, 역할, 승인 조건을 검증하세요.

## 4. Supabase 데이터 모델과 RLS

아래는 권장 테이블이다. 현재 스키마와 충돌하는 이름이 있으면 기존 명명 규칙을 우선하되, 정규화와 tenant/site 격리를 유지하세요.

| 테이블 | 핵심 컬럼 | 목적 |
|---|---|---|
| `vision_gateways` | id, company_id, project_id, site_id, gateway_code, display_name, status, last_seen_at, capabilities, software_version, desired_state_version | Gateway registry와 health |
| `vision_nvrs` | id, gateway_id, display_name, vendor, read_only, status, last_seen_at | NVR 메타데이터. credential·RTSP URL 저장 금지 |
| `vision_cameras` | id, gateway_id, nvr_id, display_name, zone_name, status, last_frame_at, fps, ai_profile | 카메라의 비밀 없는 메타데이터 |
| `vision_safety_events` | id, company/project/site/gateway/camera IDs, event_type, severity, confidence, rule_outcome, requires_human_review, policy_version, model_version, occurred_at, evidence_ref | AI·장비 이벤트 |
| `vision_event_actions` | id, event_id, actor_id, action_type, note, created_at | 확인·오탐·조치·재오픈 이력 |
| `vision_policy_bundles` | id, version, digest, stage, status, content_ref, created_by, approved_by | AI 정책 bundle registry |
| `vision_deployments` | id, bundle_id, target_scope, rollout_stage, status, requested_by, approved_by, started_at, completed_at, rollback_of | 단계 배포와 rollback 추적 |
| `vision_command_requests` | id, target_gateway_id, type, risk_level, reason, approval state, expires_at, status, result_ref | Gateway에게 전달할 제한 명령의 ledger |
| `vision_audit_log` | id, actor, action, target_type/id, company/project/site scope, reason, request_id, metadata, created_at | 재생·설정·명령·승인 감사 |
| `vision_video_access_requests` | id, requester, camera_id, reason, status, expires_at, relay_session_ref | 승인된 짧은 재생 세션의 권한 기록 |

RLS 요구사항은 다음과 같습니다.

1. 모든 select/insert/update/delete는 기존 SafeNex 회사·프로젝트·현장 범위 helper와 일치해야 합니다.
2. `vision_gateways`, `vision_nvrs`, `vision_cameras`, `vision_safety_events`는 반드시 회사와 현장 귀속을 가진 row만 노출합니다.
3. 일반 사용자는 `vision_command_requests`, `vision_deployments`, `vision_policy_bundles`의 전역 row를 조회·생성·승인할 수 없습니다.
4. command/deployment/action 생성은 RPC 또는 Edge Function으로 만들고, 직접 insert는 필요한 최소한으로 제한하세요.
5. `vision_audit_log`는 일반 사용자 update/delete를 금지합니다.
6. evidence reference는 object storage path만 저장하며, 원본 영상이나 장기 재생 URL을 DB row에 저장하지 않습니다.

## 5. Master API와 Gateway 연계 백엔드

Gateway가 사용하는 공개 control plane endpoint는 별도 Master API를 통해 구현하세요. Supabase Edge Function을 사용한다면, gateway mTLS는 platform-level reverse proxy 또는 API gateway가 검증한 identity claim을 전달하는 모델을 문서화하세요. Edge Function 안에서 client certificate를 실제로 받을 수 없는 환경이라면, mTLS 종료는 앞단 API gateway에 두고 검증된 `gateway_id`, certificate thumbprint, scope claim만 신뢰 가능한 서명 header/JWT로 전달받도록 설계하세요.

Gateway endpoint는 사용자 session JWT와 절대 혼용하지 마세요.

| Endpoint | Gateway scope | 서버 처리 |
|---|---|---|
| `POST /v1/gateways/{gateway_id}/heartbeats` | `gateway.heartbeat` | mTLS/장치 token의 gateway·tenant·site 일치 확인 후 health upsert |
| `POST /v1/gateways/{gateway_id}/events:batch` | `gateway.events` | event ID 멱등 처리, ownership 검증, event insert 및 감사 |
| `GET /v1/gateways/{gateway_id}/desired-state` | `gateway.state:read` | 현재 rollout·gateway capability·승인을 반영한 서명 desired state 반환 |
| `POST /v1/gateways/{gateway_id}/command-acks` | `gateway.commands:ack` | command ledger 상태 transition 검증 및 감사 |

명령은 Master 사용자 API가 Gateway에 직접 접속해 전송하는 구조가 아니어야 합니다. 웹에서 생성된 command request는 server-side dispatcher/desired state에 기록되고, Gateway가 outbound polling 또는 WSS를 통해 수신합니다. 위험도별 정책은 다음과 같이 적용하세요.

| 등급 | 예시 | 서버 요구사항 |
|---|---|---|
| green | 상태 조회, 진단 요청, 카메라 읽기 연결 테스트 | 역할·현장 범위·감사 |
| yellow | ROI/AI 규칙 변경, policy apply, Gateway runtime restart | 현장 관리자 승인, version, rollback 조건 |
| red | model activate, alarm test, 다현장 rollout | 사유, 만료, 2인 승인, 현장 확인, 실행 전후 감사 |
| 금지 | NVR credential read, factory reset, recording delete, port open, interlock disable | API/UX 모두 구현하지 않음 |

## 6. 웹 화면과 UX

### 6.1 좌측 네비게이션

기존 관리자 셸의 역할 기반 네비게이션에 `Vision Fleet` 그룹을 추가하세요. 권한이 없는 사용자는 메뉴와 route 모두 접근 불가해야 합니다.

- Fleet Overview
- Safety Events
- Gateways & Cameras
- Policies & Rollouts
- Command Center
- Audit & Video Access

### 6.2 Fleet Overview

전국 지도는 필수가 아니며 지오펜스·GPS 기능과 결합하지 마세요. 대신 회사·프로젝트·현장 계층 filter, 상태 요약, last seen, online/degraded/offline, NVR·카메라 count, GPU/디스크/이벤트 spool 등의 테이블·상태 지표를 우선 구현하세요. 기본 화면은 라이브 영상 모자이크가 아니라 운영 상태·고위험 이벤트 큐여야 합니다.

### 6.3 Safety Events

이벤트 row에는 severity, 현장, 카메라, rule outcome, confidence, AI policy/model version, 발생 시각, human review 필요 여부, 현재 조치 상태를 보여 주세요. 상세 화면에서 확인·오탐·조치 완료·재오픈을 기록할 수 있어야 합니다. 고소작업 안전고리 관련 항목은 ‘확인 필요’ 보조 신호로 표시하고, 사실 확정·자동 처벌 UI를 만들지 마세요.

### 6.4 Policies & Rollouts

정책 bundle은 version/digest/stage/status가 보이는 registry로 만들고, rollout은 Canary → Pilot → Regional → Nationwide 단계로 관리하세요. rollout 화면에는 대상 Gateway 수, health gate, 성공/실패/rollback 수, 승인자, 변경 사유, 감사 링크가 필요합니다. 환경·카메라 조건 검증 없이 ‘전국 즉시 배포’가 기본값이 되면 안 됩니다.

### 6.5 Command Center

green/yellow/red 명령 유형, 대상 site/gateway, 사유, 만료 시각, 승인 상태, Gateway ACK timeline을 보여 주세요. red 명령은 2인 승인과 만료시간, 현장 확인 체크가 충족되기 전에는 dispatcher에 들어가지 않게 하세요. NVR에 직접 연결하거나 secret을 노출하는 UI는 만들지 마세요.

### 6.6 모바일 관제

기존 Capacitor/반응형 패턴을 유지해 다음 화면이 작은 화면에서 사용 가능하게 하세요.

- 내 권한 현장의 online/degraded/offline 상태
- 새 high/critical 이벤트와 담당·확인/조치 CTA
- 이벤트 evidence metadata 및 승인된 짧은 영상 재생 세션
- 보안상 허용된 범위의 event action 기록

모바일에서 전 현장 24시간 라이브 모자이크를 기본 제공하지 마세요. 영상 접근은 `vision_video_access_requests`로 사유·카메라·만료를 기록하고, 승인된 경우에만 relay session URL을 한 번 제공하세요. 재생 URL은 로그·URL query·DB에 장기 저장하지 마세요.

## 7. 디자인 요구사항

다음 방향으로 전문 CCTV/Fleet 운영 UI를 구현하세요.

- 딥 슬레이트/차콜 계열의 차분한 관제 톤, 고위험은 제한된 적색, 경고는 amber, 정상은 teal
- 명확한 표와 시간순 event timeline, compact filter bar, 선명한 상태 배지
- 정보 밀도는 높되, 라운드 카드·강한 그림자·화려한 애니메이션을 남용하지 않음
- desktop wide 화면에서는 상태 요약과 event queue를 같은 화면에, mobile에서는 우선순위 기반 세로 흐름으로 재배치
- 접근성: 색상만으로 severity를 전달하지 말고 텍스트·아이콘·라벨을 함께 제공
- 한국어 날짜·시간과 일관된 loading/empty/error state 제공

## 8. 테스트와 수용 기준

테스트를 추가하고 기존 테스트가 깨지지 않도록 하세요.

1. 권한 없는 사용자는 Fleet route, 각 회사/현장 row, 명령/승인 mutation에 접근할 수 없다.
2. 회사·프로젝트·현장이 다른 Gateway/event/camera는 RLS로 조회·수정할 수 없다.
3. event batch는 같은 `event_id`가 반복 전송되어도 중복 row를 만들지 않는다.
4. Gateway token의 gateway/site scope가 path 대상과 다르면 403이다.
5. desired state는 승인되지 않은 rollout, capability 불일치, 만료 상태에 대해 활성화되지 않는다.
6. red command는 2인 승인·사유·만료·현장 확인 없이 dispatcher에 들어가지 않는다.
7. audit log는 변경·삭제 불가이며, command/deployment/video access에 actor·scope·사유·결과를 남긴다.
8. 모바일 viewport에서 Fleet status와 high-risk event action을 사용할 수 있다.
9. RTSP URL, NVR password, Gateway private key, long-lived playback URL이 DB/API 응답/프런트 번들/log에 없다.
10. 기존 SafeNex 인증, 회사 범위, 관리자 라우트 테스트가 모두 유지된다.

## 9. 완료 보고 형식

구현 뒤에는 다음을 보고하세요.

- 생성/수정한 migration, RLS policy, RPC/Edge Function, route, component, test 목록
- Gateway API와 웹 테이블의 필드 매핑
- 실제 운영 전 남은 infrastructure 항목: mTLS 종료 API gateway, CA, signing key, media relay/VPN, object storage retention, NVR 호환성 랩
- 실행한 test/build/lint 결과와 기존 실패 항목을 구분한 결과

작업은 작은 커밋으로 나누고, migration마다 rollback 고려사항을 주석과 문서로 남기세요.
