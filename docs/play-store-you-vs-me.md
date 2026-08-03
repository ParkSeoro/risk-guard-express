# Play Store 등록 — 당신 할 일 / 에이전트 할 일

목표: **Google Play 내부 테스트**로 Safenex(`org.safenex.app`)를 설치·자동 업데이트 가능하게 만들기.  
기능/화면 변경은 이후 **OTA**로 스토어 재심사 없이 반영합니다.

> 상세 콘솔 클릭 순서: [`play-internal-testing.md`](./play-internal-testing.md)  
> 네이티브·OTA 기술: [`mobile-build.md`](./mobile-build.md)

---

## 역할 구분 (한눈에)

| 구분 | 담당 | 왜 |
|------|------|----|
| Play 개발자 계정·결제·본인인증 | **당신** | Google 로그인·결제·사업자 정보 필요 |
| 서명 키(.jks) 생성·백업 | **당신** | 분실 시 앱 업데이트 영구 불가. 비밀키는 에이전트/CI만 쓰면 안 됨 |
| GitHub Secrets 등록 | **당신** | 레포 Secrets 쓰기 권한은 소유자만 |
| AAB 빌드 워크플로·앱 코드·문서 | **에이전트(완료/진행)** | 레포에 이미 있음. 보완·점검 |
| Play Console 앱 등록·설문·스크린샷 | **당신** | Google UI + 로그인 계정 필요 |
| AAB 업로드·테스터 초대 | **당신** | Play Console 권한 필요 |
| OTA 채널·릴리즈 UI | **에이전트(이미 구현)** | 마스터 계정으로 `/settings/mobile-releases` |
| 스토어 아이콘/피처 그래픽 초안 | **에이전트(이번 작업)** | `docs/store-assets/`, `public/icon-*.png` |

---

## Phase A — 당신이 먼저 (계정·키)

### A1. Google Play 개발자 등록 (당신)
1. https://play.google.com/console 접속 (회사/본인 Google 계정)
2. **개발자 계정 등록** → 본인 인증 + **$25 1회** 결제
3. 승인 메일 확인 (보통 수 시간~1일)

> 회사 명의면 사업자·D-U-N-S 등이 추가될 수 있습니다. 급하면 개인 계정으로 시작 후 이전 가능.

### A2. 서명 키스토어 생성 (당신 PC, 1회)
JDK 17 설치 후:

```bash
keytool -genkey -v -keystore safenex.jks -alias safenex \
  -keyalg RSA -keysize 2048 -validity 10000
```

- CN/조직: 본인 또는 회사명
- 비밀번호 2개(키스토어/키) 메모
- **`safenex.jks`를 1Password/Bitwarden에 백업** (분실 = 앱 업데이트 불가)

### A3. GitHub Secrets 등록 (당신)
레포 `ParkSeoro/risk-guard-express` → **Settings → Secrets and variables → Actions**

| Secret 이름 | 값 |
|-------------|-----|
| `ANDROID_KEYSTORE_BASE64` | 아래 base64 결과 전체 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `safenex` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

```powershell
# Windows
[Convert]::ToBase64String([IO.File]::ReadAllBytes("safenex.jks")) | Set-Clipboard
```

```bash
# macOS / Linux
base64 -i safenex.jks | pbcopy   # Linux: base64 -w0 safenex.jks
```

완료되면 채팅에 **「Secrets 등록 완료」**만 알려주세요. (비밀번호는 보내지 마세요)

---

## Phase B — 에이전트 / CI (A3 이후)

당신이 Secrets를 넣으면 에이전트(또는 당신)가:

1. GitHub Actions → **「Android AAB (Play 내부 테스트)」** → **Run workflow**
   - `versionName`: `1.0.0` (또는 비우면 `package.json`)
   - `versionCode`: 비우면 run 번호 자동
2. 완료 후 **Artifacts**에서 `safenex-1.0.0-*.aab` 다운로드
3. 빌드 실패 시 로그를 에이전트가 분석·수정

워크플로 파일: `.github/workflows/android-aab.yml`  
패키지 ID: **`org.safenex.app`** (변경 금지 — 스토어에 한 번 올리면 고정)

---

## Phase C — 당신이 Play Console에서 (앱 등록)

### C1. 앱 만들기
- 앱 이름: **Safenex**
- 기본 언어: 한국어
- 앱 / 무료
- 패키지명은 AAB 업로드 시 `org.safenex.app`로 자동 인식

### C2. 필수 정책 항목 (좌측 메뉴 ★)
대략적인 답안 가이드:

