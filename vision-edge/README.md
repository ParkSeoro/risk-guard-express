# SafeNex Vision Edge

> **파일럿 / 비프로덕션.** 계약 SSOT는 [`docs/VISION_FLEET_SSOT.md`](../docs/VISION_FLEET_SSOT.md). 이 패키지는 기존 SafeNex 웹 모듈을 import하지 않는다. NVR을 대체하지 않는다.

SafeNex Vision Edge는 현장 NVR과 같은 LAN에서 실행되는 **지능형 AI CCTV Gateway**다. NVR의 연속 녹화와 증거 보존은 현장에 남기고, Gateway는 읽기 전용 영상 점검·AI 안전 이벤트·로컬 운영 상태를 처리한 뒤 SafeNex Vision Fleet에 안전하게 연결한다.

> 중앙은 가시성·정책·승인·감사를 맡고, 현장은 NVR 녹화·AI·경보의 안전 실행권을 유지한다.

## 현재 구현 범위

| 영역 | 구현 상태 | 핵심 내용 |
|---|---|---|
| 로컬 운영 UI | 구현 | Gateway loopback UI를 독립 Windows Console에서 표시한다. 외부 Chrome/Edge를 열지 않는다. |
| NVR 스트림 health | 구현 | 암호화된 로컬 비밀 저장소의 RTSP URL을 `ffprobe`로 읽기 전용 점검한다. |
| 이벤트 durable spool | 구현 | SQLite WAL에 이벤트를 먼저 저장하고, Fleet 전송 성공 후 ACK 처리한다. |
| AI 안전 규칙 | 구현 | 객체 추적·신뢰도·지속시간·cooldown을 결합해 PPE·위험구역·하네스 검토 이벤트를 만든다. |
| AI 모델 runtime | 확장 지점 | ONNX/DeepStream 등 **검증된 모델 artifact**를 붙일 수 있도록 inference와 정책 엔진을 분리했다. 모델·카메라 품질 검증 없이 실경보를 자동화하지 않는다. |
| Fleet API | 구현 | outbound HTTPS/mTLS, certificate-bound token, heartbeat·이벤트·desired state·command ACK 계약을 지원한다. |
| 명령 보안 | 구현 | Gateway 대상·tenant·site·만료·위험도·Ed25519 서명을 fail-closed로 검증한다. |
| 로컬 안전 명령 | 제한 구현 | 진단·카메라 읽기 점검만 실행한다. 재시작·모델 활성화·사이렌은 adapter·현장 interlock·승인이 구현되기 전까지 거부한다. |
| 제로터치 온보딩 | 구현 | QR 현장 승인, 1회용 Provisioning Kit claim, 현장 LAN ONVIF 후보 탐색을 지원한다. |
| 지속 실행 Agent | 구현 | Windows는 부팅 시 Agent가 AI·health·spool·Fleet 동기화를 유지하고 Console을 닫아도 감시가 계속된다. |
| systemd | 구현 | Linux에서 상시 실행·자동 재시작·권한 축소 서비스 정의를 제공한다. |

## 의도적으로 제외한 기능

이 Gateway는 NVR의 관리자 암호를 Master에 전달하지 않으며, NVR 공장 초기화·원본 삭제·공개 포트 개방·안전 인터록 원격 해제를 제공하지 않는다. 브라우저나 Master가 현장 RTSP에 직접 접근하는 구조도 제공하지 않는다.

안전고리·카라비너는 일반 광각 CCTV만으로 체결 여부를 확정하기 어렵다. 현재 규칙 엔진은 이 경우를 `harness_review_required`라는 **현장 확인 필요** 신호로 처리한다. 자동 사이렌 또는 처벌성 판단은 근접 카메라·검증 데이터·현장 승인·실험적 Pilot을 통과한 규칙에만 연결해야 한다.

## 빠른 시작: 개발·검증 모드

```bash
cd vision-edge
export VISION_EDGE_DEVELOPMENT=1
python3 -m pip install -e '.[test]'
vision-edge --config ./config/vision-edge.dev.json init --state-dir ./data
vision-edge --config ./config/vision-edge.dev.json validate
vision-edge --config ./config/vision-edge.dev.json run
```

개발 모드의 loopback UI는 `http://127.0.0.1:8787`에서 확인할 수 있다. Windows 현장 설치본은 외부 브라우저 대신 독립 Console 창을 열며, Agent는 Console과 별도로 지속 실행된다. 개발 모드에서만 Gateway가 암호화 비밀 저장소의 로컬 키를 생성할 수 있다. 운영 환경에서는 `VISION_EDGE_MASTER_KEY`를 systemd credential, TPM, HSM 또는 조직의 비밀 관리 절차로 주입해야 한다.

## 현장 설치 순서

