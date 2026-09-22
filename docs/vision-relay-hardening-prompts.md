# CCTV 중계 서버(MediaMTX) 보안 강화 — 작업 지시서

> 대상: `vision-relay/` (AWS Lightsail 배포), `src/lib/visionFleetApi.ts`, `src/pages/VisionFleet.tsx`
> 사용법: 아래 프롬프트를 단계별로 커서에 붙여넣습니다.

---

## 현재 구조 (코드로 확인)

```
VIGI 카메라 ──RTMP(평문)──▶ Lightsail  ┌─ MediaMTX :1935 수신 / :8888 HLS
   LTE·유동 IP                          └─ Caddy :443 (sslip.io 자동 HTTPS)
                                                 │
                                                 ▼ HLS
                                        SafeNex 브라우저 4분할 보드
```

- HLS는 **이미 HTTPS**입니다 (`visionVps.ts:42`, Caddy 자동 인증서). IP만 있어도 `1-2-3-4.sslip.io`로 인증서를 받습니다 — 잘 만들어진 부분이니 **건드리지 마십시오**
- `vision_cameras.playback_url`에 완성된 HLS URL을 저장하고 `<video>`에 직접 넣습니다

---

## 🔴 확인된 문제

### 1. MediaMTX가 완전 무인증

`vision-relay/mediamtx.yml` 전문:

```yaml
logLevel: info
rtmp: yes
hls: yes
hlsAddress: :8888
hlsAllowOrigins: ["*"]
hlsAlwaysRemux: yes
rtmpAddress: :1935
pathDefaults:
  source: publisher
```

`authMethod` · `publishUser` · `readUser` · `authHTTPAddress` · 경로 화이트리스트 **전부 없습니다.**

| 결과 | 내용 |
|---|---|
| **송출 무인증** | 1935로 **누구나 push 가능**. 같은 스트림 키로 밀어넣으면 관제 화면 영상이 바뀝니다 |
| **시청 무인증** | HLS URL만 알면 로그인 없이 어디서나 재생 |
| **임베드 무제한** | `hlsAllowOrigins: ["*"]` + Caddy `Access-Control-Allow-Origin *` → 아무 사이트에나 삽입 가능 |
| **포트 직접 노출** | `docker-compose.yml`이 `8888:8888` 바인딩 → Caddy 우회 접근 |

### 2. IP 제한을 쓸 수 없습니다

현장 카메라가 **LTE·유동 IP**라 소스 IP 화이트리스트가 불가능합니다(LTE는 통신사 CGNAT이라 IP가 공유·변동).

→ **송출 인증이 유일한 통제 수단**입니다. 1번을 반드시 해야 합니다.

### 3. 죽은 코드 / 문서 불일치

- `VisionMuxSetup.tsx`, `lib/visionMux.ts` — `VisionFleet.tsx`에서 import 안 함. **Mux는 안 씁니다**
- `VisionRelaySetup.tsx` — 마찬가지로 미연결
- grant 경로(`visionGrantTtlMs`, `VISION_LIVE_ACTION`, `VISION_LIVE_BITRATE_KBPS`) — **UI에서 호출하는 곳이 0건**. 실제 재생은 grant 없이 `playback_url` 직접 사용
- `docs/VISION_FLEET_SSOT.md`가 "grant 5분 / live_substream"이라고 하지만 코드는 30분 / mainstream이고, 애초에 grant가 안 불립니다

### 4. 확인 못 한 것

**Lightsail 콘솔의 방화벽 규칙은 저장소에 없습니다.** 1935·8888이 `0.0.0.0/0`으로 열려 있는지는 콘솔에서 직접 보셔야 합니다.

---

## ⚠️ 작업 전 반드시 알 것

**지금 CCTV가 정상 동작 중입니다.** 송출 인증을 켜는 순간 **기존 카메라 push가 즉시 끊깁니다** — 각 VIGI 카메라에 계정을 넣어 재설정해야 복구됩니다.

→ 현장 카메라에 접근 가능한 시간에 작업하고, 롤백 경로(이전 `mediamtx.yml`)를 준비한 뒤 진행하십시오.

---

## 프롬프트 1 — 송출 인증 (최우선)

