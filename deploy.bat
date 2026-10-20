@echo off
REM Copy the game into XAMPP's htdocs (existing leaderboard data is kept)
set "TARGET=C:\xampp\htdocs\easygame"
if not "%~1"=="" set "TARGET=%~1"

if not exist "C:\xampp\htdocs" if "%~1"=="" (
  echo [ERROR] C:\xampp\htdocs not found. Install XAMPP first, or run: deploy.bat "D:\your\xampp\htdocs\easygame"
  pause
  exit /b 1
)

robocopy "%~dp0." "%TARGET%" /E /XD .claude .git /XF deploy.bat README.md scores.json /NFL /NDL /NJH /NP
if %ERRORLEVEL% GEQ 8 (
  echo [ERROR] Copy failed.
  pause
  exit /b 1
)

echo.
echo Done! Deployed to %TARGET%
echo 1. Open XAMPP Control Panel and click "Start" next to Apache
echo 2. Browse to http://localhost/easygame/
pause
