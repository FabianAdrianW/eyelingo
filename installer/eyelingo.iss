; Eyelingo — instalator Windows (Inno Setup 6)
; Kompilacja:  iscc installer\eyelingo.iss
; Wejście:     dist\Eyelingo\  (wynik PyInstaller)
; Wyjście:     installer_out\Eyelingo-Setup-Windows.exe

#define AppName    "Eyelingo"
#define AppVersion GetEnv("EYELINGO_VERSION")
#if AppVersion == ""
  #define AppVersion "1.0.0"
#endif
#define AppPublisher "Eyelingo"
#define AppURL       "https://fabianadrianw.github.io/eyelingo/"
#define AppExe       "Eyelingo.exe"

[Setup]
AppId={{9F2B4C1E-7A55-4E3D-9C10-EYELINGO0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Instalacja per-user nie wymaga uprawnień administratora — mniej tarcia przy pierwszym uruchomieniu.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\installer_out
OutputBaseFilename=Eyelingo-Setup-Windows
SetupIconFile=..\assets\icon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
UninstallDisplayIcon={app}\{#AppExe}

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Tasks]
Name: "desktopicon";  Description: "Utwórz skrót na pulpicie";                 GroupDescription: "Skróty:"
Name: "startupicon";  Description: "Uruchamiaj Eyelingo przy starcie systemu"; GroupDescription: "Skróty:"; Flags: unchecked

[Files]
Source: "..\dist\Eyelingo\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}";           Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}";     Filename: "{app}\{#AppExe}"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}";     Filename: "{app}\{#AppExe}"; Tasks: startupicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Uruchom {#AppName}"; Flags: nowait postinstall skipifsilent
