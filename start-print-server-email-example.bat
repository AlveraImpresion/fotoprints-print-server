@echo off
setlocal
cd /d "%~dp0"
set EMAIL_FROM=fotoprints@alveraimpresion.com
set SMTP_HOST=mail.alveraimpresion.com
set SMTP_PORT=587
set SMTP_USER=fotoprints@alveraimpresion.com
set SMTP_PASS=pon_aqui_la_contraseña_del_correo
node server.js
