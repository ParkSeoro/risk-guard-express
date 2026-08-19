# SafeNex Vision Edge Windows 코드서명 및 SmartScreen 운영 가이드

## 1. 먼저 구분할 사항

자체 서명(Self-Signed) 인증서는 **조직이 직접 관리하는 현장 PC**에서 SafeNex 배포자를 신뢰하도록 만드는 수단입니다. 그러나 인터넷에서 내려받는 불특정 사용자의 PC에 대한 Microsoft Defender SmartScreen 평판 경고를 제거하는 수단은 아닙니다. Microsoft는 자체 서명 인증서를 개발·시험 또는 관리형 인증서 신뢰가 있는 엔터프라이즈 용도로만 제시하며, 자체 서명 파일의 SmartScreen 동작은 무서명 파일과 동일하다고 설명합니다.[1] [2]

> 현장 PC에 자체 루트와 배포자 인증서를 정책으로 설치한 뒤 **같은 인증서로** 앱과 설치 파일을 서명하면, 조직 내부의 신뢰 사슬을 만들 수 있습니다. SmartScreen 자체를 끄거나 우회하지 마십시오.

| 배포 범위 | 권장 방식 | SmartScreen 기대값 |
|---|---|---|
| SafeNex가 관리하는 현장 PC | 자체 서명 PFX + 루트/Trusted Publishers 정책 배포 | 조직의 인증서 신뢰 가능. 일반 인터넷 평판은 별개 |
| 고객사·협력사에 외부 배포 | CA 발급 코드서명 또는 Azure Artifact Signing | 새 버전은 경고가 남을 수 있으나 게시자 신원과 평판을 축적 |
| 범용 소비자 배포 | Microsoft Store/MSIX 또는 신뢰된 서명 + 평판 | Store 배포가 가장 예측 가능 |

## 2. 자체 서명 인증서 1회 생성

이 작업은 일반 현장 PC가 아니라 **접근이 제한된 SafeNex 빌드 관리자 PC**에서 한 번만 수행하십시오. PFX 개인 키는 새 릴리스를 같은 배포자로 서명하는 핵심 자산입니다. PFX 파일·비밀번호를 현장 PC나 소스 저장소에 넣지 마십시오.

관리자 PowerShell에서 다음을 실행합니다.

```powershell
$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=SafeNex Vision Edge, O=SafeNex" `
  -FriendlyName "SafeNex Vision Edge Internal Code Signing" `
  -KeyAlgorithm RSA `
  -KeyLength 3072 `
  -HashAlgorithm SHA256 `
  -KeyExportPolicy Exportable `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(3)

$password = Read-Host "PFX 비밀번호" -AsSecureString
Export-PfxCertificate -Cert $cert -FilePath "$env:USERPROFILE\Desktop\SafeNexVisionEdge-CodeSigning.pfx" -Password $password
Export-Certificate -Cert $cert -FilePath "$env:USERPROFILE\Desktop\SafeNexVisionEdge-CodeSigning.cer"
```

`SafeNexVisionEdge-CodeSigning.pfx`는 암호화된 금고 또는 승인된 비밀관리 서비스에 저장합니다. `SafeNexVisionEdge-CodeSigning.cer`만 현장 PC의 신뢰 정책 배포에 사용합니다.

## 3. 현장 PC에 인증서 신뢰 배포

### 소규모 Pilot: 개별 PC에서 1회 적용

현장 PC에서 **관리자 PowerShell**을 열고 조직이 전달한 `.cer` 파일을 신뢰 루트와 신뢰된 게시자 저장소에 추가합니다.

```powershell
$certificate = "C:\SafeNex\SafeNexVisionEdge-CodeSigning.cer"
Import-Certificate -FilePath $certificate -CertStoreLocation "Cert:\LocalMachine\Root"
Import-Certificate -FilePath $certificate -CertStoreLocation "Cert:\LocalMachine\TrustedPublisher"
```

그 뒤 서명한 설치 파일을 다음 명령으로 확인합니다.