현장 설치 전에는 NVR·카메라 모델, 펌웨어, 코덱, RTSP 읽기 계정, GPU·OS·디스크, 현장 VLAN과 outbound 443 정책을 확정해야 한다. 새 Gateway는 `unpaired` 상태로 시작한다. 설치 뒤에는 Console의 QR 현장 승인, 본사가 발급한 1회용 Provisioning Kit, 또는 복구용 수동 pairing 중 하나로 Fleet enrollment를 완료한다. RTSP URL은 JSON에 넣지 않고 암호화 secret store의 reference로만 연결한다.

`systemd/safenex-vision-edge.service`는 `/opt/safenex-vision-edge`와 `/etc/safenex-vision-edge` 표준 경로를 기준으로 한다. `scripts/install-local.sh`은 대상 장비에서 검토 후 실행하는 보조 도구이며, 설치 전에 조직의 비밀 관리 방식으로 `VISION_EDGE_MASTER_KEY`를 준비해야 한다.

## Fleet 연동

Gateway는 다음 Master API 계약을 사용한다.

| 기능 | API | 목적 |
|---|---|---|
| heartbeat | `POST /v1/gateways/{gateway_id}/heartbeats` | 장비·NVR·카메라·AI 상태 전송 |
| event batch | `POST /v1/gateways/{gateway_id}/events:batch` | AI·장비 이벤트의 멱등 전송과 ACK |
| desired state | `GET /v1/gateways/{gateway_id}/desired-state` | 서명된 정책·모델·롤아웃 상태 조회 |
| command ACK | `POST /v1/gateways/{gateway_id}/command-acks` | 검증된 명령의 수신·실행·rollback 결과 기록 |

자세한 API·mTLS·인증서·오류·감사 규격은 저장소 상위의 `reports/SafeNex_Vision_Fleet_NVR_Gateway_보안통신_API_연동규격서_초안_v0.1.md`를 따른다.

## 테스트

```bash
cd vision-edge
PYTHONPATH=src python3 -m pytest
python3 -m compileall -q src tests
```

테스트는 암호화 비밀 저장소, 이벤트 멱등 스풀, AI 지속시간·PPE·하네스 검토 규칙, Ed25519 명령 서명·대상·위험도 검증, FastAPI 로컬 상태 화면을 다룬다.

## 다음 Pilot 조건

실제 현장 배포 전에 다음을 충족해야 한다. 첫째, 대상 NVR·카메라 조합을 호환성 랩에서 읽기 전용으로 검증한다. 둘째, AI 모델 artifact와 탐지 클래스의 출처·해시·성능 기준을 등록하고 낮·야간·역광·PPE 종류별 오탐·누락을 측정한다. 셋째, Master의 mTLS token endpoint, device certificate CA, Ed25519 정책·명령 서명 키, audit storage를 배포한다. 넷째, 높은 위험의 AI 경보와 PA·경광등 연동은 현장 safety manager의 승인과 별도 interlock 시험을 통과한 뒤에만 활성화한다.

## 현장용 설치 파일: Ubuntu 24.04 amd64

배포 파일 `safenex-vision-edge_0.3.0_amd64.deb`는 **Ubuntu 24.04 amd64** NVR 인접 Gateway 장비용이다. 인터넷이 없는 현장에서도 Python 라이브러리는 패키지 안의 wheelhouse에서 설치되지만, 운영체제 차원의 `python3-venv`, `ffmpeg`, `systemd` 패키지는 사전에 준비되어 있어야 한다.

현장 사용자는 파일을 다운로드한 뒤 파일 관리자의 소프트웨어 설치 화면에서 열거나, 터미널에서 다음 한 줄을 실행하면 된다.

```bash
sudo apt install ./safenex-vision-edge_0.3.0_amd64.deb
```

설치 과정은 `safenex-vision-edge` 서비스를 자동 등록·기동하고, 암호화 비밀 저장소의 로컬 마스터 키와 기본 구성을 생성한다. Ubuntu 데스크톱 화면이 있는 장비에서는 애플리케이션 메뉴의 **SafeNex Vision Edge 관제**를 클릭하면 브라우저 운영 UI가 열리며, 터미널에서는 다음 명령을 실행한다.

```bash
safenex-vision-edge-ui
```

처음 표시되는 UI는 **로컬 안전 모드**로 시작한다. 본사 일괄 배포는 Provisioning Kit으로 지정 현장에 자동 등록하고, 개별 설치는 Console QR을 SafeNex 모바일로 스캔해 현장을 승인한다. Fleet enrollment 이후에도 NVR·카메라는 읽기 전용이며, ONVIF 자동 찾기는 현장 LAN에서만 수행된다. 중앙 연동은 mTLS 인증서·서명 키·AI 정책이 승인된 뒤에만 활성화된다.

제거하더라도 기본적으로 현장 설정과 이벤트 스풀은 보존된다. 완전 제거가 필요한 경우에만 `sudo apt purge safenex-vision-edge`를 사용한다.
