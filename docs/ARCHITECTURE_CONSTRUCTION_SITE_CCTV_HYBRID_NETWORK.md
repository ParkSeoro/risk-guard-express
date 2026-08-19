# SafeNex Vision Edge 건설현장 하이브리드 CCTV 통신망 설계

## 결론

넓은 건설현장에서는 **유심 CCTV를 모두 Wi‑Fi로 바꾸거나, 일반 공유기를 여러 대 두는 방식**을 기본 전략으로 삼지 않는다. SafeNex 권고안은 고정 구역에는 유선 PoE와 point-to-point/point-to-multipoint 무선 브리지를 우선 사용하고, 공정에 따라 위치가 바뀌거나 유선 포설이 비경제적인 구역에는 dual-SIM LTE/5G를 사용하는 **하이브리드 망**이다.

> Wi‑Fi는 사람의 노트북·태블릿·휴대기기를 위한 접근망으로 분리하고, CCTV의 장거리 백홀은 전용 무선 브리지 또는 유선으로 설계한다. 원본 영상은 현장 NVR에 남기고, Vision Edge는 현장에서 AI 판단·상태 점검·이벤트 보존을 수행한 뒤 셀룰러/WAN으로는 이벤트와 필요한 짧은 증거만 전송한다.

## 1. 왜 일반 Wi‑Fi 공유기 증설만으로는 부족한가

영상 네트워크의 체감 품질은 광고상 최고 속도가 아니라 camera bitrate, 순간 burst, 실제 throughput, packet loss, backhaul hop, 지연과 jitter에 의해 좌우된다. IP 영상은 대역폭 대비 영상 bitrate 비율이 불리해질수록 지연과 수신 버퍼가 커지고, WAN 구간에서는 이를 더 예측하기 어렵다.[1]

일반 공유기를 여러 대 설치해 동일 SSID를 확장하는 방식은 근거리 무선 접속에는 유용할 수 있으나, 철골·콘크리트·타워크레인·차량·적치물로 시야와 반사가 수시로 바뀌는 공사장에서는 CCTV backhaul의 SLA를 보장하기 어렵다. 다중 mesh hop은 hop마다 처리량이 급격히 감소할 수 있으므로 영상의 기본 운반 경로로 쓰지 않는다.[2]

## 2. 권장 물리 토폴로지

```text
[고정 PoE 카메라] ─┐
                    ├─ [구역 PoE Switch] ── Fiber/Cat6/전용 무선 브리지 ─┐
[고정 PTZ/열화상] ─┘                                                     │
                                                                          ├─ [현장 NVR + Vision Edge]
[이동형/사각지대 카메라] ─ LTE/5G Router 또는 Cellular Camera ────────────┤
                                                                          │
[작업자 Wi‑Fi/태블릿] ─ 별도 SSID/VLAN/AP ───────────────────────────────┘
                                                                          │
                                                Dual-SIM 5G/LTE + VPN/Firewall
                                                                          │
                                                              [SafeNex Fleet]
```

| 계층 | 권장 기술 | 적용 구역 | 핵심 원칙 |
|---|---|---|---|
| 카메라 접속 | PoE Ethernet | 고정 출입구, 주요 동선, 사무동, 양중·위험구역 | 전원과 데이터 동시 공급, 카메라 VLAN 격리 |
| 장거리 구역 백홀 | 광케이블 또는 전용 PTP/PTMP 무선 브리지 | 동별 연결, 외곽, 가설 울타리, 야적장 | line-of-sight·fade margin·전용 주파수 설계, mesh hop 최소화 |
| WAN uplink | Dual-SIM 5G/LTE 라우터 + VPN | 현장사무소/NVR실, 고정 회선 미개통 현장 | 두 통신사·외장 안테나·자동 failover, inbound port 금지 |
| 이동형 카메라 | 5G/LTE camera 또는 5G router + PoE camera | 타워크레인, 굴착, 임시 출입구, 공정 이동 구역 | 현장 녹화·edge AI 우선, uplink는 event 중심 |
| 작업자 접속 | Enterprise outdoor Wi‑Fi AP | 태블릿, 안전 앱, 현장 사무 | CCTV VLAN과 별도 SSID·VLAN·QoS·권한 정책 |

## 3. 카메라 유형별 선택 기준

| 상황 | 우선 선택 | 보조/예외 선택 | 피할 방식 |
|---|---|---|---|
| 6개월 이상 고정, 카메라 밀집 | PoE + 광/유선 백본 | 전용 무선 브리지 | 카메라별 개별 유심 상시 전송 |
| 서로 떨어진 2개 동/야적장, 시야 확보 | PTP/PTMP 무선 브리지 + 구역 PoE switch | LTE/5G failover | 일반 AP mesh를 여러 hop 연결 |
| 공정 따라 이동, 전원·관로 불확실 | 5G/LTE router 또는 cellular camera | 배터리/태양광 + edge recording | 임시 공유기 중계 반복 |
| 출입구·안전 핵심 구역 | PoE + 이중 uplink | 5G backup | 단일 consumer Wi‑Fi/AP 의존 |
| 지하·철골·전파 음영 | 유선/광 또는 지향성 브리지 실측 후 설치 | carrier 외장 안테나/중계 | 지도상 신호만 보고 대량 설치 |

## 4. 유심 CCTV는 계속 사용할 수 있는가

**가능하다.** 단, 유심은 원본 영상 전체를 중앙으로 지속 송출하는 주 경로가 아니라, 원격·이동형 구역의 연결 수단과 현장 NVR/Vision Edge의 WAN uplink로 사용한다. LTE/5G는 건설현장의 빠른 개통과 이동성에 적합하며, edge computing은 지연에 민감한 분석을 현장에 남겨 연결 품질 변동의 영향을 줄이는 방식으로 활용된다.[3]

