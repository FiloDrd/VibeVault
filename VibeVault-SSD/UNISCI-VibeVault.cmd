@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo  VibeVault 0.2.0 - ricompongo VibeVault.exe dalle 8 parti...
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
certutil -hashfile VibeVault.exe SHA256 | findstr /i /c:"a0c671b565cd4628b7e1074f49b1ab68552598502692a049438f02654b8d2bfa" >nul
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
del VibeVault.exe.part??
:fine
echo.
echo  Fatto. Copia VibeVault.exe e "ISTRUZIONI VibeVault.txt" dove preferisci
echo  (anche sull'SSD, accanto alla cartella delle foto) e avvialo con doppio clic.
echo.
pause
