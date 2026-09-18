@echo off
chcp 65001 >nul
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop 이 없습니다. https://www.docker.com/products/docker-desktop 설치 후 다시 실행하세요.
  pause
  exit /b 1
)

echo 중계를 켭니다...
docker compose up -d
if errorlevel 1 (
  echo 실행에 실패했습니다. Docker Desktop 을 켠 다음 다시 눌러 주세요.
  pause
  exit /b 1
)

set PUB=
for /f "delims=" %%i in ('curl -s https://api.ipify.org') do set PUB=%%i
if "%PUB%"=="" set PUB=여기.공인.IP

echo.
echo ===============================
echo  1) SafeNex 비전 관제에 붙여넣을 중계주소
echo     http://%PUB%:8888
echo.
echo  2) 카메라 RTMP 서버 주소 (H.264, 한 대씩)
echo     rtmp://%PUB%:1935/cam1
echo     rtmp://%PUB%:1935/cam2
echo     rtmp://%PUB%:1935/cam3
echo     rtmp://%PUB%:1935/cam4
echo ===============================
echo.
echo 공인 IP 가 틀리면 공유기에서 1935, 8888 포트포워드를 이 PC 로 열어 주세요.
pause
