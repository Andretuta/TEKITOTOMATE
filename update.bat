@echo off
title Bot Auto-Update
color 0A

echo ========================================
echo    ATUALIZACAO AUTOMATICA DO BOT
echo    Repo: github.com/Andretuta/TEKITOTOMATE
echo ========================================
echo.

cd /d "%~dp0"

:: Configurar repositorio se necessario
set REPO_URL=https://github.com/Andretuta/TEKITOTOMATE.git

echo [1/5] Verificando configuracao do Git...
git remote get-url origin >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [!] Configurando repositorio remoto...
    git remote add origin %REPO_URL%
) else (
    echo [OK] Repositorio configurado
)

echo.
echo [2/5] Buscando atualizacoes...
git fetch origin

FOR /F "tokens=*" %%i IN ('git rev-parse HEAD 2^>nul') DO SET LOCAL=%%i
FOR /F "tokens=*" %%i IN ('git rev-parse origin/main 2^>nul') DO SET REMOTE=%%i

if "%LOCAL%"=="%REMOTE%" (
    echo.
    echo [OK] Bot ja esta atualizado!
    echo     Versao: %LOCAL:~0,8%
    echo.
    pause
    exit /b 0
)

echo.
echo [!] Nova versao disponivel!
echo     Local:  %LOCAL:~0,8%
echo     Remoto: %REMOTE:~0,8%
echo.

echo [3/5] Baixando atualizacoes...
git pull origin main

if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Falha ao baixar atualizacoes!
    echo Tente: git stash e execute novamente
    pause
    exit /b 1
)

echo.
echo [4/5] Instalando dependencias...
call npm install

echo.
echo [5/5] Limpando cache...
if exist "session_baileys" (
    echo Removendo sessao antiga...
    rmdir /s /q session_baileys
)
if exist "session_data" (
    echo Removendo sessao legada...
    rmdir /s /q session_data
)

echo.
echo ========================================
echo    BOT ATUALIZADO COM SUCESSO!
echo    Nova versao: %REMOTE:~0,8%
echo ========================================
echo.
echo Para iniciar o bot, execute:
echo    node bot.js
echo.
pause
