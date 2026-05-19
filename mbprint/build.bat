@echo off
setlocal

echo ============================================
echo  MB Print v1 — Build
echo ============================================

:: Activate venv if present
if exist ".venv\Scripts\activate.bat" (
    call .venv\Scripts\activate.bat
) else (
    echo [!] No se encontro .venv — usando Python del sistema
)

:: Install deps
echo [1/3] Instalando dependencias...
pip install -r requirements.txt --quiet

:: Copy icon to dist source
copy ..\apple-touch-icon.png apple-touch-icon.png >nul 2>&1

:: Build
echo [2/3] Compilando con PyInstaller...
pyinstaller ^
    --onefile ^
    --windowed ^
    --name "MBPrint" ^
    --icon "apple-touch-icon.png" ^
    --add-data "apple-touch-icon.png;." ^
    --hidden-import "escpos" ^
    --hidden-import "usb" ^
    --hidden-import "usb.backend.libusb1" ^
    --hidden-import "usb.backend.libusb0" ^
    --hidden-import "usb.backend.openusb" ^
    main.py

echo [3/3] Limpiando archivos temporales...
if exist "build" rmdir /s /q build
if exist "MBPrint.spec" del /q MBPrint.spec
if exist "apple-touch-icon.png" del /q apple-touch-icon.png

echo.
echo ============================================
echo  Listo: dist\MBPrint.exe
echo ============================================
pause
