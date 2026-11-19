# [RFC #683] Google One(Drive) 장기 백업 및 메신저 3개월 보관 주기 아키텍처

> **주의**: 본 문서는 **설계 토론 및 합의용 RFC**입니다. Cursor · Antigravity · GitHub 리뷰를 통해 최종 합의안을 확정한 뒤, **디렉터(박서로님) 최종 승인 후**에만 구현을 시작합니다.
>
> 관련 이슈: #683  
> 적용 원칙: **전 입주사 · 전 프로젝트 공통 멀티테넌트 표준** (특정 회사 하드코딩 금지)

---

## 1. 배경 및 현재 Storage 실측 현황 (2026-11-18 기준)

- `attachments` 버킷: 총 5,033건 / 약 **3,313 MB**
  - 메신저(`chat/...`): 27건 / 31 MB
  - 안전문서·현장사진·서명 등: 5,006건 / 3,282 MB (60일 경과 1,769건, 90일 경과 53건)
- `app-updates` 버킷: `publish-ota-release` v20에서 플랫폼별 최신 10개 유지 자동 정리 적용 완료
- `project-library`: 22건 / 119 MB · `official-letters`: 1건 / 1.47 MB

---

## 2. 실제 코드 전수 분석에서 발견된 핵심 엣지케이스

`architect` · `security-legal` · `verifier` 3개 에이전트가 실제 코드베이스(`messengerApi.ts`, `messengerAttachmentActions.ts`, `messengerType.ts`, `MessageBubble.tsx`, `MessengerRoomDrawer.tsx`, `compressUploadFile.ts`, `pdfRender.ts`, `ownerOfficialLetters.ts`, `ProjectLibrary.tsx`, `electron/main.cjs`, `supabase/migrations/`)를 교차 검증하며 확인한 핵심 사실:

1. **`chat_attachments` 구조 & 전달(Forward) 참조 공유**
   - `chat_room_messages`에는 `attachment_url`이 없고 별도 `chat_attachments` 테이블에 저장됨 (`src/lib/messengerApi.ts:57-69, 563-574`).
   - 메신저 전달(`forwardChatParts` in `src/lib/messengerType.ts:36-57`, `MessengerForwardDialog.tsx:49-50`) 시 **객체 복제 없이 원본 `public_url`을 재사용**함.
   - 따라서 **동일 객체 참조 카운트가 0(타 방·나와의 채팅 참조 없음)인지 검증하지 않고 90일 삭제하면 타 방 첨부가 깨짐** → 참조 카운트 0 검증 필수.
2. **`is_self_chat` 오판 위험**
   - 현재 `20261117101800_messenger_self_chat_rpc.sql:19-32`와 `messengerApi.ts:284`는 `left_at IS NULL` 활성 참여자 1명 기준으로 판별하므로, 1:1 DM에서 상대가 퇴장해도 나와의 채팅으로 오판될 수 있음.
   - 해결: **`chat_rooms.is_self_chat boolean` 명시 컬럼 추가** (신규 생성 시 세팅 + 기존 방은 누적 참여자 1명 & `project_id IS NULL` 기준 백필).
3. **모바일(Android/iOS Capacitor) · PC(Electron) · 웹 다운로드 호환**
   - 모바일은 `messengerAttachmentActions.ts:27-34`가 `window.open(url, "_system")`으로 외부 브라우저를 열어 JWT 헤더 전달이 불가함.
   - PC(Electron)은 `fetch`→Blob 저장 및 `electron/main.cjs:659-680` `shell.openExternal`로 `https://` Signed URL 처리 가능.
   - `MessengerRoomDrawer.tsx:368-427`은 현재 직접 `<a href>` 사용 중 → 공통 복원/다운로드 핸들러 통합 필요.
   - 해결: Edge Function 직접 스트리밍 대신, JWT·방 참여 권한 검증 후 **`archive-restore-cache`(private 버킷)에 임시 복호화 복원 → 5분 TTL Signed URL(`download: fileName`) 반환**.
4. **라이브 DB 스키마 사전 덤프 필요**
   - `chat_attachments` DDL과 `chat/` 대상 `storage.objects` 정책은 로컬 `supabase/migrations/`에 미포함 → Phase 0에서 라이브 DB 스키마·제약(`storage_provider` CHECK, `public_url` NOT NULL 등)·정책 전수 덤프 후 마이그레이션 코드화 선행.