| 항목 | 권장 답 |
|------|---------|
| 앱 액세스 | 로그인 필요 → 테스트 계정(이메일/비번) 제공 |
| 광고 | 포함 안 됨 |
| 콘텐츠 등급 | 설문 → 비즈니스/도구, 폭력·성적 콘텐츠 없음 |
| 타겟층 | 만 18세 이상 (현장 근로·관리자) |
| 뉴스 앱 | 아니오 |
| COVID 접촉 추적 | 아니오 |
| 데이터 보안 | 위치(정확/대략), 사진/카메라, 이름·이메일·전화, 앱 활동 — 목적: 앱 기능, 암호화 전송, 삭제 요청 가능 |
| 개인정보처리방침 URL | **`https://safenex.org/privacy`** (배포 도메인에 `/privacy` 공개됨). 임시로 Vercel이면 `https://risk-guard-express.vercel.app/privacy` |

### C3. 스토어 등록정보
준비된 자산:

| 자산 | 위치 |
|------|------|
| 앱 아이콘 512×512 | `public/icon-512.png` |
| 피처 그래픽 1024×500 | `docs/store-assets/feature-graphic-1024x500.png` (또는 `public/feature-graphic-1024x500.png`) |
| 짧은 설명 | 아래 초안 |
| 스크린샷 2장+ | **당신**: 폰/에뮬에서 `/app/worker/menu`, 승인·점검 화면 캡처 |

**짧은 설명(80자 이내) 초안**
```
건설·플랜트 현장 산업안전 통합관리 — 허가서·위험성평가·TBM·위치 경보
```

**전체 설명 초안**
```
SafeNex는 산업안전보건 현장 운영을 위한 통합 앱입니다.

• 안전작업허가서 전자결재·작업 완료 확인
• 위험성평가·작업계획서·TBM
• 근로자 QR·교육·출입 관리
• 금지구역·위치 기반 안전 경보 및 푸시 알림

관리자는 웹, 현장 인력은 모바일 앱으로 동일 시스템을 사용합니다.
로그인 계정은 소속 회사에서 발급합니다.
```

카테고리: **비즈니스**

### C4. 내부 테스트 트랙에 AAB 올리기
1. **테스트 → 내부 테스트 → 새 버전 만들기**
2. Play 앱 서명 사용 (권장)
3. Phase B에서 받은 `*.aab` 업로드
4. 출시 노트 예: `최초 내부 테스트 빌드`
5. 저장 → 검토 → 출시 시작
6. **테스터** 이메일 목록 추가 → **참여 URL** 공유

테스터: 참여 URL → 「테스터 되기」→ Play Store에서 설치 (APK 직접 설치 금지)

첫 검토 **1~3일** 흔함. 이후 업데이트는 더 빠름.

---

## Phase D — 평소 운영 (둘 다)

| 변경 | 누가 | 어떻게 |
|------|------|--------|
| 화면·결재·가스측정 등 웹 기능 | 개발(에이전트/당신) | merge → OTA zip → `/settings/mobile-releases` |
| 권한·플러그인·아이콘·네이티브 SDK | 개발 + **당신** | AAB 재빌드 → Play Console 업로드 |

---

## 지금 상태 (에이전트 점검 결과)

| 항목 | 상태 |
|------|------|
| Capacitor `appId` | `org.safenex.app` ✅ |
| Android AAB GitHub Actions | `.github/workflows/android-aab.yml` ✅ |
| 서명 AAB 아티팩트 | [run 30786779135](https://github.com/ParkSeoro/risk-guard-express/actions/runs/30786779135) `safenex-1.0.0-450.aab` ✅ (최신 main) |
| OTA (Capgo + Supabase) | 코드·관리 UI ✅ |
| 개인정보처리방침 페이지 | `/privacy` ✅ |
| 스토어 아이콘 512 PNG | `public/icon-512.png` ✅ |
| 피처 그래픽 1024×500 | `docs/store-assets/` ✅ |
| `package.json` version | `1.0.0` |
| Play 앱 만들기 | **완료** (`Safenex` / `org.safenex.app`) ✅ |
| GitHub Secrets | 과거 AAB 성공 → 등록된 것으로 보임 (재빌드 실패 시 재확인) |
| 콘솔 ★ 정책·스토어 등록정보 | **당신** — [`play-console-fill.md`](./play-console-fill.md) |
| 폰 스크린샷 | **당신 캡처 필요** ⏳ |
| 내부 테스트 AAB 업로드 | **당신** ⏳ |

콘솔 복붙 답안·업로드 순서: **[`play-console-fill.md`](./play-console-fill.md)**

---

## 다음에 채팅에 적어주시면 좋은 것

1. ★ 정책/데이터 보안에서 막힌 화면 캡처 → 답 골라줌  
2. 내부 테스트 **출시 시작** 완료 / 참여 URL → OTA 운영 이어서  
3. AAB 재빌드 필요 + `Secrets 등록 완료` → 워크플로 실패 로그 분석  
