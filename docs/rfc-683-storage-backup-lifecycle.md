# [RFC #683] Google One으로 Supabase 사진을 비운다

> **상태 (2026-11-20 KST)**  
> Cursor · Antigravity **7항 합의 완료**. 디렉터 승인(복사 30일 · 삭제 60일).  
> **Phase 1(복사만, 삭제 OFF)** 은 `main` + 실DB에 반영·심야 cron 가동 중.  
> 이 PR(#684)은 합의 문서 SSOT다. 예전 “메신저만 파일럿 / 안전문서 절대 삭제 금지 / AES 필수” 초안은 **철회**한다.
>
> 관련 이슈: #683  
> 적용 원칙: 전 입주사 · 전 프로젝트 공통 (특정 회사 하드코딩 금지)  
> 보관소: **이미 있는 개인 Google One**. GCS·모두의 AI 디스크·Oracle Always Free는 대상이 아니다.

---

## 1. 목적

Supabase `attachments` 용량을 줄인다. 메신저 `chat/`(~31 MB)이 아니라 **현장사진·서명·안전문서·작업계획서 원본**(수 GB)이 본경로다.

---

## 2. 합의 7항 (Cursor ↔ Antigravity · 디렉터 승인)

1. **최근 30일** 파일은 Supabase에 둔다.
2. **30일이 지난** 일자별 현장사진·점검사진·TBM 사진·산안비 증빙·작업계획서 **원본** 첨부는 Google One 비공개 폴더로 복사한다. SHA-256이 일치하고 `gdrive_file_id`가 기록된 뒤, **60일이 지나면** Supabase 원본을 지운다. 지우기 직전에 체크섬과 Drive 메타를 한 번 더 확인한다.  
   - **유지(복사·삭제 제외)**: 활성 프로젝트 `site-maps` · `drone-maps`  
   - **`print-cache`**: Google One에 복사하지 않는다. 같은 화면을 다시 렌더해 페이지가 복구되는 것을 확인한 뒤에만 Supabase에서 지운다.  
   - 데이터베이스 행·문서 본문은 남긴다.
3. 토큰 만료·계정 잠금·쿼터 초과 시 **삭제는 즉시 멈춘다**. OAuth 클라이언트 ID 고정, 범위는 `drive.file`만.
4. **앱 레벨 AES는 이 단계에서 하지 않는다.** (키 분실 = 자료 분실)
5. 메신저 `chat/`은 **용량 대상이 아니다**. `is_self_chat` 판별과 전달본 참조 0 확인이 끝나기 전에는 채팅 파일을 지우지 않는다.
6. 서명 URL은 행에 저장하지 않는다. 삭제 전에 공통 리졸버(`archiveUrlResolver` + `restore-archived-attachment`)가 열람·PDF 인쇄에서 `storage_archive_registry` → Google One 단기 서명 URL로 복원해야 한다.
7. 백로그는 **심야 틱만**. 삭제 권한이 있는 일회성 잡은 두지 않는다. 첫 구간은 복사만 하고, 체크섬 표본이 맞은 뒤에 삭제를 켠다.

삭제 일수를 60→30으로 줄이는 것은 디렉터가 숫자만 바꿀 수 있다. 나머지 문장은 유지한다.

---

## 3. 실측 (합의·Phase 1 보고 시점)

| 구분 | 규모 (대략) |
| --- | --- |
| `attachments` 전체 | ~5천 건 / ~3.3 GB |
| 메신저 `chat/` | ~27 건 / ~31 MB |
| `work-plans` 원본 | ~3,155 건 / ~2.3 GB |
| `print-cache` | ~369 건 / ~398 MB (복사 제외) |
| `site-maps` + `drone-maps` | ~7 건 / ~38 MB (유지) |
| 30일+ 복사 대상(보고) | ~2,634 건 / ~1.39 GB |
| 60일+ 삭제 후보(보고) | ~1,428 건 / ~901 MB |

---

## 4. Phase 1 구현 현황 (`main` · 삭제 OFF)

이미 반영된 것:

- 테이블: `storage_archive_registry`, `storage_backup_runs`
- 버킷: `archive-restore-cache` (비공개)
- RPC: `list_archive_candidate_objects`, `check_archived_storage_paths` (도면·`print-cache`·`chat/` SQL 제외)
- `chat_rooms.is_self_chat`, `chat_attachments.storage_object_path` 분리
- Edge: `backup-storage-to-gdrive` (기본 `backup_only`), `restore-archived-attachment`
- 프론트: `src/lib/archiveUrlResolver.ts` + 열람·인쇄·메신저 경로 연동
- cron: `safenex-nightly-gdrive-backup` (KST 02:05~03:55, 10분, `purge_enabled: false`), restore-cache 정리
- 표본 E2E: 복사·검증 일치, 인쇄 복원 바이트 일치, `purged_cnt: 0`

코드 진입점:

- `supabase/functions/backup-storage-to-gdrive/index.ts` — body `purge_enabled`가 true일 때만 Stage 2 삭제
- `supabase/migrations/20261120105000_schedule_nightly_gdrive_backup.sql` — cron body에 `purge_enabled: false` 고정

---

## 5. 삭제 게이트 (디렉터가 매번 “켜줘” 하지 않게)

지금은 cron이 **항상** `purge_enabled: false`라서, 백로그가 다 복사돼도 사람이 다시 말해 주기 전까지 Supabase 용량이 안 줄어든다. 목표는 **한 번만 정책에 서명**하고, 이후에는 **조건이 맞으면 자동으로 삭제 틱이 돌고, 깨지면 자동으로 다시 끈다**.

### 5.1 권고안: 정책 래치 + 자동 무장/해제

| 요소 | 내용 |
| --- | --- |
| `purge_policy` (DB 1행) | `director_armed` (bool), `armed_at`, `armed_by`, `auto_purge_allowed` (계산/캐시), `copy_min_age_days` (기본 30), `purge_min_age_days` (기본 60), `canary_max_purge_per_tick` |
| 디렉터 한 번 | 관리 화면 또는 master-only RPC로 `director_armed = true`. **이게 “삭제 켜줘”의 유일한 수동 행위.** |
| cron | 하드코딩 `false` 대신 `director_armed && auto_purge_allowed`를 읽어 `purge_enabled`에 넣는다. |
| `auto_purge_allowed`가 true가 되려면 (모두) | (a) 60일+ **eligible** 후보 중 `backed_up`/`archived_purged`가 아닌 잔여 = 0 (또는 허용 오차 N건) · (b) 최근 **K=3**밤 백업 틱 `error_cnt=0` & `circuit_broken=false` · (c) `last_verified_restore_at`이 7일 이내 · (d) Drive 쿼터 &lt; 80% · (e) 회로차단기 미발동 |
| 자체 복원 헬스체크 | 사용자 열람에 의존하지 않는다. 심야 틱이 `last_verified_restore_at`이 6일 이상 지나면 `backed_up` 1건을 Drive에서 받아 SHA-256만 확인하고 시각을 갱신한다 (주 1회 상한). |
| 첫 삭제 밤 | canary **틱당 5건**. 카나리 밤이 **2밤** 연속 무오류면 틱당 **15건**으로 확대. |
| 자동 해제 | **치명**(`invalid_grant`/401/403/checksum_mismatch/복원 실패): `director_armed=false`까지 해제 + 알림. **일시**(5xx·타임아웃·쿼터 80~90%): `auto_purge_allowed`만 정지, 회복 후 자동 재개. |
| 알림 | 무장 직전 1회, 첫 purge &gt; 0 밤, 치명 해제 시. “매일 승인”은 없다. |

### 5.2 대안 (비권고)

- **A. 매번 수동**: 지금 방식. 디렉터 병목.
- **B. 날짜 하드코딩**: `purge_after = '2026-12-01'`. 백로그·복원 상태와 무관해 위험.
- **C. 복사 완료 즉시 자동 삭제(래치 없음)**: 한 번의 명시 서명 없이 프로덕션 삭제. 채택하지 않는다.

### 5.3 구현 순서 (승인 후)

1. `storage_archive_policy` (또는 `app_settings`) + master RPC `arm_storage_purge_policy` / `disarm_…`
2. `trigger_nightly_gdrive_backup()`가 정책·게이트를 읽어 body 구성
3. 게이트 판정 함수 + 복원 헬스 기록
4. 관리자 UI: 상태(무장/게이트/잔여 백로그/최근 틱)만 보여 주고, 버튼은 **한 번 무장 / 즉시 해제**
5. canary 상한 → 정상 상한

**이 절의 코드는 디렉터·Antigravity가 5.1에 동의한 뒤에만 넣는다.** Phase 1 삭제는 그때까지 OFF 유지.

---

## 6. 삭제 시 파일당 조건 (allowlist)

Stage 2는 아래를 **모두** 통과한 행만 지운다.

1. 경로가 백업 허용 도메인 (allowlist). 미등록·신규 경로는 `never_purge`
2. `archive_status = 'backed_up'`, `gdrive_file_id` 존재, `never_purge = false`, `legal_hold = false`
3. `source_created_at` ≤ now − `purge_min_age_days` (기본 60)
4. 직전 Drive `trashed = false` 및 SHA-256 일치
5. 회로차단기 정상
6. (메신저 대상이 열릴 때만) `is_self_chat = false` + 동일 `storage_object_path` 참조 0

`print-cache`는 Google One 경로가 아니다. 재생성 검증 후 별도 정리 잡.

---

## 7. 보안 · OAuth

- Consent: External + Production (`drive.file`만). Testing 모드 7일 refresh 만료 금지.
- Refresh token · client secret · `BACKUP_TRIGGER_SECRET` → Supabase Vault (`service_role`만).
- 폴더: `/SafeNex-Archive/{project|shared}/{domain}/{yyyy-mm}/…`
- AES-GCM 앱 암호화: **비대상** (7항 4번).

---

## 8. 로드맵

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| Phase 1 | 스키마·복사 워커·복원 리졸버·심야 복사, **삭제 OFF** | **완료 (가동)** |
| Phase 1b | 정책 래치 + 자동 게이트 + canary + 주 1회 자체 복원 헬스체크 (5.1) | **합의됨 · 구현 중** |
| Phase 2 | 60일+ 백로그 복사·표본 검증 완료 후, 무장된 정책으로 삭제 틱 가동 | 대기 |
| Phase 2c | 메신저: 참조 0 + `is_self_chat` 안정화 후 별도 allowlist (용량 본경로 아님) | 후순위 |
| Phase 3 | 필요 시 Workspace / 한국 리전 객체 스토리지로 provider 추상화 | 후순위 |

---

## 9. 합의된 숫자 · 남은 일

- §5.1 + 주 1회 자체 복원 헬스체크: **합의** (2026-11-20)
- K=3, canary=5 → 2밤 후 15: **합의**
- 치명 → `director_armed=false` / 일시 → `auto_purge_allowed`만: **합의**
- 남은 것: Phase 1b 구현 PR 머지, 디렉터의 **한 번** 무장, `print-cache` 정리 잡 일정

구현·머지 전에도 초기값 `director_armed=false`라 삭제는 OFF다. cron에 `purge_enabled: true`를 하드코딩하지 않는다.
