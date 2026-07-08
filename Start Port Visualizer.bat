@echo off
rem Launch the packaged app if it exists, otherwise run from source.
set "EXE=%~dp0release\win-unpacked\Port Visualizer.exe"
if exist "%EXE%" (
  start "" "%EXE%"
) else (
  echo Packaged build not found - building and starting from source...
  cd /d "%~dp0"
  call npm run build && call npm start
)