```
risk-guard-express 의 CCTV 중계 서버에 송출 인증을 추가해줘.
배경은 docs/vision-relay-hardening-prompts.md 를 먼저 읽어봐.

═══ 상황 ═══
vision-relay/mediamtx.yml 에 인증이 하나도 없어서 1935 포트로 아무나
RTMP push 를 할 수 있어. 같은 스트림 키로 밀어넣으면 관제 화면의 영상이
가짜로 바뀌어. 현장 카메라가 LTE·유동 IP라 소스 IP 제한은 쓸 수 없고,
송출 인증이 유일한 통제 수단이야.

═══ 매우 중요 ═══
이 서버는 지금 실제로 CCTV 를 송출 중이야. 인증을 켜면 기존 카메라 push 가
즉시 끊기고, 각 VIGI 카메라에 계정을 넣어 재설정해야 복구돼.
그러니 코드를 바꾸기 전에 아래를 먼저 나에게 설명하고 승인받아:
- 어떤 설정을 넣을지
- 카메라 쪽에서 무엇을 바꿔야 하는지 (VIGI 설정 화면 기준으로)
- 롤백 방법

═══ 작업 ═══
vision-relay/mediamtx.yml 에 publish 인증 추가.

- MediaMTX 1.x 문법으로 작성할 것. 내가 문법을 불러주지 않을 테니
  bluenviron/mediamtx 공식 문서의 현재 버전 문법을 확인해서 써줘
  (authInternalUsers 방식이 적절할 것으로 보이는데, 판단은 너가 해)
- publish 는 인증 필수, read 는 이번 단계에서는 그대로 열어둘 것
  (read 인증은 프롬프트 3에서 별도로 다룸 — 한 번에 다 바꾸면
   문제 생겼을 때 원인을 못 찾아)
- 자격증명은 파일에 하드코딩하지 말고 환경변수로 받게 해줘.
  docker-compose.yml 과 start.sh 도 함께 수정
- start.sh 가 출력하는 안내문에 "VIGI 카메라에 넣을 계정/비밀번호"를
  포함시켜줘. 지금은 서버 주소와 스트림 키만 출력하고 있어

═══ 경로 제한도 함께 ═══
지금 pathDefaults: source: publisher 뿐이라 아무 경로 이름이나 생성돼.
rtmp://IP:1935/live/아무거나 로 새 스트림이 만들어져.
가능하면 경로를 제한하는 방법도 함께 제안해줘 (다만 카메라 추가 때마다
설정을 고쳐야 하면 운영이 번거로우니, 트레이드오프를 설명하고 물어봐).

═══ 건드리지 말 것 ═══
- Caddy 의 자동 HTTPS(sslip.io) 설정 — 잘 동작하고 있어
- visionVps.ts 의 URL 생성 규칙
```

---

## 프롬프트 2 — 노출면 축소 (저위험, 즉시 가능)

```
risk-guard-express 의 CCTV 중계 서버 노출면을 줄여줘.
프롬프트 1과 독립이라 먼저 해도 돼.

═══ 작업 1 · 8888 포트 직접 노출 제거 ═══
vision-relay/docker-compose.yml 이 mediamtx 의 8888 을 호스트에 바인딩해:

  ports:
    - "1935:1935"
    - "8888:8888"    ← 이것 때문에 http://IP:8888 로 Caddy 를 우회할 수 있어

Caddy 가 reverse_proxy mediamtx:8888 로 접근하니 도커 내부 네트워크만으로
충분해. 8888 바인딩을 제거하고 expose 로 바꿔줘.

제거 후에도 https://<HLS_HOST>/live/<키>/index.m3u8 가 정상 재생되는지
확인 방법을 알려줘.

═══ 작업 2 · CORS 제한 ═══
지금 두 군데가 전부 열려 있어서 아무 웹사이트에나 영상을 삽입할 수 있어:
- vision-relay/mediamtx.yml 의 hlsAllowOrigins: ["*"]
- vision-relay/Caddyfile 의 Access-Control-Allow-Origin *

SafeNex 도메인으로 제한해줘. 도메인은 환경변수로 받게 하고,
값을 모르면 나에게 물어봐. 프리뷰/스테이징 도메인이 따로 있으면
여러 개를 허용해야 할 수도 있어.

═══ 주의 ═══
CORS 를 잘못 좁히면 관제 화면에서 영상이 안 나와. 변경 후 반드시
브라우저에서 확인하고, 실패 시 롤백 방법을 알려줘.
```

---

## 프롬프트 3 — 시청 인증 (본체)

```
risk-guard-express 의 CCTV HLS 시청에 인증을 붙여줘.
프롬프트 1·2 가 끝나고 안정화된 뒤에 진행해.

═══ 문제 ═══
HLS URL(https://<host>/live/<키>/index.m3u8)만 알면 로그인 없이
어디서나 영구 재생돼. 개발자도구 네트워크탭에서 복사하면 끝이야.

어제 들어간 RLS(supabase/migrations/20260922020000_vision_camera_company_scope.sql)
가 회사별 격리를 아주 잘 해놨는데, 그건 DB 행만 막아. 영상 자체는 무방비야.
그 간극을 닫는 게 목표야.

═══ 방향 ═══
MediaMTX 의 외부 인증 훅(authHTTPAddress 계열)으로
SafeNex 엣지함수에 질의해서, 기존 RLS 판정을 그대로 재사용하는 구조.

  브라우저 재생 요청(토큰)
    → MediaMTX 가 엣지함수에 "이 사람 이 카메라 봐도 돼?" 질의
    → 엣지함수가 can_view_vision_camera 로 판정
    → 허용된 경우만 스트림 전달

재사용할 것:
- supabase/functions/vision-fleet (이미 /v1/... 제어면이 있음)
- can_view_vision_camera(user, project, company) RLS 함수
- vision_audit_ledger (append-only 감사 기록)

═══ 먼저 설계를 제안하고 승인받을 것 ═══
구현 전에 아래를 정리해서 나에게 보여줘:
1. MediaMTX 현재 버전이 지원하는 인증 훅 방식 (공식 문서 확인)
2. 브라우저가 토큰을 어떻게 전달하는지 (쿼리스트링? 헤더? hls.js 제약 확인)
3. 토큰 수명과 갱신 — 장시간 관제 중 끊기면 안 돼
4. 엣지함수가 다운되면 영상이 전부 끊기는데, 그 실패 모드를 어떻게 다룰지
5. 기존 playback_url 저장 방식을 바꿔야 하는지

═══ 참고 ═══
저장소에 grant 경로(vision_stream_grants, visionGrantTtlMs 등)가 이미
설계돼 있는데 UI 에서 한 번도 호출하지 않아. 이걸 되살려 쓸지,
아니면 더 단순한 방식으로 갈지도 함께 판단해서 제안해줘.
```

