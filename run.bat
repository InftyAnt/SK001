@echo off
setlocal ENABLEEXTENSIONS

cd /d "%~dp0"

set "PORT=%~1"
if "%PORT%"=="" set "PORT=4173"

set "PY_CMD="
py -3 --version >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3"

if not defined PY_CMD (
	python --version >nul 2>&1
	if not errorlevel 1 set "PY_CMD=python"
)

if not defined PY_CMD (
	python3 --version >nul 2>&1
	if not errorlevel 1 set "PY_CMD=python3"
)

if not defined PY_CMD (
	echo [ERROR] Python 3 is not installed or not in PATH.
	echo         Install Python 3 and run again.
	exit /b 1
)

echo [INFO] Starting local server in "%CD%"
echo [INFO] URL: http://localhost:%PORT%
start "" "http://localhost:%PORT%"

%PY_CMD% -m http.server %PORT%

endlocal
