# NVR 호환성 랩 (Phase A)

파일럿 전에 **실제 NVR 1~2종 + 카메라 2~3대**로 읽기 전용 검증한다. 이 문서는 지원 매트릭스 양식이다. 비밀·RTSP URL을 본사 DB나 Git에 넣지 않는다.

상태: 랩 체크리스트. SafeNex 웹 모듈과 무관.

## 완료 기준

1. Gateway PC(Ubuntu 24.04 또는 Windows)가 NVR과 **같은 VLAN**.
2. `ffmpeg` / `ffprobe` 설치.
3. 읽기 전용 계정으로 `ffprobe` health **OK**.
4. ONVIF WS-Discovery가 **LAN 전용**. 공인 IP XAddr은 버린다.
5. 비밀번호·RTSP가 `vision-edge.json`에 남지 않음 (`credentials/` + secret store만).
6. GetProfiles / GetStreamUri는 Gateway 로컬 API만. Fleet에는 카메라 이름·ID만.

## 명령 (현장 PC, 비밀 미기록)

```bash
ffprobe -v error -rtsp_transport tcp -show_streams -select_streams v:0 '<READ_ONLY_RTSP>'
```

로컬 Gateway:

```bash
curl -sS http://127.0.0.1:8787/api/v1/setup/discovery/onvif -d '{"timeout_seconds":3}'
```

## 지원 장비 표 (랩에서 채움)

| 벤더 | 모델 | 펌웨어 | 서브스트림 | 코덱 | ffprobe | ONVIF 검색 | 비고 |
|---|---|---|---|---|---|---|---|
| (예) Hikvision |  |  | 640x360 | H.264 |  | LAN | 읽기 계정만 |
| (예) Hanwha |  |  |  |  |  |  |  |

## 비밀 저장

- RTSP: `SecretStore` (`secrets/secrets.enc`)
- Fleet 토큰: `credentials/access.token` (chmod 600)
- config JSON: 카메라 secret ref만 (`camera:<id>:stream`)

## AI 실경보 전 FP/FN

낮/밤/역광·PPE 종류별로 측정한 뒤에만 `high` 푸시. 사이렌은 `alarm_interlock_enabled` + 현장 SM 승인 전 **거부**.
