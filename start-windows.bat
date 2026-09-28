@echo off
chcp 65001 >nul
rem RefBoard 실행기 (Windows) - 더블클릭하세요.
rem 처음 실행할 때 Node.js 와 필요한 패키지를 설치하고, 준비되면 브라우저를 엽니다.
cd /d "%~dp0"
echo RefBoard 준비 중...

where node >nul 2>nul
if errorlevel 1 goto install_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"
if errorlevel 1 goto old_node
goto packages

:install_node
echo Node.js 를 설치합니다 (winget)...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 goto manual_node
echo.
echo Node.js 설치가 끝났습니다. 이 창을 닫고 start-windows.bat 을 다시 실행하세요.
pause
exit /b 0

:old_node
echo Node.js 버전이 낮습니다. 22 이상이 필요합니다.
:manual_node
echo 열리는 페이지에서 Windows 설치 파일(LTS)을 받아 설치한 뒤, 이 파일을 다시 실행하세요.
start "" "https://nodejs.org/ko/download"
pause
exit /b 1

:packages
if exist node_modules\.package-lock.json goto run
echo 필요한 패키지를 설치합니다 (처음 한 번, 1~2분 걸립니다)...
call npm install
if errorlevel 1 goto failed

:run
call npm run app
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo 실행 중 오류가 났습니다. 위 메시지를 확인하세요.
pause
exit /b 1
