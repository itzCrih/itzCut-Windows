Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma

Name "itzCut Desktop"
Caption "itzCut Desktop — Web Installer"
OutFile "..\release\itzCut-WebSetup.exe"
Icon "..\public\icon.ico"

VIProductVersion "2.2.0.0"
VIAddVersionKey "ProductName" "itzCut Desktop"
VIAddVersionKey "CompanyName" "itzcrih.it"
VIAddVersionKey "LegalCopyright" "Copyright (C) 2026 itzcrih.it"
VIAddVersionKey "FileDescription" "itzCut Desktop Web Installer"
VIAddVersionKey "FileVersion" "2.2.0.0"

SilentInstall normal

Section "DownloadAndInstall"
    ; Download the setup package to TEMP using inetc
    inetc::get /BANNER "Downloading itzCut Desktop (v2.2.0)..." "https://github.com/itzCrih/itzCut-Windows/releases/download/v2.2.0/itzCut-Desktop-Setup-2.2.0.exe" "$TEMP\itzCut-Desktop-Setup-Latest.exe" /END
    Pop $0
    
    StrCmp $0 "OK" download_success
    
    MessageBox MB_ICONSTOP|MB_OK "Download failed: $0. Please check your internet connection."
    Quit

download_success:
    Exec '"$TEMP\itzCut-Desktop-Setup-Latest.exe"'
    Quit
SectionEnd
