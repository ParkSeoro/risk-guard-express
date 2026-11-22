# 접근 권한 정책

사람이 정한 규칙만 적는다. 화면 버튼의 전체 표는 `src/hooks/useProjectAccess.ts`의 `PERMISSION_MATRIX`이고, 같은 표가 `src/test/permissions.matrix.test.ts`에 있다. 회사 범위와 RLS는 그 표보다 더 좁을 수 있다. 문서와 코드가 다르면 코드와 그 테스트가 맞다. 권한을 바꾸는 PR은 이 파일의 해당 줄과 변경 기록도 같이 고친다.

기준일: 2026-11-05. 이 날짜의 코드에 있는 규칙만 모았다.

## 소속

전역 역할은 마스터뿐이다 (`user_roles.role`). 그 외 역할은 현장마다 `project_members.role_new`다. A현장 권한이 B현장으로 넘어가지 않는다.

역할 이름은 `src/lib/permissions.ts`다.

| 코드 | 부르는 이름 | 설정 화면의 구분 |
| --- | --- | --- |
| `master` | 마스터 | 관리자 |
| `project_admin` | 프로젝트 관리자 | 관리자 |
| `safety_manager` | 안전관리자 | 관리자 |
| `site_manager` | 현장소장 | 관리자 |
| `supervisor` | 감리 | 관리자 |
| `site_supervisor` | 관리감독자 | 관리자 |
| `viewer` | 열람자 | 관리자. 아래 표에서는 읽기만 |
| `worker` | 근로자 | 근로자 |

한 계정에 관리 역할과 `worker`가 같이 있으면 설정 화면은 `관리자·근로 겸임`이다. 소속도 마스터도 없으면 `미배정`이다. 가입 승인 대기가 여기 들어간다.

회사 종류는 `src/lib/companyTypes.ts`다. `발주처`(`client`, `owner`), `시공사`(`gc`), `협력사`(`contractor`), `공급사`(`vendor`).

## 화면에서 누가 만들고 고치고 승인하나

기호는 만들기 / 수정 / 삭제 / 승인이다.

- 전: 네 가지 모두
- 삭제외: 만들기, 수정, 승인
- 승인제외: 만들기, 수정, 삭제
- 작성: 만들기, 수정
- 승인만: 승인
- 상신만: 만들기
- 읽기: 네 가지 모두 없음

마스터, 프로젝트 관리자, 안전관리자는 이 표 안에서는 같다. 결재만 삭제외이고 나머지는 전이다. 회사 신규 등록 승인처럼 마스터만 되는 일은 이 표 밖에 있다.

열람자는 모든 기능이 읽기다.

| 기능 | 현장소장 | 감리 | 관리감독자 | 근로자 |
| --- | --- | --- | --- | --- |
| 위험성평가 | 삭제외 | 읽기 | 승인제외 | 작성 |
| 작업계획서 | 삭제외 | 읽기 | 작성 | 작성 |
| 작업허가서 | 삭제외 | 승인만 | 승인만 | 읽기 |
| 안전점검 | 삭제외 | 작성 | 작성 | 읽기 |
| TBM | 승인제외 | 읽기 | 읽기 | 읽기 |
| 사고 | 승인제외 | 작성 | 작성 | 작성 |
| 산업안전보건관리비 | 읽기 | 읽기 | 읽기 | 읽기 |
| 법정 할 일 | 읽기 | 읽기 | 읽기 | 읽기 |
| 할 일 | 승인제외 | 작성 | 작성 | 작성 |
| 결재 | 승인만 | 승인만 | 승인만 | 상신만 |
| 회사, 구성원, 기준정보, 감사 로그 | 읽기 | 읽기 | 읽기 | 읽기 |

이 표는 버튼을 켜는 기준이다. 다른 회사 문서는 아래 범위에서 빠진다.

## 회사 범위

`src/lib/companyDocScope.ts`의 `companyDocScopeMode`.

- 마스터: 그 현장 전체
- 협력사, 공급사: 역할과 상관없이 자사만
- 시공사: 관리 역할은 자사와 하위 협력사. 근로자와 열람자는 자사만. 다른 시공사는 보지 않는다
- 발주처: 그 현장에 배정된 사용자는 그 현장 전체. 메신저 명단은 아래 별도 규칙이다
- 종류를 모르면 자사만
- `project_companies.client_safety_service`가 켜진 현장의 열람자만 그 현장 전체를 읽는다

공지 작성은 관리 역할과 마스터만 한다 (`canComposeAnnouncement`). 발주처와 시공사 관리자는 현장 전체를 대상으로 할 수 있다. 협력사는 자사와 하위만 고른다.

## 가입

