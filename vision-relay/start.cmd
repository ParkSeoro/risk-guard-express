@echo off
setlocal
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 goto NODKR

echo Starting relay...
docker compose up -d
if errorlevel 1 goto FAIL

set PUB=
for /f "usebackq delims=" %%i in (`curl -s https://api.ipify.org`) do set PUB=%%i
if "%PUB%"=="" set PUB=YOUR.PUBLIC.IP

set OUT=%~dp0relay-urls.txt
> "%OUT%" echo SafeNex URL:
>> "%OUT%" echo http://%PUB%:8888
>> "%OUT%" echo.
>> "%OUT%" echo VIGI RTMP H.264:
>> "%OUT%" echo rtmp://%PUB%:1935/cam1
>> "%OUT%" echo rtmp://%PUB%:1935/cam2
>> "%OUT%" echo rtmp://%PUB%:1935/cam3
>> "%OUT%" echo rtmp://%PUB%:1935/cam4

echo.
echo OK. Notepad will show the URLs.
echo SafeNex: http://%PUB%:8888
start notepad "%OUT%"
goto END

:NODKR
echo Docker Desktop is not installed.
echo 1. Install Docker Desktop
echo    https://www.docker.com/products/docker-desktop
echo 2. Start Docker Desktop and wait until it is running
echo 3. Double-click start.cmd again
goto END

:FAIL
echo docker compose failed.
echo Open Docker Desktop, wait until it is ready, then double-click start.cmd again.
goto END

:END
echo.
pause
