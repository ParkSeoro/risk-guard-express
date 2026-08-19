# SafeNex Vision Edge 전국 확장 아키텍처

## 목적

이 문서는 수십~수백 현장에서 Vision Edge Gateway를 빠르고 안전하게 배포하기 위한 **C형 혼합 온보딩 모델**을 정의한다. 목표는 현장 직원이 Fleet URL, 긴 pairing code, 카메라별 RTSP 주소를 반복 입력하지 않아도 되게 하면서, 원본 영상·NVR 자격증명·Gateway 개인 키가 현장을 벗어나지 않도록 유지하는 것이다.

> **핵심 원칙:** 중앙 SafeNex는 현장 LAN에 직접 들어오지 않는다. 현장 Agent가 outbound TLS로 중앙에 연결하며, 현장 안에서만 ONVIF 탐색·자격증명 사용·RTSP 미리보기 변환을 수행한다.

## 운영 대안과 채택 모델

| 모델 | 설치 방식 | 강점 | 한계 | 적용 범위 |
|---|---|---|---|---|
| QR 현장 승인 | 프로그램 창의 QR을 스마트폰으로 스캔하고 관리자 승인 | URL·긴 코드 입력 제거, 모든 현장에 적용 가능 | 현장마다 한 번의 승인 필요 | 신규·소규모·예외 현장 |
| 설치 키트 자동 등록 | 본사가 현장·만료·정책이 묶인 설치 키트를 배포 | 무인·일괄 설치, Intune/GPO/USB에 적합 | 키트 발급·회수·감사 필요 | 반복 배포·대규모 현장 |
| **C형 혼합 모델** | 두 방식을 한 Agent에 제공하고 현장 LAN 자동 탐색 결합 | 규모와 현장 여건 모두 대응, 수동 입력 최소화 | 중앙 Fleet API가 두 흐름을 지원해야 함 | **SafeNex 표준 모델** |

C형 모델은 QR을 기본 fallback으로 유지하고, 본사 배포는 설치 키트를 우선한다. 이 조합은 동일한 mTLS enrollment 결과로 합류하므로 운영·감사·정책 관리가 분산되지 않는다.

## Agent·Console 분리

Windows 설치본은 두 개의 역할을 분리한다. **SafeNex Vision Edge Agent**는 Windows 서비스로 실행되어 AI 감시, 장비 health 점검, durable event spool, Fleet heartbeat, 정책 동기화를 수행한다. **SafeNex Vision Edge Console**은 사용자가 실행하는 독립 프로그램 창이며, Agent가 loopback에서 제공하는 UI만 표시한다.

| 구성 요소 | 실행 수명 | 책임 | 실패 시 영향 |
|---|---|---|---|
| Vision Edge Agent | Windows 시작부터 지속 실행 | 현장 AI·NVR 통신·암호화 비밀 저장·Fleet 동기화 | Service Control Manager가 재시작하며 중앙에 상태를 보고 |
| Vision Edge Console | 사용자가 열 때만 실행 | 관제·설정·QR 승인·로컬 진단 | 창/렌더러 재생성; Agent와 이벤트 수집은 계속 실행 |
| SafeNex Fleet Master | 중앙 관리 서비스 | 현장 귀속 승인·mTLS 인증서 발급·정책·상태·이벤트·감사 | 중앙 장애 시 Agent가 spool에 이벤트를 보존하고 재전송 |

Console은 외부 Chrome/Edge를 열지 않고 WebView2 Runtime이 포함된 독립 창에서 loopback UI를 보여 준다. WebView2 Runtime은 제품용 별도 Runtime이며, Microsoft Edge 브라우저 자체에 의존하지 않는다. Windows 11은 기본 포함하지만 일부 Windows 10/오프라인 장비를 위해 설치 프로그램은 Runtime 존재를 검사하고 부족하면 공식 Evergreen Runtime을 설치한다. WebView2 렌더러 오류는 Console만 재생성하며 Agent에는 영향을 주지 않는다. Microsoft는 browser process 종료·renderer 종료·unresponsive 이벤트에 대한 복구 처리를 권고한다.[1] [2]

## 1. QR 현장 승인 흐름

1. Agent가 현장 최초 실행 시 RSA 3072 private key와 CSR을 생성한다. private key는 ProgramData의 Agent 전용 암호화 저장소 밖으로 나가지 않는다.
2. Console 사용자가 `QR로 현장 연결`을 누르면 Agent가 Fleet의 device-authorization endpoint에 outbound HTTPS 요청을 보낸다.
3. Fleet은 짧은 user code, 10분 이내 만료 세션, `verification_uri_complete`를 반환한다. Console은 QR과 사람 확인 코드를 동시에 표시한다.
4. 안전관리자는 SafeNex 모바일 또는 웹에서 QR을 스캔하고 로그인·회사·현장·장치 표시명·장치 지문을 확인해 승인 또는 거절한다.
5. Agent는 서버가 준 interval과 `slow_down` 지시를 지키며 제한적으로 결과를 조회한다. 승인 시 Fleet은 CSR에 대한 client certificate, CA bundle, Master signing public key, token endpoint를 반환한다.
6. Agent는 mTLS 구성을 저장하고 heartbeat를 시작한다. Console과 SafeNex 웹은 동일한 Gateway ID를 표시한다.

이 흐름은 입력이 불편한 장치가 별도 스마트폰/PC에서 인가를 받는 OAuth 2.0 Device Authorization Grant의 모델과 QR 기반 verification URI optimization을 따른다.[3] user code를 화면에도 유지해 잘못된 장치를 승인하는 위험을 줄인다.

## 2. 설치 키트 자동 등록 흐름