---

## 3. 기능별 백업 · 보관 주기 매트릭스 (전 입주사 · 전 프로젝트 공통)

| 구분 | 버킷 / 경로 패턴 | Google Drive 백업 | Supabase 원본 삭제 | 비고 |
| :--- | :--- | :--- | :--- | :--- |
| **일반 메신저 첨부** | `attachments` / `chat/{roomId}/...` (`is_self_chat = false`) | **D+60** 증분 백업 | **D+90** 삭제 (6중 검증 통과 시) | 텍스트·안전문서 공유카드는 DB 영구 유지 |
| **나와의 채팅 첨부** | `attachments` / `chat/{roomId}/...` (`is_self_chat = true`) | **D+60** 증분 백업 | **90일 삭제 제외** *(365일 vs 영구: 미결 결정)* | `chat_rooms.is_self_chat` 명시 식별 |
| **법적 안전문서·서명·현장사진·산안비·MSDS·도면** | `attachments` 내 `{projectId}/(tbm\|worker-sign\|accidents\|incidents\|work-stop\|safety-inspection\|mobile-inspect\|inspection-actions\|work-plans\|chemicals\|site-maps\|drone-maps)/...`, `worker-photos/...`, `feedback/...`, `safety-cost/...` | D+7~30 증분 미러 | **절대 삭제 금지 (`never_purge = true`)** | 산안법 3~30년·산안비 5년·분쟁 5~15년 보존 |
| **작업계획서 PDF 인쇄 캐시** | `attachments` / `{projectId}/work-plans/{planId}/print-cache/...` | 백업 제외 | 미접근 **D+60** 폴더 단위 원자적 삭제 | `meta.json` 포함 폴더 단위 정리 (`pdfRender.ts`) |
| **공개 자료실** | `project-library` / `{projectId}/{userId}/...` | 증분 미러 | **절대 삭제 금지 (`never_purge = true`)** | 사용자 수동 삭제는 기존 로직 유지 |
| **발주처 공문** | `official-letters` / `{userId}/{uuid}.{ext}` | 증분 미러 | **절대 삭제 금지 (`never_purge = true`)** | `owner_official_letters.project_id`→`company_id` 역추적 테넌트 분리 |
| **OTA 앱 업데이트** | `app-updates` | 제외 | 제외 | `publish-ota-release` 최신 10개 자동 정리 |

---

## 4. 법적 무손실 삭제 (Allowlist-Only) & 보안 · PIPA · OAuth 2.0 통제

### Allowlist-Only 6중 검증 삭제 규칙
- **미등록 경로·신규 모듈·고아 객체**는 무조건 `never_purge = true` (자동 삭제 대상 절대 불가).
- 일반 메신저 첨부 D+90 삭제는 아래 **6가지 모두 통과** 시에만 실행:
  1. `chat_rooms.is_self_chat = false`
  2. 동일 `storage_object_path`를 참조하는 다른 방(`chat_attachments`) 건수 = 0
  3. `legal_hold = false`
  4. `archive_status = 'backed_up'` & 백업 완료 후 30일 이상 경과
  5. Drive API 원격 재조회: `trashed = false` 및 `sha256Checksum == ciphertext_sha256` 일치
  6. Circuit Breaker 정상(인증/쿼터 오류 없음)

### 멀티테넌트 격리 & 암호화 & OAuth 2.0
- **Drive 폴더 격리**: `/SafeNex-Archive/{env}/{company_id|shared}/{project_id|personal}/{bucket}/{domain}/{yyyy-mm}/{object_key}`
- **암호화 & 이중 해시**: Drive 업로드 전 **AES-256-GCM 앱 레벨 암호화**(Vault KEK + HKDF DEK, `key_version`·`iv` DB 기록) + **`plaintext_sha256` / `ciphertext_sha256` 이중 해시**.
- **Google OAuth 2.0 안전장치**:
  - Consent Screen **External + Production 전환 필수** (Testing 모드 7일 Refresh Token 만료 함정 차단).
  - 최소 권한 스코프 **`https://www.googleapis.com/auth/drive.file`**만 사용.
  - Refresh Token·KEK는 기존 `get_runtime_secret`(`read-official-letter/index.ts:26`) 패턴으로 **Supabase Vault에만 보관** (클라이언트 노출 0).
  - 개인 Google One 계정은 서비스 전용 계정 + 하드웨어 2FA + 복구코드 금고 보관 + 개인정보처리방침 위탁(제26조)·국외이전(제28조의8) 고지 선행.

