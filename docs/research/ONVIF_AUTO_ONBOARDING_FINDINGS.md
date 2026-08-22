# ONVIF 자동 온보딩 조사 메모

## 확인한 근거

ONVIF Core Specification은 장치 발견, 장치 관리, 미디어·이벤트 기능을 분리해 정의하며, 장치 발견에서 WS-Discovery의 Hello, Probe/Probe Match, Resolve 흐름을 명시한다. 따라서 Gateway는 현장 LAN에서 multicast Probe를 보내 ONVIF 지원 NVR·카메라의 device service endpoint를 후보로 수집할 수 있다. 이후 Device capabilities, Media profiles, GetStreamUri를 순서대로 조회하는 방식이 표준 기반의 자동 등록 후보 탐색 경로가 된다.

EdgeX Foundry의 ONVIF 카메라 문서는 WS-Discovery가 UDP Probe를 이용해 ONVIF 가능 장비를 네트워크에서 찾는 방식임을 설명한다. 이는 SafeNex Gateway에 자동 발견 기능을 넣는 선택을 뒷받침하지만, multicast가 VLAN·라우터를 넘지 않을 수 있으므로 현장 LAN 안에서 실행되는 Gateway에 적합하고 전국 중앙 Master가 직접 발견을 시도하는 모델에는 적합하지 않다.

## 설계 제약

자동 발견은 연결 후보와 메타데이터를 제시하는 기능이어야 하며, RTSP 사용자명·비밀번호의 자동 추측이나 NVR·카메라 설정 변경을 해서는 안 된다. ONVIF 자격증명은 각 현장의 설치 키트 또는 한 번의 NVR 관리자 입력으로 획득해 현장 암호화 저장소에만 넣고, 사용자가 검토·승인한 스트림만 등록해야 한다.

중앙 Fleet에는 NVR IP, ONVIF/RTSP 자격증명, 원본 스트림 URL을 전송하지 않는다. 중앙에는 Gateway 식별자·장비 지문·승인된 카메라 식별자·상태·AI 이벤트만 동기화한다.

## 출처

1. ONVIF Core Specification v2.4.1, device discovery와 device management 목차 및 표준 동작: https://www.onvif.org/specs/core/ONVIF-Core-Specification-v241.pdf
2. EdgeX Foundry, How does WS-Discovery work?: https://docs.edgexfoundry.org/4.0/microservices/device/services/device-onvif-camera/supplementary-info/ws-discovery/

## QR 기반 현장 승인 근거

RFC 8628 OAuth 2.0 Device Authorization Grant는 키보드·브라우저 사용이 불편한 인터넷 연결 장치가 별도 스마트폰 또는 PC에서 사용자 승인을 받도록 설계된 표준이다. 장치는 outbound HTTPS만으로 device code와 사람이 확인할 짧은 user code, verification URI를 받고, 사용자는 스마트폰으로 검증 URI를 열어 승인한다. RFC는 QR/NFC 같은 비문자 방식으로 `verification_uri_complete`를 여는 최적화도 허용하되, 원격 피싱 완화를 위해 화면에 user code를 함께 표시하고 사용자가 일치 여부를 확인하도록 권고한다.

SafeNex에는 이를 `현장 QR 승인`으로 적용한다. Gateway는 설치 뒤 Fleet 서버에서 10분 내외의 일회용 승인 세션을 만들고, 프로그램 화면에 QR과 여섯~여덟 자리 사람 확인 코드를 표시한다. 관리자는 SafeNex 모바일 또는 웹에서 QR을 스캔하고 회사·현장·설치 키트와 장치 지문을 확인해 승인한다. 승인 이후에만 Gateway가 CSR 기반 mTLS enrollment를 완료한다. 이 방식은 현장 직원이 Fleet URL과 긴 pairing code를 입력하지 않게 한다.

장치는 승인 대기 중 서버가 정한 최소 간격으로만 상태를 조회하고 지수적 backoff·만료·rate limit을 적용한다. 초기 부트에서 자동 폴링을 시작하지 않고, 사용자가 `QR로 현장 연결`을 눌렀을 때만 세션을 만들도록 한다.

추가 출처:

3. IETF RFC 8628, OAuth 2.0 Device Authorization Grant: https://datatracker.ietf.org/doc/html/rfc8628

## 독립 Windows Console 조사 근거

Microsoft WebView2는 외부 Microsoft Edge 브라우저를 의존하지 않고 별도 WebView2 Runtime을 사용해 앱 안에 웹 UI를 표시하는 생산용 구성이다. 현장 설치 파일은 런타임 존재 여부를 검사하고, 온라인 장비에는 Evergreen bootstrapper를 조건부 설치하며, 폐쇄망·오프라인 배포에는 Evergreen standalone installer를 번들 또는 설치 키트에 포함할 수 있다. Windows 11에는 Evergreen Runtime이 포함되지만 일부 Windows 10에는 없을 수 있으므로 설치 시 검사가 필수다.

안정성을 위해 WebView2 Console과 카메라 모니터링 Agent는 분리한다. WebView2 렌더러가 멈추거나 종료돼도 Agent의 FastAPI·AI·Fleet 백그라운드 처리는 별도 프로세스로 유지된다. Microsoft는 browser process 종료, renderer 종료, renderer unresponsive 이벤트를 처리해 control 재생성 또는 reload로 복구하도록 권고한다. SafeNex Console은 이 원칙에 따라 최대 2회 복구 후 안내 화면을 보이고, Agent health endpoint는 계속 감시한다.

pywebview는 Windows에서 Edge Chromium(WebView2 Runtime)을 우선 선택할 수 있으나, Edge Runtime 부재 시 구형 MSHTML로 떨어질 수 있다. 제품 요구사항에서는 MSHTML fallback을 허용하지 않고, WebView2 Runtime 검사 실패 시 설치 프로그램이 Runtime을 설치하거나 명확히 차단해야 한다. 초기 구현은 pywebview의 `edgechromium` 렌더러를 명시하고, 오프라인 현장은 installer가 WebView2 standalone runtime을 선행 설치하는 방식을 쓴다.

추가 출처:

4. Microsoft, Distribute your app and the WebView2 Runtime: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
5. Microsoft, Handling process-related events in WebView2: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events
6. pywebview, Web engine: https://pywebview.flowrl.com/guide/web_engine

## WebView2 설치 파일 배포 확인

Microsoft 공식 WebView2 배포 페이지는 Evergreen Bootstrapper가 장비 아키텍처에 맞는 Runtime을 다운로드·설치하는 작은 설치 프로그램이며, 폐쇄망에는 x86/x64/ARM64 Evergreen Standalone Installer를 제공한다고 명시한다. 따라서 SafeNex Windows installer는 온라인 현장에는 Bootstrapper를 조건부 실행하고, 오프라인 NVR 인접 PC에는 Standalone Installer를 별도 설치 키트 구성품으로 제공해야 한다. UI Runtime 미설치 때문에 외부 브라우저 fallback으로 전환하지 않는다.

7. Microsoft Edge WebView2 Runtime download: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
