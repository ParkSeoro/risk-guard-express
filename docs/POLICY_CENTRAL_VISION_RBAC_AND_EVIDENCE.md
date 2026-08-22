# SafeNex 중앙 Vision Fleet 권한·영상·증거 운영 정책

## 적용 원칙

SafeNex 중앙 관제는 사용자가 ‘전국 카메라’를 직접 소유하거나 RTSP URL을 받는 시스템이 아니다. SafeNex가 사용자의 조직·현장·구역·업무시간·행동 권한을 판정하고, 승인된 경우에만 기간 제한된 관제 세션을 제공하는 시스템이다. 모든 접근은 최소 권한, 단일 목적, 만료, 감사의 네 원칙을 지켜야 한다.

## 권한 단위

권한은 `tenant`, `organization`, `site`, `zone`, `camera`, `action`, `time_window`의 교집합이다. 예를 들어 협력사 현장소장은 자신의 회사가 배정된 특정 현장의 특정 작업구역만 작업 시간 동안 `live_substream`으로 볼 수 있다. 이 사용자는 다른 현장, 원본 main stream, 녹화 export, NVR 설정에 접근할 수 없다.

| Action | 설명 | 기본 역할 | 추가 조건 |
|---|---|---|---|
| `camera.discover` | 권한 범위 내 camera 목록·상태 보기 | 모든 관제 역할 | tenant/site scope 필수 |
| `live_substream` | 저비트레이트 실시간 관제 | Controller, Site Manager, 제한 Viewer | 5분 grant, watermark |
| `live_mainstream` | 고해상도 실시간 관제 | Central Controller | 사유 기록, metered policy 확인 |
| `playback` | 현장 NVR 녹화 재생 | Controller, Site Manager | camera/retention scope |
| `evidence.request` | 사건 시점 clip 추출 요청 | Site Manager, Controller | event ID 또는 사유 필수 |
| `evidence.export` | evidence file 다운로드·외부 반출 | Platform Admin, Auditor | dual approval + signed audit |
| `ptz.control` | PTZ 이동·presets | Central Controller | explicit camera allowlist + session lock |
| `camera.configure` | camera/NVR 등록값 변경 | Gateway local admin only | 중앙 사용자는 직접 변경 불가 |
| `policy.rollout` | AI policy/model/update rollout | Platform Admin | signed approval + canary policy |

## Live Stream Grant 규칙

각 live/playback 요청은 새 grant를 만들며, grant는 one camera, one action, one subject, one relay session에만 유효하다. 기본 TTL은 5분이고 SafeNex client의 foreground heartbeat가 없으면 Gateway/relay가 세션을 종료한다. browser/app은 raw RTSP, NVR password, site VPN address를 보지 못한다. 화면은 tenant·사용자·시간이 포함된 watermark를 표시하고, screen recording 방지 기능은 운영체제 한계상 보조 통제일 뿐 audit 대체 수단이 아니다.

## Evidence와 개인정보

AI event가 발생하더라도 main video를 자동 전국 배포하지 않는다. event type·severity·camera·time·blurred thumbnail을 먼저 제공하고, clip은 retention policy 또는 권한 있는 사용자의 reason-coded request에 의해 현장 NVR에서 추출한다. evidence object에는 event ID, camera ID, hash, retention class, access log를 붙인다. 정해진 retention 종료 뒤 삭제 job을 실행하되, legal hold가 있으면 삭제를 보류한다.

## 비상 접근(Break Glass)

인명 위험, 중대재해 조사, 재난 상황에는 `break_glass` 역할로 사전 범위를 넘어선 임시 live/playback을 허용할 수 있다. 이 경우 사용자는 reason·incident reference·전화 또는 다중 인증 확인을 제출해야 하고, 15분 이내 자동 만료한다. SafeNex는 보안책임자와 현장책임자에게 즉시 알리고, 모든 접근 record를 immutable audit stream으로 전송한다. break-glass는 NVR firmware 변경, 원격 녹화 삭제, credential 열람 권한을 부여하지 않는다.

## 감사와 탐지

모든 stream grant 발급/거부, 세션 시작/종료, playback seek, PTZ command, evidence request/export, role grant/revoke, retention hold, policy change를 audit 대상으로 한다. audit record에는 actor ID, effective role, tenant/site/zone/camera, action, grant ID, IP/device, timestamp, decision reason, correlation ID를 기록한다. 다음은 high-severity security event로 별도 알람한다.

| 탐지 조건 | 대응 |
|---|---|
| 짧은 시간 동안 다수 현장 camera enumerate | session rate-limit, security review |
| 만료·타인 grant replay | Gateway reject, token revoke, audit critical |
| 권한 밖 stream request | deny + user/site security analytics |
| 고해상도 stream의 장시간 셀룰러 사용 | policy hold, controller notification |
| 대량 evidence export | dual approval, immutable export log |
| break-glass 반복·사유 불충분 | automatic role hold, investigation |

## 권한 변경 운영

role grant/revoke는 SafeNex 중앙 identity provider에서만 처리한다. 현장 Gateway는 signed grant와 desired policy를 검증할 뿐 human role database를 보관하지 않는다. 사용자가 퇴사·협력사 계약 종료·현장 폐쇄 상태가 되면 중앙 revoke가 새 grant 발급을 차단하며, 이미 열린 세션도 revoke event 수신 시 종료한다.