SafeNex 기준으로 유심 카메라는 다음 두 모델로 나눈다. 첫째, 카메라가 VPN으로 현장 NVR LAN에 안전하게 합류할 수 있으면 일반 IP camera처럼 NVR에 등록하고 Vision Edge가 읽기 전용으로 AI 분석한다. 둘째, 카메라가 사업자 cloud 전용 구조라 현장 NVR에 RTSP/ONVIF로 접근할 수 없으면 SafeNex AI 관제 대상이 아니라 별도 영상 조회 대상으로 분리한다. **구매 전 RTSP/ONVIF, 로컬 recording, VPN/사설 APN 호환성**을 반드시 확인한다.

## 5. 대역폭·품질 산정 방식

현장별 숫자는 카메라 해상도, fps, codec, 야간 노이즈, PTZ, scene motion, 녹화 방식에 따라 달라진다. 따라서 설치 전에는 카메라 제조사 고정값이 아니라 실제 현장에서 24시간 bitrate를 기록하고 peak를 기준으로 설계한다.

| 산정 항목 | 측정 방법 | 설계에 반영할 기준 |
|---|---|---|
| 카메라별 평균·P95·Peak bitrate | NVR/camera 통계 24~72시간 수집 | 평균이 아닌 P95/peak 합산으로 backhaul 선정 |
| 패킷 손실·jitter·RTT | 구역 switch/bridge/router telemetry | live preview와 AI ingest 품질 저하 원인 분리 |
| 셀룰러 uplink 성능 | 오전·점심·야간·우천 시 carrier별 speed/RTT 시험 | 단일 속도 측정이 아닌 시간대별 최저치 검토 |
| RF 가시선·SNR·fade margin | 설치 높이·장애물·계절/공정 변화 포함 site survey | 지향성 bridge의 mast·경로·예비 링크 선정 |
| 전원 지속성 | UPS/배터리 시간, PoE budget, 낙뢰·접지 | NVR·Gateway·core switch·router의 우선 보호 |

## 6. 네트워크 분리와 보안

CCTV·NVR·Vision Edge를 `CCTV VLAN`으로, 작업자 Wi‑Fi를 `STAFF VLAN`으로, 관리 장비를 `MGMT VLAN`으로 분리한다. CCTV VLAN에서 SafeNex로의 outbound HTTPS/VPN만 허용하고, 인터넷에서 NVR/카메라/RTSP 포트를 열지 않는다. 무선 브리지·switch·router는 별도 관리망과 고유 관리자 계정·MFA·구성 백업·펌웨어 관리 체계를 둔다.

Dual-SIM router는 서로 다른 통신사 SIM을 사용하고, WAN quality 기준으로 자동 failover한다. 현장 NVR/Gateway는 public IP가 아니라 outbound mTLS 또는 site-to-site VPN으로만 SafeNex Fleet과 통신한다.

## 7. Vision Edge 제품 보완 방향

Vision Edge는 통신망이 완벽하지 않다는 전제를 제품 기능으로 받아들여야 한다.

| 기능 | 현재 방향 | 추가 보완 |
|---|---|---|
| 이벤트 보존 | SQLite durable spool | link type·retry age·전송 지연·drop 여부를 현장/중앙에서 표시 |
| 연결 회복 | Fleet 재시도 | 셀룰러 failover와 맞춘 exponential backoff·jitter·batch limit |
| 영상 전송 | local MJPEG preview | WAN에서는 원본 상시 송출 금지, high-risk event에만 정책상 허용된 짧은 clip/thumbnail queue |
| 네트워크 상태 | camera health | WAN RTT/loss/jitter·SIM carrier·data cap·bridge link quality를 별도 telemetry로 수집 |
| 설치 UX | QR·Provisioning Kit·ONVIF 후보 탐색 | `네트워크 프로필`에서 wired/bridge/cellular 및 metered 여부를 선택하게 하고, cellular에서는 event-first mode 기본 |
| 중앙 운영 | Fleet heartbeat | 현장별 link type·last failover·offline reason·spool depth로 전국 통신 이상을 지도/목록에 표시 |

## 8. 현장 구축 순서

1. 도면에 고정·이동·안전핵심 카메라를 구분하고, NVR/Gateway/core router 위치를 먼저 확정한다.
2. 고정 핵심 구역은 PoE/광/전용 bridge 경로를 site survey로 설계한다. 일반 Wi‑Fi AP 개수부터 정하지 않는다.
3. 각 구역에서 24~72시간 bitrate, RF, carrier signal, uplink 품질을 측정한다.
4. CCTV VLAN·staff Wi‑Fi VLAN·관리 VLAN을 분리하고, dual-SIM WAN과 VPN/outbound-only 정책을 적용한다.
5. Vision Edge를 Provisioning Kit 또는 QR로 Fleet에 등록하고, NVR·카메라를 현장 LAN에서 읽기 전용으로 자동 발견·승인한다.
6. 3~5개 Pilot 구역에서 AI event, camera health, WAN failover, spool 재전송을 검증한 뒤 구역 단위로 확대한다.

## References

[1] [Axis Communications — Latency in live network video surveillance](https://whitepapers.axis.com/en-us/latency-in-live-network-video-surveillance)

[2] [Cisco — Wireless Mesh Access Points Design Considerations](https://www.cisco.com/c/en/us/td/docs/wireless/technology/mesh/8-0/design/guide/mesh80/m_design-considerations.html)

[3] [Ericsson Cradlepoint — Cellular Networking for Construction](https://cradlepoint.com/industries/cellular-networking-for-construction/)
