# Google Play 내부 테스트 배포 가이드 (Safenex)

디버그 APK 가 Play Protect 에 막혀 설치가 안 되는 문제를 **근본적으로** 해결하는 길입니다.
한 번만 설정하면 그 다음부터는 Play Store 링크로 누구나 1초 설치, 자동 업데이트까지 됩니다.

소요: 결제 1회($25) + 첫 등록 1~2시간 + 심사 대기 보통 1~3일.

> **역할 분리·체크리스트:** [`play-store-you-vs-me.md`](./play-store-you-vs-me.md)  
> 패키지 ID: **`org.safenex.app`** · 앱 이름: **Safenex**

---

## 0. 큰 그림

```
[GitHub Actions] ──▶  app-release.aab (서명됨)
                            │
                            ▼
            [Play Console 내부 테스트 트랙]
                            │
                            ▼
        [테스터 100명 — Play Store 링크로 설치 / 자동 업데이트]
```

코드 변경은 Lovable → GitHub → Actions 가 자동으로 새 AAB 를 만들고,
업로드만 Play Console 에서 1번 클릭하면 됩니다.

---

## 1. Google Play 개발자 계정 만들기 ($25 1회)

1. https://play.google.com/console 접속
2. **개발자 계정 등록** → 본인 인증 + $25 결제
3. 24시간 이내 승인

> 회사 명의로 등록하려면 사업자 정보가 추가로 필요합니다(D-U-N-S 번호 등). 일단 개인으로 등록한 뒤 나중에 회사 이전 가능.

---

## 2. 앱 서명 키(Keystore) 만들기 — 본인 PC 1회

> ⚠️ 이 파일을 잃어버리면 앱을 영원히 업데이트할 수 없습니다. 클라우드 비밀번호 매니저(1Password, Bitwarden)에 백업하세요.

PowerShell(또는 macOS Terminal)에서:

```bash
# 작업 폴더에서 (경로 자유)
keytool -genkey -v -keystore safenex.jks -alias safenex \
  -keyalg RSA -keysize 2048 -validity 10000
```

질문에 답하면 `safenex.jks` 파일이 생성됩니다. 비밀번호 2개(키스토어/키)는 꼭 기억하세요.

`keytool` 이 없다는 오류가 나면 JDK 17 이 설치되지 않은 상태입니다. https://adoptium.net 에서 Temurin 17 설치.

---

## 3. GitHub Secrets 등록

GitHub 레포 → **Settings → Secrets and variables → Actions → New repository secret** 에서 4개 등록:

| 이름 | 값 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `safenex.jks` 를 base64 로 변환한 텍스트 (아래 명령) |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `safenex` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

base64 변환:

```powershell
# Windows PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("safenex.jks")) | Set-Clipboard
# → 클립보드에 복사됨. GitHub Secret 값에 그대로 붙여넣기
```

```bash
# macOS / Linux
base64 -i safenex.jks | pbcopy
```

---

## 4. AAB 빌드 — GitHub Actions 가 알아서

레포의 Actions 탭 → **"Android AAB (Play 내부 테스트)"** → **Run workflow** 클릭.

- `versionName` : 비우면 `package.json` 의 version 사용 (예: `1.0.0`)
- `versionCode` : 비우면 GitHub run 번호가 자동 증가
- 5~10분 후 완료 → 해당 run 의 **Artifacts** 에서 `safenex-1.0.0-1.aab` 다운로드

> 태그로 자동 빌드도 가능: `git tag android-v1.0.1 && git push --tags`
> → 빌드 후 GitHub Releases 에 AAB 자동 첨부.

---

## 5. Play Console 에 첫 앱 등록

1. Play Console → **앱 만들기**
   - 앱 이름: `Safenex`
   - 기본 언어: 한국어
   - 앱/게임: 앱
   - 무료/유료: 무료
   - 정책 동의 체크

