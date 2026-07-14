; Eyelingo - instalator Windows (Inno Setup 6)
; Kompilacja: iscc installer\eyelingo.iss
; Wejscie:    dist\Eyelingo\      (wynik PyInstaller)
; Wyjscie:    installer_out\Eyelingo-Setup-Windows.exe
;
; UWAGA: plik MUSI byc zapisany jako UTF-8 z BOM. Inno Setup 6.7 bez BOM-u
; czyta go jako ANSI i rozsypuje sie na pierwszym nie-ASCII znaku.
; Dlatego komentarze i dyrektywy sa tu czysto ASCII.

#define AppName      "Eyelingo"
#define AppPublisher "Eyelingo"
#define AppURL       "https://fabianadrianw.github.io/eyelingo/"
#define AppExe       "Eyelingo.exe"

; Wersja wstrzykiwana przez CI (zmienna srodowiskowa EYELINGO_VERSION).
#define AppVersion GetEnv("EYELINGO_VERSION")
#if AppVersion == ""
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{9F2B4C1E-7A55-4E3D-9C10-EYELINGO0001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
DefaultDirName={commonpf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes

; Instalacja do C:\Program Files, per-machine, z podniesieniem uprawnien.
; POWOD: Smart App Control (Windows 11) traktuje niepodpisane pliki wykonywalne
; w katalogach zapisywalnych przez uzytkownika (AppData) jako wzorzec zagrozenia
; i blokuje je twardo. Program Files przechodzi lagodniejsza ocene.
PrivilegesRequired=admin

; AKTUALIZACJA W MIEJSCU: ten sam AppId => instalator nadpisuje poprzednia wersje.
; Uzytkownik NIE odinstalowuje niczego, ustawienia zostaja (leza w katalogu domowym).
; CloseApplications pozwala zamknac dzialajacego Eyelingo i podmienic pliki -
; bez tego aktualizacja z poziomu aplikacji nie mialaby jak sie powiesc.
CloseApplications=yes
RestartApplications=yes

OutputDir=..\installer_out
OutputBaseFilename=Eyelingo-Setup-Windows
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible

[Languages]
Name: "polish"; MessagesFile: "compiler:Languages\Polish.isl"

[Tasks]
Name: "desktopicon"; Description: "Utwórz skrót na pulpicie"; GroupDescription: "Skróty:"
Name: "startupicon"; Description: "Uruchamiaj Eyelingo przy starcie systemu"; GroupDescription: "Skróty:"; Flags: unchecked

[Files]
Source: "..\dist\Eyelingo\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}";       Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: startupicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Uruchom {#AppName}"; Flags: nowait postinstall skipifsilent
