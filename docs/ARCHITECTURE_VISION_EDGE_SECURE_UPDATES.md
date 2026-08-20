# SafeNex Vision Edge 서명 검증 자동 업데이트 아키텍처

## 1. 목표와 운영 원칙

SafeNex Vision Edge의 업데이트는 설치자가 현장마다 EXE를 다시 전달하는 방식이 아니라, **Gateway Agent가 중앙 Fleet의 승인된 릴리스만 확인·검증·다운로드하고 안전창에 설치하는 방식**으로 운영한다. 다만 AI 안전관제는 카메라 분석과 이벤트 보존이 중단되면 안 되므로, 단순 무인 업데이트가 아니라 channel·canary·maintenance window·health check·rollback을 갖춘 관리형 업데이트여야 한다.

> 업데이트 확인은 자동화하되, 설치 권한은 “서명된 릴리스 + 해당 Fleet rollout 대상 + 현장 안전창 + Gateway 자체 검증” 네 조건을 모두 통과할 때만 얻는다.

## 2. 업데이트 신뢰 체인

```text
SafeNex Release CI
    │ 1. Windows EXE / Ubuntu DEB 빌드·서명
    ▼
Release Repository / Object Storage
    │ 2. hash·size·version·channel을 담은 target 생성
    ▼
Offline Release Signing Key (threshold 권장)
    │ 3. signed update manifest 발행
    ▼
SafeNex Fleet
    │ 4. site/canary/production rollout 정책 배포
    ▼ outbound mTLS + HTTPS
Vision Edge Agent
    │ 5. signature·expiry·version·hash·size·platform 검증
    │ 6. .partial download → atomic rename
    │ 7. maintenance window에서 sidecar updater 실행
    ▼
Installer / package manager
    │ 8. Agent restart → localhost health check → Fleet audit
    ▼
Paired / Healthy 또는 Rollback Required
```

## 3. 서명된 Update Manifest 계약

Central SafeNex는 target artifact와 별도로 canonical JSON을 서명한 `update-manifest.json`을 제공한다. Gateway는 TLS만 신뢰하지 않으며, 최초 설치 시 포함된 **업데이트 root Ed25519 public key**로 manifest signature를 확인한다. online release-signing private key는 Gateway, frontend bundle, Supabase 일반 테이블, GitHub source에 두지 않는다.

```json
{
  "schema": "safenex-vision-edge-update/v1",
  "release_id": "ve-0.4.0-win-x64",
  "version": "0.4.0",
  "channel": "production",
  "platform": "windows-x64",
  "min_supported_version": "0.3.0",
  "installer_url": "https://releases.safenex.example/vision-edge/0.4.0/SafeNex_Vision_Edge_Setup_0.4.0_Windows_x64.exe",
  "sha256": "lowercase-64-hex",
  "size_bytes": 24300000,
  "published_at": "2026-08-20T00:00:00Z",
  "expires_at": "2026-09-20T00:00:00Z",
  "security_critical": false,
  "release_notes_url": "https://safenex.example/releases/ve-0.4.0",
  "signature": "base64-ed25519-signature-over-canonical-payload"
}
```

| 검증 항목 | Gateway 동작 | 실패 시 처리 |
|---|---|---|
| schema/platform/channel | 자신에게 승인된 platform·channel만 수용 | `rejected_platform_or_channel` 감사 이벤트 |
| signature/root key | canonical payload Ed25519 검증 | 다운로드·설치 절대 금지 |
| published/expiry/version | 만료 metadata, downgrade, 허용되지 않은 major jump 거부 | `rejected_stale_or_rollback` |
| URL | HTTPS·허용된 artifact host만 수용 | `rejected_origin` |
| size/SHA-256 | size 상한 확인 후 `.partial`에 내려받아 digest 대조 | partial 삭제·재시도 backoff |
| Authenticode/OS package | Windows publisher·Linux package origin 재검증 | `rejected_os_signature` |
| health after update | local `/healthz`, config migration, Fleet heartbeat 확인 | 실패 시 rollback 요청·현장 경보 |

## 4. rollout 정책

