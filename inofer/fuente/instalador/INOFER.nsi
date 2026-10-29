; Instalador de INOFER para Windows (NSIS). Se arma con fuente/armar_instalador.sh
; Instala sin permisos de administrador en %LOCALAPPDATA%\INOFER, con Java incluido.
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "2.6"
!endif
!define APP "INOFER"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\INOFER"

Name "${APP}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\INOFER"
RequestExecutionLevel user
BrandingText "INOFER · Sistema de inyección y planificación"
VIProductVersion "${VERSION}.0.0"
VIAddVersionKey "ProductName" "INOFER"
VIAddVersionKey "CompanyName" "INOFER"
VIAddVersionKey "FileDescription" "Instalador de INOFER"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "INOFER"

!define MUI_ICON "${SRC}\INOFER.ico"
!define MUI_UNICON "${SRC}\INOFER.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Bienvenido a INOFER"
!define MUI_WELCOMEPAGE_TEXT "Este asistente instala INOFER en esta computadora.$\r$\n$\r$\nNo hace falta tener Java ni ser administrador: todo lo necesario viene incluido.$\r$\n$\r$\nTus datos no se tocan. Si ya tenías INOFER, se actualiza.$\r$\n$\r$\nHacé clic en Siguiente para continuar."
!define MUI_FINISHPAGE_TITLE "INOFER quedó instalado"
!define MUI_FINISHPAGE_TEXT "Tenés el ícono INOFER en el Escritorio y en el menú Inicio.$\r$\n$\r$\nLa app se actualiza sola: no hace falta volver a instalarla."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir INOFER ahora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirInofer

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Function AbrirInofer
  Exec '"$INSTDIR\runtime\bin\javaw.exe" -jar "$INSTDIR\INOFER.jar"'
FunctionEnd

!macro CerrarInofer
  ; cierra solo los procesos de INOFER (no otros programas Java)
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='javaw.exe' or Name='java.exe'\" | Where-Object { $$_.CommandLine -like '*INOFER*.jar*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"`
  Pop $0
  Sleep 800
!macroend

Section "INOFER" SecMain
  SetShellVarContext current
  !insertmacro CerrarInofer
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File "${SRC}\INOFER.jar"
  File "${SRC}\INOFER.ico"
  Delete "$INSTDIR\INOFER-nuevo.jar"
  RMDir /r "$INSTDIR\runtime"
  SetOutPath "$INSTDIR\runtime"
  File /r "${JRE}\*.*"
  SetOutPath "$INSTDIR"

  ; accesos directos (reemplazan a los de versiones anteriores)
  Delete "$DESKTOP\INOFER MES.lnk"
  Delete "$SMPROGRAMS\INOFER MES.lnk"
  CreateShortcut "$DESKTOP\INOFER.lnk" "$INSTDIR\runtime\bin\javaw.exe" '-jar "$INSTDIR\INOFER.jar"' "$INSTDIR\INOFER.ico" 0 SW_SHOWNORMAL "" "INOFER"
  CreateShortcut "$SMPROGRAMS\INOFER.lnk" "$INSTDIR\runtime\bin\javaw.exe" '-jar "$INSTDIR\INOFER.jar"' "$INSTDIR\INOFER.ico" 0 SW_SHOWNORMAL "" "INOFER"

  ; "Agregar o quitar programas"
  WriteUninstaller "$INSTDIR\Desinstalar INOFER.exe"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "INOFER"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "INOFER"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\INOFER.ico"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Desinstalar INOFER.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !insertmacro CerrarInofer
  Delete "$DESKTOP\INOFER.lnk"
  Delete "$SMPROGRAMS\INOFER.lnk"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\INOFER.jar"
  Delete "$INSTDIR\INOFER-nuevo.jar"
  Delete "$INSTDIR\INOFER.ico"
  Delete "$INSTDIR\actualizacion_fallida.txt"
  Delete "$INSTDIR\Desinstalar INOFER.exe"
  RMDir /r "$INSTDIR\web"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  ; los datos de la planta (%APPDATA%\INOFER_MES) y la nube NO se borran
SectionEnd