- 근로자 QR 가입 `complete_worker_roster_signup`은 계정을 바로 `active`로 만든다. 관리자 승인을 기다리지 않는다.
- 그 외 가입은 `process_signup_company_selection`에서 `pending`이다. 관리자가 승인해야 `active`가 된다.
- 가입은 공개 디렉터리의 현장·회사이거나 초대 코드가 있어야 한다.
- 새 회사 등록 요청의 승인은 마스터만 한다 (`company_registration_requests`, `is_master`). 승인되면 회사 마스터와 그 현장 연결만 생긴다. 권한 행과 근로자 명부는 생기지 않는다.

## 메신저

`can_use_messenger`. 마스터, 또는 현장 역할이 프로젝트 관리자, 안전관리자, 현장소장, 감리, 관리감독자, 열람자인 사람만 쓴다. 근로자만 있는 계정은 열 수 없고 초대되지도 않는다.

명단과 초대는 같은 현장 소속이 기본이다. 그 현장에서는 메신저를 쓰는 역할이 회사와 상관없이 보인다. 프로젝트 관리자, 안전관리자, 현장소장, 감리, 관리감독자, 열람자다. 근로자는 빠진다. 배지는 그 현장 역할 이름이다.

예외는 둘이다. 발주처는 `companies.type`이 `client`, `발주처`, `owner`이고 `project_members.company_id`가 같으면 다른 현장 동료도 보인다. 다른 발주처 회사나 시공사·협력사의 다른 현장 사람은 보이지 않는다. 함수는 `messenger_shares_client_company`. 마스터는 선택한 현장의 그 명단을 그대로 보고, 다른 현장에서는 프로젝트 관리자만 더 본다.

그 방이 화면에 열려 있고 앱이 앞에 있는 동안에는 그 사람 푸시를 만들지 않는다. 방을 나가거나 앱을 내리면 다시 울린다. 그룹방을 만든 사람은 그 방을 참여자 전체에게서 지울 수 있다. 1:1 방은 지우지 않는다.

## 문서별로 더 좁은 규칙

- 위험성평가 상신은 지정된 작성 관리감독자 본인만 한다 (`canSubmitAssessmentRun`). 안전관리자는 법적 작성 주체가 아니다. 회차 만들기는 마스터, 관리감독자, 안전관리자, 프로젝트 관리자다.
- 산업안전보건관리비는 상신(`submitted`)이나 승인(`approved`)이면 항목과 첨부를 고치지 못한다. `source`가 `legacy_import`인 달은 항목별 증빙, 지급대장, OCR 관문을 타지 않는다.
- 안관비 결재선에는 작성자, 현장소장, 발주처 안전이 있어야 한다.
- 안전점검이 `completed`·`완료`·`승인완료`·`결재진행`이면 유형과 상관없이 본문·항목·조치·삭제·결재선이 잠긴다. 예외는 전역 마스터뿐이고, 그 예외는 DB 잠금 트리거에도 있다. 복제·인쇄는 그대로다.

## 위치 · 구역 경보 · 분포

- **구역 출입 경보 열람 (`worker_zone_events` SELECT)**: 마스터와 프로젝트 관리자(`project_admin`, 직책 `OWNER_PM`/`OWNER_CM`)는 현장 전체를 본다. 안전관리자·현장소장·감리·관리감독자(및 대응 직책)와 `client_safety_viewer`는 `can_read_company_data` 회사 범위(협력사 자사, 시공사 자사+하위, 발주처 현장 전체)만 본다. 일반 근로자(`worker`)와 비안전 열람자(`viewer`)는 목록을 열람하지 않는다.
- **구역 출입 경보 확인 (`worker_zone_events` UPDATE / ack)**: 위험구역 진입 푸시 수신 관리자와 **정확히 동일**하다 (`docs/zone-alarm-recipients.md`, `trg_zone_event_notify`). 마스터와 프로젝트 관리자(`project_admin`, `OWNER_PM`/`OWNER_CM`)는 현장 전체, 위반자 소속 회사의 안전관리자·현장소장·관리감독자(및 대응 직책 `SITE_MANAGER`/`HSE_MANAGER`/`OWNER_HSE`/`OWNER_SM`/`SITE_SUPERVISOR`/`SUPERVISOR`)는 **해당 회사(`pm.company_id = violator_company_id`)만** 확인 처리할 수 있다. `worker`와 `viewer`는 확인 처리할 수 없으며, 비마스터 UPDATE는 최초 확인 시 확인 필드(`acknowledged`, `acknowledged_by`, `acknowledged_at`, `ack_note`) 외 시스템 `notes` 포함 원본 컬럼 변경이 트리거로 차단되고, 이미 확인된 행의 확인 상태·확인자·시각·조치 메모(`ack_note`) 변경도 차단된다.
- **근로자 분포 (`get_worker_distribution_*`)**: 회사·구역·인원 집계와 익명 좌표만 노출하며(이름·전화 비노출), DB RPC가 선택 현장의 관리 역할(`master`/`project_admin`/`safety_manager`/`site_manager`/`supervisor`/`site_supervisor`)과 `can_access_company_data` 회사 범위를 함께 강제한다. PC 사이드바/`ContractorGate`·화면 `canView` 가드와 모바일 모두 선택 현장 관리 역할에 개방한다(협력사는 자사 범위만, 일반 근로자·열람자는 차단).
- **구역 출입 모니터링 (`/zone-events`)**: PC 사이드바·`ContractorGate`·라우트 `RoleGuard` 및 선택 현장 `canView` 가드 모두 관리 역할(`master`/`project_admin`/`safety_manager`/`site_manager`/`supervisor`/`site_supervisor`, 협력사 관리자 포함)에만 개방하며, DB RLS(`can_view_zone_event`/`can_ack_zone_event`)로 선택 현장 역할과 회사 범위를 강제한다.
- **위치 추적 점검 (`AdminTrackingHealth` / `get_gps_tracking_health`)**: PC 사이드바·`ContractorGate`·라우트 `RoleGuard` 및 선택 현장 `canView` 가드 모두 관리 역할(`master`/`project_admin`/`safety_manager`/`site_manager`/`supervisor`/`site_supervisor`, 협력사 관리자 포함)에 개방하며, DB RPC(`get_gps_tracking_health`)가 선택 현장의 관리 역할과 `can_access_company_data` 회사 범위(협력사 자사, 시공사 자사+하위, 발주처·마스터 현장 전체)를 강제한다. `worker`/`viewer`는 다중 현장 계정이더라도 선택 현장 역할이 관리 역할이 아니면 차단된다.

