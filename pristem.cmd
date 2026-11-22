@echo off
rem ============================================================================
rem  pristem - single entry point
rem
rem    pristem            open the desktop window (builds first if never built)
rem    pristem build      force rebuild UI + shell, then open
rem    pristem serve      headless service -> http://127.0.0.1:8787 (debug / CI)
rem    pristem help       this text
rem
rem  Desktop + Start Menu shortcuts are installed by launch\install-shortcuts.ps1.
rem  They call this script through launch\pristem-launch.vbs so no console flashes.
rem
rem  NOTE: the gnullvm host links against libunwind.dll + std-*.dll from the rust
rem  sysroot, which cargo only injects for `cargo run`. A plain double-click of
rem  target\debug\pristem-desktop.exe dies silently unless those two DLLs sit
rem  next to it - :ensure_runtime copies them, so opening never depends on PATH.
rem ============================================================================
setlocal
set "ROOT=%~dp0"
set "SHELL=%ROOT%pristem-desktop\shell"
set "UI=%ROOT%pristem-desktop\ui"
set "BIN=%SHELL%\target\debug"
set "EXE=%BIN%\pristem-desktop.exe"

set "VERB=%~1"
set "HIDDEN=0"
if /i "%VERB%"=="hidden" ( set "HIDDEN=1" & set "VERB=" )
if /i "%VERB%"=="build"   goto build
if /i "%VERB%"=="serve"   goto serve
if /i "%VERB%"=="help"    goto help
if /i "%VERB%"=="/?"      goto help
if /i "%VERB%"=="-h"      goto help
if /i "%VERB%"=="--help"  goto help
goto open

:open
if not exist "%EXE%"                goto bootstrap
if not exist "%UI%\dist\index.html" goto bootstrap
call :ensure_runtime
if errorlevel 1 goto fail
pushd "%ROOT%" >nul
"%EXE%"
set "RC=%ERRORLEVEL%"
popd >nul
if not "%RC%"=="0" goto fail
endlocal & exit /b 0

:bootstrap
echo [pristem] no build found - building once (subsequent launches are instant)...
call :dobuild
if errorlevel 1 goto fail
goto open

:build
call :dobuild
if errorlevel 1 goto fail
goto open

:serve
if not exist "%EXE%" (
  call :dobuild
  if errorlevel 1 goto fail
)
call :ensure_runtime
echo [pristem] service mode: http://127.0.0.1:8787  (Ctrl+C to stop)
"%EXE%" --no-window
endlocal & exit /b %ERRORLEVEL%

:dobuild
rem  A running exe is locked on Windows - cargo cannot relink over it.
taskkill /im pristem-desktop.exe /f >nul 2>&1
if not errorlevel 1 echo [pristem] closed the running window to rebuild.
echo [pristem] building renderer (pnpm build)...
pushd "%UI%" >nul
call pnpm build
if errorlevel 1 (popd >nul & exit /b 1)
popd >nul
echo [pristem] building desktop shell (cargo build)...
pushd "%SHELL%" >nul
cargo build
if errorlevel 1 (popd >nul & exit /b 1)
popd >nul
echo [pristem] build ok.
exit /b 0

:ensure_runtime
rem  Already staged next to the exe? Nothing to do.
if exist "%BIN%\libunwind.dll" if exist "%BIN%\std-*.dll" exit /b 0
set "SYSROOT="
for /f "delims=" %%I in ('rustc --print sysroot 2^>nul') do set "SYSROOT=%%I"
if not defined SYSROOT (
  echo [pristem] warning: rustc not on PATH, cannot stage runtime DLLs.
  echo [pristem] if the window does not appear, run this from a rust-enabled shell.
  exit /b 0
)
echo [pristem] staging runtime DLLs from "%SYSROOT%\bin"...
copy /y "%SYSROOT%\bin\libunwind.dll" "%BIN%\" >nul
copy /y "%SYSROOT%\bin\std-*.dll" "%BIN%\" >nul
if not exist "%BIN%\libunwind.dll" (
  echo [pristem] error: failed to stage libunwind.dll
  exit /b 1
)
exit /b 0

:help
echo.
echo   pristem            open the desktop window (builds first if needed)
echo   pristem build      force rebuild UI + shell, then open
echo   pristem serve      headless service at http://127.0.0.1:8787
echo   pristem help       this text
echo.
echo   Day to day, use the desktop / Start Menu shortcut instead.
echo   Reinstall shortcuts:
echo     powershell -ExecutionPolicy Bypass -File "%~dp0launch\install-shortcuts.ps1"
echo.
endlocal & exit /b 0

:fail
echo.
echo [pristem] launch failed - see the output above.
if "%HIDDEN%"=="1" powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('pristem failed to start. Run pristem.cmd in this folder to see the full output.','pristem')" >nul 2>&1
endlocal & exit /b 1
