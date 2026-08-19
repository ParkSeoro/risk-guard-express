#define AppName "SafeNex Vision Edge"
#define AppVersion "0.1.0"
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

[Icons]
Name: "{autoprograms}\SafeNex Vision Edge"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\SafeNex Vision Edge 관제"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "바탕화면에 관제 아이콘 만들기"; GroupDescription: "추가 아이콘:"; Flags: checkedonce

[Run]
Filename: "{app}\{#AppExeName}"; Description: "SafeNex Vision Edge 관제 시작"; Flags: nowait postinstall skipifsilent
