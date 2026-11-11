@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Instale Node.js 24 ou superior antes de iniciar.
 pause
 exit /b 1
)
echo Traco Barbearia - abra http://localhost:3000 no navegador.
echo Primeiro acesso do proprietario: http://localhost:3000/admin
echo O codigo fica em data\PRIMEIRO-ACESSO.txt apos iniciar.
node --env-file-if-exists=.env server.mjs
pause
