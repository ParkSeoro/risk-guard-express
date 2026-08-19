# 넓은 건설현장 AI CCTV 통신망 조사 메모

## 확인한 근거

IP 영상의 end-to-end latency에서 네트워크 구간은 가장 예측하기 어려운 요인이며, camera bitrate 대비 사용할 수 있는 bandwidth가 부족할수록 지연과 receiver buffer가 커진다. 따라서 카메라 수가 늘어나는 현장에서는 평균 속도만 보지 말고, 장면 변화·야간 노이즈·I-frame burst를 포함한 실제 peak bitrate와 백홀 여유를 측정해야 한다. Axis는 네트워크 capacity가 제한될 때 H.264/H.265처럼 bitrate를 줄이는 encoding, 관리되는 LAN에서의 hop 최소화, WAN 구간 QoS와 guaranteed throughput의 필요성을 설명한다.[1]

건설현장은 임시 사무실·이동 장비·영상 감시·안전기기가 빠르게 변한다. LTE/5G cellular은 고정 회선이 들어오기 전 또는 이동형·원격 위치에서 빠르게 연결할 수 있고, edge computing은 latency-sensitive 워크로드를 현장에 남겨 통신 단절·지연의 영향을 줄이는 방식으로 제시된다.[2]

야외 Wi-Fi mesh는 설치 위치, 장애물, 가용 infrastructure, 예상 traffic, availability 요구조건에 따라 별도 설계가 필요하다. 특히 mesh backhaul은 각 hop에서 같은 radio가 송수신을 공유하면 throughput이 대략 반으로 줄 수 있어, Cisco는 hop을 3~4개로 제한하는 것을 권고한다. 그러므로 영상 카메라 백홀을 일반 Wi-Fi mesh 다중 hop에 계속 얹는 방식은 대규모 CCTV의 기본 설계로 적합하지 않다.[3]

## SafeNex에 적용할 결론

1. 고정 카메라가 밀집한 핵심 구역은 가능한 한 PoE 유선 access switch와 광/유선 백본을 우선한다.
2. 유선 포설이 어려운 고정 원격 구역은 line-of-sight를 확보한 point-to-point 또는 point-to-multipoint 산업용 무선 브리지를 사용하고, 다중 mesh hop은 예외로 제한한다.
3. 타워크레인·출입구 임시 동선·발파/토목 외곽·공사 단계에 따라 이동하는 카메라는 dual-SIM LTE/5G router 또는 cellular camera를 사용한다.
4. LTE/5G는 원본 상시 업로드 수단이 아니라 Vision Edge의 현장 AI 판단·event metadata/clip 업로드·Fleet heartbeat의 WAN 경로로 사용한다. 원본 장기 녹화는 현장 NVR/저장장치에 남긴다.
5. 셀룰러/브리지 단절 시에도 Vision Edge는 로컬 AI·NVR health·SQLite event spool을 계속 수행하고, 연결 복구 뒤 멱등 batch로 동기화해야 한다.

## 출처

[1] Axis Communications, *Latency in live network video surveillance*, 2024: https://whitepapers.axis.com/en-us/latency-in-live-network-video-surveillance

[2] Ericsson Cradlepoint, *Cellular Networking for Construction*: https://cradlepoint.com/industries/cellular-networking-for-construction/

[3] Cisco, *Wireless Mesh Access Points — Design Considerations*: https://www.cisco.com/c/en/us/td/docs/wireless/technology/mesh/8-0/design/guide/mesh80/m_design-considerations.html