---

## 프롬프트 4 — 죽은 코드 정리 + 문서 갱신

```
risk-guard-express 의 CCTV 관련 죽은 코드를 정리하고 문서를 맞춰줘.

═══ 작업 1 · 미사용 코드 제거 ═══
VisionFleet.tsx 가 실제로 쓰는 건 VisionVpsSetup 뿐이야.
아래는 어디에서도 import 되지 않아 (테스트 제외):

- src/components/vision/VisionMuxSetup.tsx
- src/lib/visionMux.ts
- src/components/vision/VisionRelaySetup.tsx

우리는 Mux 를 쓰지 않아 (AWS Lightsail + MediaMTX 자체 운영).
삭제 전에 정말 아무 데서도 안 쓰는지 다시 확인하고(동적 import·테스트 포함),
관련 테스트 파일도 함께 정리해줘.

VisionRelaySetup 은 VPS 방식과 용도가 겹치는지 먼저 확인하고,
애매하면 나에게 물어봐.

═══ 작업 2 · SSOT 문서 갱신 ═══
docs/VISION_FLEET_SSOT.md 가 "유일한 계약"이라고 선언해놓고 실제와 달라:

| 문서 | 실제 |
|---|---|
| Stream grant 5분 / live_substream | 코드는 30분 / live_mainstream, 게다가 UI 가 grant 를 호출 안 함 |
| Media relay 는 파일럿 스텁 | AWS Lightsail + MediaMTX 실경로가 운영 중 |

실제 구조(VIGI → LTE → Lightsail MediaMTX → Caddy HTTPS → 브라우저 HLS)를
반영해서 갱신해줘. 문서가 틀리면 다음 사람이 잘못된 전제로 작업해.

═══ 작업 3 · http 허용 여부 정리 ═══
src/lib/visionFleetApi.ts 의 visionSafePlaybackUrl 이 http: 를 허용해.
VPS 경로는 항상 https 라 문제없지만, 수동 입력 경로로 http URL 이 들어오면
HTTPS 페이지에서 혼합 콘텐츠로 차단돼서 "송출 대기"만 뜨고 원인이 안 보여.

https 만 허용하도록 좁힐지, 아니면 http 를 허용하되 UI 에 경고를 띄울지
판단해서 제안하고 진행해.
```

---

## 건드리지 말 것

- **Caddy 자동 HTTPS(sslip.io)** — IP만으로 인증서를 받는 구조, 잘 동작함
- `visionVps.ts`의 URL 생성 규칙
- 어제 들어간 회사 격리 RLS (`20260922020000`)
- `visionEventSirenAllowed` — SSOT의 "interlock 전 사이렌 금지"를 지키고 있음

---

## 별도 확인 사항 (코드 밖)

| 항목 | 확인처 |
|---|---|
| 1935·8888 방화벽 범위 | **Lightsail 콘솔** — 저장소에 없음 |
| LTE 데이터 사용량 | 송출 비트레이트는 **VIGI 카메라 설정**에 있고 이 시스템은 값을 모름. 24시간 송출이면 회선 요금 확인 필요 |

> 참고: 코드의 `VISION_LIVE_BITRATE_KBPS = 4096`, `live_substream = 700`은 **grant 경로 전용이라 실제 송출에 영향이 없습니다.** LTE 비용을 줄이려면 카메라 쪽 비트레이트를 낮추는 수밖에 없습니다.

---

## 진행 체크리스트

| # | 내용 | 위험도 | 상태 |
|---|---|---|---|
| 1 | 송출 인증 (카메라 재설정 필요) | 높음 — 작업 중 영상 끊김 | ☐ |
| 2 | 8888 노출 제거 + CORS 제한 | 낮음 | ☐ |
| 3 | 시청 인증 (엣지함수 연동) | 중간 | ☐ |
| 4 | 죽은 코드 정리 + 문서 갱신 | 낮음 | ☐ |

**권장 순서: 2 → 1 → 4 → 3**
2번이 가장 안전하면서 효과가 있고, 1번은 카메라 접근 가능한 시간에, 3번은 안정화 후에.
