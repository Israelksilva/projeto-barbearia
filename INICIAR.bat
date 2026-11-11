@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Instale Node.js 24 ou superior.
 pause
 exit /b 1
)
if not exist "node_modules\@libsql\client\package.json" (
 call npm ci
 if errorlevel 1 (
  pause
  exit /b 1
 )
)
echo Abra http://localhost:3000. Painel: http://localhost:3000/admin
node --env-file-if-exists=.env server.mjs
pause