| 단계 | 대상 | 설치 방식 | 다음 단계 조건 |
|---|---|---|---|
| `pilot` | 사내 랩·1개 내부 현장 | 운영자 확인 후 설치 | 24시간 health·AI·spool 이상 없음 |
| `canary` | 현장 유형별 1~3개 Gateway | 지정 안전창 자동 설치 | health/rollback/error rate 기준 충족 |
| `site` | 동일 현장 전체 Gateway | 순차 설치, 동시 NVR restart 금지 | 해당 현장 안정성 확인 |
| `production` | 승인된 Fleet group | jitter·rate limit을 둔 자동 rollout | Fleet 지표 경보 없음 |
| `hold`/`revoke` | 전체 또는 특정 현장 | 신규 download 중지·이미 받은 target 격리 | 원인 분석·새 signed replacement |

일반 릴리스는 기본 6시간마다 manifest를 확인하고, `cellular_metered` 현장은 metadata 확인만 수행한 뒤 security-critical 이외 target 다운로드를 `pending_unmetered`로 둔다. 긴급 보안 릴리스는 서명된 `security_critical=true`와 Fleet 승인 정책이 함께 있어야 셀룰러에서도 설치할 수 있다.

## 5. Windows와 Ubuntu 설치 방식

Windows에서는 Agent가 현재 GUI/Agent process와 분리된 **sidecar updater**를 실행한다. sidecar는 Gateway가 정상 종료된 뒤 Inno Setup EXE를 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` 방식으로 실행하고, 기존 부팅 자동 시작 task를 보존한다. 새 Agent가 local health check와 Fleet heartbeat를 통과하지 못하면, 이전 validated installer를 사용한 rollback을 요청한다.

Ubuntu에서는 systemd service를 stop하고 signed DEB를 `apt install ./package.deb`로 설치한 뒤 service restart와 `/healthz`를 확인한다. package install은 기존 encrypted state directory·secret store·event spool을 삭제하지 않아야 한다. OS·Python·ffmpeg 의존성 업데이트는 Gateway package와 분리해 운영자가 승인한 base image/maintenance 절차에서 관리한다.

## 6. SafeNex 웹·모바일이 구현할 API

| 목적 | endpoint | 권한/보안 |
|---|---|---|
| Gateway update manifest 조회 | `GET /vision-fleet/v1/gateways/{id}/updates/manifest` | mTLS Gateway identity, rollout 대상 확인 |
| update acknowledgement | `POST /vision-fleet/v1/gateways/{id}/updates/{release_id}/ack` | mTLS, state·failure reason audit |
| admin release 등록 | `POST /vision-fleet/v1/releases` | platform master + offline signing workflow |
| rollout 생성/중지 | `POST /vision-fleet/v1/releases/{id}/rollouts` | company/site scope + approval/audit |
| 현장 상태 조회 | `GET /vision-fleet/v1/gateways/{id}/updates` | RLS, raw signature/URL token 미노출 |

## 7. Gateway 상태 모델

`up_to_date`, `available`, `download_pending`, `downloaded_verified`, `scheduled`, `installing`, `postcheck`, `rolled_back`, `failed`, `blocked_metered`, `rejected_signature`, `rejected_rollback`, `held_by_policy` 상태를 local Console과 Fleet에 표시한다. Console 사용자는 업데이트 버전·채널·예정 안전창·release notes·보류 사유를 볼 수 있지만, manifest 서명 key·artifact write credential·raw release token은 볼 수 없다.

## 8. 금지 사항

- unsigned EXE/DEB, HTTPS만 통과한 파일, hash 없는 URL을 설치하지 않는다.
- Gateway가 중앙의 임의 shell command로 self-update하지 않는다.
- AI 고위험 경보 처리·NVR firmware·카메라 비밀번호를 업데이트 과정에서 변경하지 않는다.
- 대규모 Fleet에 같은 시각 재시작 명령을 내리지 않는다.
- 설치 전의 secret store·event spool·인증서·원본 녹화를 삭제하거나 덮어쓰지 않는다.
- 사용자에게 SmartScreen/Defender를 끄거나 경고를 무시하라고 안내하지 않는다.

## References

[1] [TUF — Security](https://theupdateframework.io/docs/security/)

[2] [TUF Specification](https://theupdateframework.github.io/specification/latest/)

[3] [Microsoft — Windows Installer Best Practices](https://learn.microsoft.com/en-us/windows/win32/msi/windows-installer-best-practices)

[4] [Microsoft — Code Signing Options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options)
