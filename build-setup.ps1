$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "release-desktop\webbundle.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
$distDir = (Resolve-Path "dist").Path
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $distDir,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$outExe = "release-desktop\SafeNex_PC_Setup_1.1.1.exe"
$icoPath = "release-desktop\safenex.ico"
$resArg = "/resource:$zipPath,webbundle.zip"

& $csc /nologo /utf8output /target:winexe /out:$outExe `
    /win32icon:$icoPath `
    /r:System.dll `
    /r:System.Drawing.dll `
    /r:System.Windows.Forms.dll `
    /r:System.IO.Compression.dll `
    /r:System.IO.Compression.FileSystem.dll `
    /r:Microsoft.CSharp.dll `
    $resArg `
    "electron\SafeNexWindowsSetup.cs"

$desktopDir = [Environment]::GetFolderPath("Desktop")
$desktopExe = Join-Path $desktopDir "SafeNex_PC_Setup_1.1.1.exe"
Copy-Item $outExe $desktopExe -Force

$downDir = Join-Path $env:USERPROFILE "Downloads"
if (Test-Path $downDir) {
    Copy-Item $outExe (Join-Path $downDir "SafeNex_PC_Setup_1.1.1.exe") -Force
}

Get-Item $outExe, $desktopExe | Select-Object FullName, Length, LastWriteTime
