# SafeNex Vision Edge 자동 업데이트 보안 조사

## 핵심 결론

현장 Gateway 자동 업데이트는 HTTPS 다운로드만으로 구현하면 안 된다. 클라이언트에는 최초 설치 시 내장된 업데이트 trust root를 두고, 설치 대상의 version, target platform, SHA-256, size, release channel, minimum version, 만료 시각을 포함하는 **서명된 update manifest**를 검증한 뒤에만 설치해야 한다. 다운로드 파일도 manifest hash·size·Windows Authenticode publisher를 확인하고, version rollback·metadata replay·무한 다운로드·중간자 변조를 거부한다.

The Update Framework(TUF)는 arbitrary software installation, rollback, indefinite freeze, endless data, mix-and-match 같은 업데이트 공격을 명시하고, trusted metadata, freshness, hash/size 검증, key rotation·revocation, threshold trust를 핵심 대응으로 제시한다.[1] [2]

Windows 현장 배포에서는 UI 없는 설치 옵션, 정식 servicing 전략, 충분한 패키지 검증을 마련해야 하며, concurrent/nested installation은 피해야 한다.[3] SafeNex의 현재 Inno Setup EXE는 background updater가 기존 Agent를 정상 중지한 뒤 동일한 installer를 silent 모드로 실행하고 재기동하는 방식으로 업데이트할 수 있다. 단, installer와 내부 EXE의 Authenticode 서명은 반드시 검증해야 한다.

Microsoft는 외부 배포 Win32 앱에는 Authenticode code signing을 권장하며, 관리형 현장 PC는 enterprise trust 배포가 가능한 self-signed certificate를 사용할 수 있지만 공용 배포에는 적합하지 않다고 설명한다.[4]

## SafeNex 설계 원칙

1. **Fleet 제어 + Gateway 최종 검증:** Fleet desired-state는 rollout 대상·channel·hold 여부를 지정하되, Gateway가 자체 trust root와 signed manifest를 검증한 뒤에만 다운로드·설치한다.
2. **자동 확인, 단계적 설치:** Agent는 6시간 기본 주기로 확인한다. download는 자동이되, canary/일반 channel 정책과 안전창을 지킨다. safety-critical 현장의 무인 restart는 중앙 승인 정책이 있어야 한다.
3. **두 종류의 검증:** signed manifest Ed25519 검증 + SHA-256/size 검증 + Windows Authenticode publisher thumbprint 검증을 모두 통과해야 한다.
4. **rollback은 복구 전용:** 오래된 버전 설치를 기본적으로 차단한다. health check 실패 시에만 locally retained previous installer/version으로 명시적 rollback을 허용하며, 중앙 감사 이벤트를 남긴다.
5. **중단 내성:** `.partial` download와 atomic rename, disk headroom 확인, process/service stop timeout, post-install health check, restart limiter를 둔다.
6. **오프라인·유심 환경:** metered cellular profile에서는 manifest check와 승인된 security-critical update만 자동 download하며, 일반 release는 download 보류·운영자 승인·다음 unmetered 연결을 기다린다.

## 출처

[1] TUF, Security: https://theupdateframework.io/docs/security/

[2] TUF Specification 1.0.36: https://theupdateframework.github.io/specification/latest/

[3] Microsoft, Windows Installer Best Practices: https://learn.microsoft.com/en-us/windows/win32/msi/windows-installer-best-practices

[4] Microsoft, Code signing options for Windows app developers: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
