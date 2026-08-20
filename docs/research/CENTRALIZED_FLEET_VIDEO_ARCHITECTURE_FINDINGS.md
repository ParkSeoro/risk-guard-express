# 전국 중앙집중 CCTV 관제 조사 기록

## 핵심 결론

전국 현장의 영상을 중앙에서 단일 화면으로 보려는 목표는 타당하지만, **모든 카메라의 원본 고해상도 영상을 상시 중앙 NVR로 복제하는 방식**은 셀룰러·무선 백홀 현장에서 비용과 장애 영향을 크게 만든다. 따라서 현장 NVR/Gateway가 원본 녹화·AI 분석·단절 복구를 담당하고, 중앙에는 통합 카메라 디렉터리, 권한별 라이브 요청, AI 이벤트, 선택 clip, 저해상도 substream 및 중앙 장기보존 대상만 전달하는 계층형 Federation 모델이 적합하다.

Axis는 edge storage가 저대역폭 환경에 적합하며, 현장 device에 저장한 영상은 primary 또는 redundant storage가 될 수 있고 중앙 VMS가 사용할 수 없을 때도 녹화 손실을 줄인다고 설명한다.[1] 또한 local analytics와 edge storage는 대역폭·중앙 storage 비용을 낮추고, event가 발생했을 때 선택 데이터를 server로 보낼 수 있는 운영을 지원한다.[1]

## 아키텍처에 반영할 원칙

1. **중앙집중은 권한·디렉터리·관제 경험의 집중이다.** 모든 raw stream·NVR credential의 집중이 아니다.
2. **NVR 기록은 현장 primary이다.** 중앙 저장은 법정 보존·고위험 이벤트·사용자 지정 clip·low bitrate proxy에 한정한다.
3. **관제 요청은 on-demand이다.** SafeNex가 권한을 판단한 뒤 현장 Gateway에 time-boxed stream grant를 발급하고, 해당 연결만 중앙 relay 또는 direct VPN/relay를 통해 제공한다.
4. **셀룰러와 고비용 현장에는 media policy를 적용한다.** 평시 metadata/thumbnail/event-first, 사고 시 clip, 운영자 선택 시 substream, 승인 시에만 main stream을 허용한다.
5. **권한은 tenant → organization → site → zone → camera → action → time window 순으로 좁힌다.** 사용자의 browse, live, playback, export, evidence download, policy change 권한을 분리하고 전부 감사한다.
6. **중앙 장애도 현장 안전 감시를 멈추지 않는다.** 현장은 local NVR recording·AI·spool을 유지하고 중앙 복구 후 health/events/approved media를 동기화한다.

## 출처

[1] Axis Communications, Edge storage: https://www.axis.com/products/edge-storage
