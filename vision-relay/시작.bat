@echo off
chcp 65001 >nul
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop 이 없습니다. VPS 에서는 start.sh 를 쓰세요.
  pause
  exit /b 1
)

set PUB=
for /f "delims=" %%i in ('curl -s https://api.ipify.org') do set PUB=%%i
if "%PUB%"=="" set PUB=127.0.0.1
set HLS_HOST=%PUB:.=-%.sslip.io

echo 중계를 켭니다...
docker compose up -d
if errorlevel 1 (
  echo 실행에 실패했습니다. Docker 를 켠 다음 다시 눌러 주세요.
  pause
  exit /b 1
)

echo.
echo ===============================
echo  SafeNex 비전 관제 중계 저장
echo     %PUB%
echo  VIGI RTMP
echo     rtmp://%PUB%:1935/live
echo ===============================
echo.
echo 사무실 PC 가 아니라 공인 IP VPS 에서 실행하세요. 포트 1935, 80, 443.
pause
