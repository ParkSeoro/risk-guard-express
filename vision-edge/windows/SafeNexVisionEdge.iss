#define AppName "SafeNex Vision Edge"
#define AppVersion "0.3.0"
#define AppPublisher "SafeNex"
#define AppExeName "SafeNexVisionEdge.exe"

[Setup]
AppId={{7E1117C6-4BE7-4E87-8A35-1C1E01C6B1C7}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\SafeNex Vision Edge
DefaultGroupName=SafeNex Vision Edge
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist\windows
OutputBaseFilename=SafeNex_Vision_Edge_Setup_{#AppVersion}_Windows_x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=SafeNex Vision Edge

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "..\dist\SafeNexVisionEdge\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "..\dist\windows\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{autoprograms}\SafeNex Vision Edge"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\SafeNex Vision Edge 관제"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 관제 아이콘 만들기"; GroupDescription: "추가 아이콘:"; Flags: checkedonce

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "SafeNex Vision Edge 화면 구성요소 설치"; Flags: runhidden waituntilterminated; Check: NeedsWebView2Runtime
Filename: "{sys}\schtasks.exe"; Parameters: "/Create /TN ""SafeNex Vision Edge Agent"" /TR """"{app}\{#AppExeName}"" --agent"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F"; StatusMsg: "SafeNex Vision Edge Agent 자동 시작 등록"; Flags: runhidden waituntilterminated
Filename: "{sys}\schtasks.exe"; Parameters: "/Run /TN ""SafeNex Vision Edge Agent"""; StatusMsg: "SafeNex Vision Edge Agent 시작"; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExeName}"; Description: "SafeNex Vision Edge 관제 시작"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\schtasks.exe"; Parameters: "/Delete /TN ""SafeNex Vision Edge Agent"" /F"; Flags: runhidden waituntilterminated

[Code]
function NeedsWebView2Runtime(): Boolean;
var
  Version: String;
begin
  Result := True;
  if RegQueryStringValue(HKLM64, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    Result := (Version = '') or (Version = '0.0.0.0')
  else if RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    Result := (Version = '') or (Version = '0.0.0.0');
end;