```powershell
Get-AuthenticodeSignature "C:\SafeNex\SafeNex_Vision_Edge_Setup_0.2.0_Windows_x64.exe" | Format-List Status, StatusMessage, SignerCertificate
```

### 전국 현장: AD GPO 또는 Intune으로 배포

현장 PC가 Active Directory에 연결되어 있다면 다음 두 정책에 동일한 `.cer` 파일을 **컴퓨터 구성**으로 배포합니다.

| 정책 위치 | 가져올 인증서 |
|---|---|
| `Computer Configuration > Policies > Windows Settings > Security Settings > Public Key Policies > Trusted Root Certification Authorities` | `SafeNexVisionEdge-CodeSigning.cer` |
| `Computer Configuration > Policies > Windows Settings > Security Settings > Public Key Policies > Trusted Publishers` | `SafeNexVisionEdge-CodeSigning.cer` |

Intune을 사용한다면 해당 인증서를 Trusted certificate profile로 배포하되, 적용 대상은 SafeNex Vision Edge가 설치되는 관리 장비 그룹으로 한정합니다. 인증서 교체 시에는 **새 인증서를 먼저 배포하고, 새 인증서로 서명한 설치 파일을 배포한 뒤, 마지막에 이전 인증서를 제거**합니다.

## 4. 설치 파일과 실행 파일 서명

### 수동 Pilot 서명

빌드 관리자 PC에서 다음 방식으로 설치 파일과 내부 실행 파일을 모두 서명합니다. `signtool.exe`는 Windows SDK에 포함됩니다.

```powershell
$cert = Get-ChildItem "Cert:\CurrentUser\My" | Where-Object { $_.Subject -eq "CN=SafeNex Vision Edge, O=SafeNex" }
$timestamp = "http://timestamp.digicert.com"

& signtool sign /fd SHA256 /sha1 $cert.Thumbprint /tr $timestamp /td SHA256 ".\SafeNexVisionEdge.exe"
& signtool sign /fd SHA256 /sha1 $cert.Thumbprint /tr $timestamp /td SHA256 ".\SafeNex_Vision_Edge_Setup_0.2.0_Windows_x64.exe"

& signtool verify /pa /v ".\SafeNex_Vision_Edge_Setup_0.2.0_Windows_x64.exe"
```

### 현재 GitHub Actions 파이프라인에 자동 서명 연결

저장소의 `build-vision-edge-windows.yml` 워크플로는 다음 GitHub Actions 비밀이 설정된 경우에만 실행 파일과 설치 파일을 자동 서명합니다.

| 비밀 이름 | 값 |
|---|---|
| `WINDOWS_CODESIGN_PFX_BASE64` | PFX 파일을 Base64로 변환한 한 줄 문자열 |
| `WINDOWS_CODESIGN_PFX_PASSWORD` | PFX 내보낼 때 설정한 비밀번호 |

빌드 관리자 PC에서 PFX를 Base64로 만들 때는 아래 명령을 사용합니다. 출력값은 공개 채팅·소스·이슈에 붙여넣지 말고 GitHub Secrets에만 넣으십시오.

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\Desktop\SafeNexVisionEdge-CodeSigning.pfx"))
```

비밀을 설정한 뒤 `feat/vision-edge-gateway` 브랜치에서 Windows 빌드 워크플로를 다시 실행합니다. 새 artifact를 내려받은 다음 `Get-AuthenticodeSignature` 또는 `signtool verify /pa /v`로 서명 상태를 확인합니다.

## 5. 운영상 금지 사항

SmartScreen·Smart App Control·Windows Defender를 정책으로 끄거나 사용자에게 경고를 무시하라고 지시하지 마십시오. 자체 서명 인증서를 개인용 PC 전체에 무분별하게 신뢰시키지 말고 SafeNex가 통제하는 현장 장비 그룹으로 범위를 제한하십시오. PFX·비밀번호·GitHub Actions 비밀은 한 사람이 로컬에 보관하지 말고 보안 책임자 승인·회수 절차를 적용하십시오.

## References

[1] [Microsoft Learn — Code signing options for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)

[2] [Microsoft Learn — SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
