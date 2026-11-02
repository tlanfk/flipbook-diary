@echo off
chcp 65001 >nul
title 일기장 서버 (이 창을 닫으면 일기장이 꺼집니다)
cd /d "%~dp0"
echo 일기장 서버를 켭니다. 주소: http://localhost:8790
echo 이 창을 닫으면 일기장이 꺼집니다.
node node_modules\wrangler\bin\wrangler.js dev --port 8790
pause