본사는 SafeNex 웹에서 현장·장치 수·정책 그룹·만료 시각을 지정해 **Provisioning Kit**을 발급한다. 키트는 one-time bootstrap token, Fleet endpoint, 예상 현장, 만료 시각, 키트 식별자를 담고 중앙의 signing key로 서명한다. 원본 NVR 비밀번호나 Gateway private key는 키트에 넣지 않는다.

키트는 다음 세 가지 방식으로 전달할 수 있다. Intune/GPO에는 silent install parameter 또는 보호된 파일 배포를 사용한다. USB/오프라인 배포에는 암호화된 키트 파일을 사용한다. 현장 수동 설치에는 QR 또는 설치 파일 옆의 `.safenex-kit` 파일 import를 사용한다. Agent는 키트 서명, 만료, one-time 사용 상태, 현장 일치 여부를 확인한 뒤 CSR과 hardware fingerprint를 포함해 Fleet bootstrap endpoint에 claim을 요청한다. Fleet은 token을 즉시 소비하고 성공·실패·설치자·장치 지문을 audit ledger에 기록한다.

키트가 유출된 경우에는 Fleet에서 즉시 폐기할 수 있어야 하며, 이미 사용된 token을 다시 claim하면 거부해야 한다. 사용 전 탈취 위험을 낮추기 위해 token 수명은 짧게 유지하고, Master는 허용된 설치 수·현장·정책 그룹·장치 지문 규칙을 함께 검증한다.

## 3. 현장 자동 장비 발견

Agent의 `네트워크 자동 찾기`는 현장 LAN에서만 ONVIF WS-Discovery Probe를 전송한다. 발견 후보는 device service endpoint, 장치 유형, scope, 접근 주소, 응답 시간으로 표시한다. 사용자는 후보를 선택하고 **NVR 관리자 계정 한 번만** 입력한다. Agent는 자격증명을 암호화 저장한 뒤 ONVIF capability → media profile → stream URI를 조회하여 카메라 후보 목록을 만든다. 사용자는 카메라 이름·AI 프로필·활성 여부만 검토하고 일괄 승인한다.

ONVIF WS-Discovery는 UDP Probe로 ONVIF 가능 장비를 발견하는 표준 메커니즘이므로 현장 Gateway에 적합하다.[4] multicast가 VLAN·라우터를 넘지 않을 수 있으므로 중앙 Master가 직접 스캔하거나, 다른 현장에 있는 장비를 탐색하는 기능은 제공하지 않는다. 자동 탐색은 후보 제시·읽기 전용 검증만 수행하며 NVR의 네트워크 설정, 녹화, 사용자, 펌웨어를 변경하지 않는다.

## 4. 대규모 Fleet 운영 모델

중앙 Fleet은 Gateway를 `unclaimed`, `approval_pending`, `enrolling`, `online`, `degraded`, `offline`, `revoked` 상태로 관리한다. 현장 수가 많아질수록 전체 디바이스가 같은 시각에 재시작하지 않도록 heartbeat 및 reconnect에 random jitter를 적용하고, 이벤트는 현장 SQLite spool에서 idempotency key와 batch 전송으로 재시도한다. 대시보드는 회사·현장·정책 그룹·Gateway release·last seen·camera health·pending event depth를 기준으로 일괄 필터·업데이트한다.

정책은 안전한 JSON desired state로만 내려보내며 `dry-run → site canary → policy group rollout → fleet rollout` 순서로 확장한다. 긴급 중지는 중앙에서 새 AI rule activation을 멈추되 Agent가 RTSP를 삭제하거나 NVR을 변경하는 명령을 허용하지 않는다. Command는 Master Ed25519 서명, 대상 Gateway ID, 만료, 위험도, 승인 체인을 만족해야 한다.

## 5. Gateway API 확장 계약

| 용도 | Gateway 로컬 API | Fleet 중앙 API | 보안 경계 |
|---|---|---|---|
| QR 승인 시작 | `POST /api/v1/setup/onboarding/qr/start` | `POST /v1/gateway-device-authorizations` | CSR은 전달하되 private key는 현장에만 보관 |
| 승인 상태 | `GET /api/v1/setup/onboarding/status` | `POST /v1/gateway-device-authorizations/{id}/poll` | UI에는 short user code와 만료만 표시 |
| 설치 키트 import | `POST /api/v1/setup/onboarding/kit/claim` | `POST /v1/gateway-bootstrap/claim` | one-time token·서명·현장·만료 검증 |
| 장비 탐색 | `POST /api/v1/setup/discovery/onvif` | 없음 | UDP multicast는 현장 LAN에 한정 |
| 발견 카메라 승인 | `POST /api/v1/setup/discovery/onvif/{id}/approve` | metadata heartbeat에 반영 | RTSP·자격증명은 중앙에 전송 금지 |
| Fleet 상태 | `GET /api/v1/fleet/connection` | heartbeat / desired state | 인증서·token 원문을 UI에 금지 |

## 6. 도입 순서

먼저 QR 승인과 독립 Console·Agent를 Pilot 현장 3~5곳에서 운영한다. 그 다음 실제 NVR 벤더 2~3종을 대상으로 ONVIF discovery·profile·stream URI 호환성 랩을 완료한다. 이후 회사별 설치 키트 발급과 Intune/GPO silent deployment를 canary 그룹에서 검증하고, 마지막으로 policy group rollout·중앙 운영 대시보드·모바일 승인 알림을 전 현장으로 확대한다.

## References

[1] [Microsoft, Distribute your app and the WebView2 Runtime](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

[2] [Microsoft, Handling process-related events in WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events)

[3] [IETF RFC 8628, OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)

[4] [ONVIF Core Specification](https://www.onvif.org/specs/core/ONVIF-Core-Specification-v241.pdf)