---

## 5. 트래픽 · DB I/O · 장애 방지 프로토콜

- **심야 마이크로 배치 (KST 02:00~04:00 / UTC 17:00~19:00)**:
  - `pg_cron` → `pg_net` → Edge Function (`verify_jwt = false` + `X-Backup-Trigger-Secret` 공유 시크릿 검증).
  - `pg_advisory_lock` 단일 실행 보장, `FOR UPDATE SKIP LOCKED` 큐 + 커서 페이징.
- **Deno OOM/타임아웃 방지**: 최대 파일 20MB(`compressUploadFile.ts:8`) + 암호화 버퍼 고려해 **동시성 1(순차 스트리밍), 1틱 45초 / 50~100MB 상한**.
- **Quota & Circuit Breaker**:
  - 매 틱 시작 시 `drive.about.get(fields="storageQuota")` 선검증: **80% 경고, 90% 도달 시 신규 백업 중단**.
  - `invalid_grant` / `401` / `403` / `storageQuotaExceeded` 발생 시 **Phase 2 삭제 전면 동결 + 즉시 관리자 경보**.
  - 실패 시 최대 5회 지수 백오프 후 `deadletter` 격리 (삭제 미진행).

---

## 6. 단계별 실행 로드맵

1. **Phase 0 (사전 준비·법적 선행)**: 라이브 DB `chat_attachments`/`storage.objects` 스키마·정책 덤프, 전용 Google 계정·하드웨어 2FA·OAuth External+Production(`drive.file`) 설정, Supabase Vault 시크릿 등록, 개인정보처리방침 국외이전/위탁 고지.
2. **Phase 1 (DB 스키마 & D+60 백업 워커 — 삭제 OFF)**: `storage_archive_registry`, `storage_backup_jobs`, `chat_rooms.is_self_chat`, `chat_attachments` 확장 컬럼, `archive-restore-cache` private 버킷 생성. **백업 전용(Dry-run 삭제)**으로 30일 안정성·이중 해시·Quota 검증.
3. **Phase 2 (복원 UX & D+90 삭제 활성화)**: `restore-archived-attachment` Edge Function + `MessageBubble`/`MessengerRoomDrawer`/`MessengerChatPane`/`MessengerForwardDialog` 통합 → Android/iOS/PC/웹 E2E 복원 검증 후 D+90 삭제 활성화.
4. **Phase 3 (엔터프라이즈 스토리지 전환)**: `storage_provider` 추상화를 통해 개인 Google One → **Google Workspace Shared Drive 또는 한국 리전 S3/R2**로 무중단 전환.

---

## 7. 디렉터(박서로님) 최종 결정 및 Cursor 리뷰 요청 사항

1. **나와의 채팅(`is_self_chat`) 보관 정책**: 90일 삭제 제외 후 **(A) 365일 후 장기 보관소 이동** vs **(B) Supabase 영구 유지(Drive 미러만)**
2. **Phase 1 백업 스토리지**: **(A) 개인 Google One(2TB) 파일럿 → 추후 Workspace/한국 S3·R2 전환** vs **(B) 초기부터 한국 리전 S3/R2 또는 Workspace Shared Drive 직접 도입**
3. **안전문서 2차 미러 주기**: **D+7(주간)** vs **D+30(월간)**
4. **기존 누적 파일 초기 백업 이관**: **심야 Edge Function 틱 분산** vs **일회성 GitHub Actions 외부 워커**

> Cursor 및 리뷰어께서는 위 4가지 결정사항과 설계 전반(특히 DB 스키마·복원 UX·보안/PIPA·Deno 메모리 한계)에 대해 이 PR에 리뷰 코멘트로 의견을 남겨 주세요!