## 변경 기록

| 날짜 | 내용 |
| --- | --- |
| 2026-11-05 | 첫 기록. 코드에 있는 규칙만 모음. |
| 2026-11-13 | 모바일 셸에서 `viewer`를 읽기 전용(`worker` 버킷, 결재/메신저 미노출)으로 고정하고, 협력사 관리 역할의 `/vision-fleet` 접근 및 `시스템` 사이드바(`master`/`project_admin`/`safety_manager` 전용)와 `RoleGuard`를 일치시킴. |
| 2026-11-05 | 메신저: 열린 방은 푸시를 만들지 않음. 그룹방 만든 사람만 방 삭제. 마스터 명단은 전 현장 프로젝트 관리자. |
| 2026-11-05 | 메신저 명단: 마스터도 선택 현장의 전체 역할을 보고, 다른 현장은 프로젝트 관리자만 추가. 배지는 현장 역할. |
| 2026-11-15 | 법적업무의 안전보건대장·건진법 칸은 현장소장·감리·관리감독자를 포함한 관리 역할이 본다. 목록은 회사 범위(자사, 시공사는 하위 협력사, 발주처·마스터는 현장 전체)만. 대장 확인 완료는 발주처 관리자·프로젝트 관리자·마스터만. 건진법 작성은 현장소장·감리·프로젝트 관리자와 공사 직책. 관리감독자 권한만으로는 열람. |
| 2026-11-20 | Google One 보관·삭제 정책 화면(`/settings/storage-archive`)과 `arm_storage_purge_policy` / `disarm_storage_purge_policy` / `get_storage_purge_policy_status`는 마스터만. 초기값 무장 OFF. |
| 2026-11-21 | 안전점검 `completed`·`완료`·`승인완료`·`결재진행`은 전 유형·전 필드 읽기 전용. 수정·삭제·결재선 예외는 전역 마스터만이며 DB 트리거에도 같다. |
| 2026-11-22 | 위치·구역 경보·분포 접근 규칙 추가. `worker_zone_events` SELECT를 `workers.id` 직조인 + `can_read_company_data`로 수정하고, UPDATE(ack)를 위험구역 푸시 수신 관리자(`project_admin`/`OWNER_PM`/`OWNER_CM` 전역, `safety_manager`/`site_manager`/`site_supervisor` 및 대응 직책은 위반자 동일 회사 `pm.company_id = violator_company_id`만, `worker`/`viewer` 제외)와 정확히 일치시키며 원본 컬럼 불변 트리거를 추가함. |
| 2026-11-22 | 위치 관제 3화면(`/worker-distribution`, `/zone-events`, `/admin/tracking-health`)의 PC 메뉴·`ContractorGate`·`RoleGuard` 권한을 관리 역할(`master`/`project_admin`/`safety_manager`/`site_manager`/`supervisor`/`site_supervisor`, 협력사 관리자 포함, `worker`/`viewer` 제외)로 통일하고 자사/하위/전체 회사 범위는 DB RPC·RLS로 강제함. |