2. **앱 설정** 좌측 메뉴에서 아래 항목 채우기 (★ = 필수):
   - ★ 앱 액세스 (로그인 필요 → 테스트 계정 제공)
   - ★ 광고 (포함 안 됨)
   - ★ 콘텐츠 등급 설문 (전체이용가 / 비즈니스 도구)
   - ★ 타겟층 (만 18세 이상 직장인)
   - ★ 뉴스 앱 여부 (아니오)
   - ★ COVID-19 접촉 추적 (아니오)
   - ★ 데이터 보안 — 수집 항목:
     - 위치(대략적·정확한), 카메라(사진), 개인 정보(이름·이메일·전화), 앱 활동
     - 모두 "앱 기능 제공", "암호화 전송", "사용자 삭제 요청 가능" 체크
   - ★ 개인정보처리방침 URL: `https://safenex.org/privacy`
     (임시: `https://risk-guard-express.vercel.app/privacy`)

3. **스토어 등록정보**
   - 짧은 설명·전체 설명: [`play-store-you-vs-me.md`](./play-store-you-vs-me.md) 초안 참고
   - 아이콘 512×512: `public/icon-512.png`
   - 피처 그래픽 1024×500: `docs/store-assets/feature-graphic-1024x500.png`
   - 스크린샷 폰 2~8장: 실기기/에뮬에서 캡처
   - 카테고리: **비즈니스**

---

## 6. 내부 테스트 트랙에 AAB 업로드

1. 좌측 메뉴 **테스트 → 내부 테스트**
2. **새 버전 만들기**
3. **앱 무결성** → "Play 앱 서명 사용" → Google 이 알아서 관리 (강력 추천)
4. **App Bundle** 영역에 4단계에서 받은 `*.aab` 드래그
5. 출시명 / 출시 노트 입력 → **저장 → 검토 → 출시 시작**
6. **테스터** 탭 → "이메일 목록 만들기" → 테스터 Gmail 주소 입력 → 저장
7. 상단에 뜨는 **참여 URL** 복사 → 테스터에게 카톡 전송

테스터가 해야 할 일:
1. 참여 URL 클릭 → "테스터 되기" 동의
2. Play Store 링크 클릭 → Safenex 정상 설치
3. 끝. Play Protect 경고 없음, 이후 새 버전이 올라오면 Play Store 에서 자동 업데이트

> 첫 출시는 Google 검토에 보통 **1~3일** 걸립니다. 이후 업데이트는 보통 수 시간.

---

## 7. 평소 운영 흐름

```
Lovable 에서 코드 수정
        │
        ▼  (자동 push)
GitHub main 브랜치
        │
        ├─ "Mobile Release (OTA bundle)" 워크플로우 → /settings/mobile-releases 에 OTA 등재
        │   → 이미 설치된 사용자는 앱 재시작 시 즉시 적용 (네이티브 변경 없을 때)
        │
        └─ 네이티브 변경이 있거나 신규 테스터 → "Android AAB" 워크플로우 수동 실행
            → 다운로드한 AAB 를 Play Console 내부 테스트에 업로드 → 출시
```

| 변경 종류 | 어디로 |
| --- | --- |
| React/TS/CSS, 화면, DB 호출 | **OTA** (Play Console 업로드 불필요) |
| Capacitor 플러그인 추가, 권한 변경, 앱 아이콘 | **AAB 재빌드 → Play Console** |

---

## 8. 자주 발생하는 문제

| 증상 | 원인 / 조치 |
| --- | --- |
| Gradle "AGP 8.9.1 필요" | 워크플로우는 컨테이너에서 항상 최신 JDK/AGP 사용 — 로컬에서 발생 시 `android/build.gradle` 의 `com.android.tools.build:gradle:8.9.1` 확인 |
| Play Console "버전 코드가 이미 사용됨" | `versionCode` 를 더 큰 정수로 — 워크플로우는 GitHub run 번호로 자동 증가 |
| 키스토어 비밀번호 분실 | **앱 영구 업데이트 불가**. 1Password 등에 반드시 백업 |
| 테스터가 설치 안 됨 | 참여 URL 동의 → Play Store 링크 사용했는지 확인. APK 직접 설치 X |

---

## 9. 정식 출시로 전환

내부 테스트가 안정되면 같은 AAB 를 **공개 테스트 → 프로덕션** 트랙으로 승격하면 됩니다.
별도 재빌드 불필요. Play Console 에서 클릭 몇 번이면 일반 사용자도 Play Store 에서 검색·다운로드.
