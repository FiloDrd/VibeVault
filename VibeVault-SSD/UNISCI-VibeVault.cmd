@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo  VibeVault - ricompongo VibeVault.exe dalle 8 parti...
echo.
if exist VibeVault.exe (
  echo  VibeVault.exe esiste gia' in questa cartella: non lo sovrascrivo.
  echo  Rinominalo o spostalo e rilancia questo file.
  pause
  exit /b 1
)
for %%P in (00 01 02 03 04 05 06 07) do (
  if not exist "VibeVault.exe.part%%P" (
    echo  Manca la parte VibeVault.exe.part%%P
    pause
    exit /b 1
  )
)
copy /b VibeVault.exe.part00+VibeVault.exe.part01+VibeVault.exe.part02+VibeVault.exe.part03+VibeVault.exe.part04+VibeVault.exe.part05+VibeVault.exe.part06+VibeVault.exe.part07 VibeVault.exe >nul
echo  Verifico l'integrita' (SHA-256)...
certutil -hashfile VibeVault.exe SHA256 | findstr /i /c:"2a7babe4eb7a8228a669ce9aacb6c57df6b2ec8f4563f5de1b387c3ed97c2bf1" >nul
if errorlevel 1 (
  echo.
  echo  ERRORE: il file ricomposto non corrisponde all'originale. Non usarlo.
  del VibeVault.exe
  pause
  exit /b 1
)
echo.
echo  OK: VibeVault.exe creato e verificato.
echo.
choice /c SN /m " Elimino le 8 parti ormai inutili"
if errorlevel 2 goto fine
del VibeVault.exe.part0?
:fine
echo.
echo  Fatto. Copia VibeVault.exe e "ISTRUZIONI VibeVault.txt" in una cartella sull'SSD
echo  (es. E:\VibeVault\) e avvia VibeVault.exe con doppio clic.
echo.
pause
