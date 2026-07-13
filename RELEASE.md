# Eyelingo desktop — wydanie (Windows + macOS)

Zastępuje `BUILD.md`, który opisywał pliki (`eyelingo.spec`, `setup_py2app.py`), jakich
nigdy nie było w repo.

Zasada: **nie da się zbudować `.exe` na Macu ani `.dmg` na Windows.** PyInstaller nie
kompiluje skrośnie. Dlatego wydania robi GitHub Actions — trzy równoległe maszyny,
każda buduje swoją platformę natywnie.

---

## 1. Co gdzie leży (układ repo)

```
eyelingo/
├── fiszki_app.py                       # aplikacja
├── index.html                          # web (sekcja „Pobierz" linkuje do Releases)
├── icon512.png                         # źródło ikon
├── eyelingo.spec                       # PyInstaller (Windows + macOS + Linux)
├── requirements-desktop.txt
├── tools/make_icons.py                 # icon512.png → assets/icon.ico + icon.icns
├── installer/
│   ├── eyelingo.iss                    # Inno Setup → Eyelingo-Setup-Windows.exe
│   └── macos/PRZECZYTAJ_MNIE.txt       # ląduje w .dmg
├── sql/migrate_word_progress_to_srs.sql
└── .github/workflows/desktop-release.yml
```

## 2. Jak wypuścić wersję

```bash
git tag v1.0.0
git push origin v1.0.0
```

Workflow zbuduje trzy paczki i sam utworzy **GitHub Release**:

| Plik | System |
|---|---|
| `Eyelingo-Setup-Windows.exe` | Windows 10/11 x64 |
| `Eyelingo-macOS-AppleSilicon.dmg` | macOS 11+ · M1–M4 |
| `Eyelingo-macOS-Intel.dmg` | macOS 11+ · Intel |

Strona pobiera je z `releases/latest/download/…`, więc **po pierwszym wydaniu nie trzeba
już nic zmieniać w `index.html`** — kolejne tagi automatycznie stają się „najnowszą wersją".

Alternatywnie: Actions → *Eyelingo desktop — build & release* → **Run workflow** (wpisz wersję ręcznie).

## 3. Build lokalny (do testów)

```bash
pip install -r requirements-desktop.txt pyinstaller pillow
python tools/make_icons.py
pyinstaller eyelingo.spec --noconfirm
```
- Windows → `dist/Eyelingo/Eyelingo.exe`
- macOS → `dist/Eyelingo.app` (przed uruchomieniem: `codesign --force --deep --sign - dist/Eyelingo.app`)

`.env` **nie jest już wymagany** — publiczny klucz anon jest wbudowany w kod (ten sam, który
i tak leży jawnie w `index.html`; chroni go RLS). `.env` nadal nadpisuje wartości w trybie dev.

## 4. Podpis kodu — stan i konsekwencje

Aplikacja **nie jest podpisana certyfikatem wydawcy**. Skutki dla użytkownika:

| System | Co zobaczy | Obejście |
|---|---|---|
| Windows | SmartScreen: „Windows chronił Twój komputer" | Więcej informacji → Uruchom mimo to |
| macOS | Gatekeeper blokuje, czasem „aplikacja jest uszkodzona" | prawy klik → Otwórz → Otwórz, ewentualnie `xattr -dr com.apple.quarantine /Applications/Eyelingo.app` |

macOS jest tu twardszy niż Windows — to nie ostrzeżenie, to ściana, którą trzeba świadomie obejść.
Realnie odsieje to część użytkowników.

**Żeby to zniknęło:**
- macOS: Apple Developer Program (99 USD/rok) → `Developer ID Application` + notaryzacja w CI.
  Workflow jest już przygotowany na wpięcie kroku podpisu — trzeba dołożyć sekrety
  (`APPLE_CERT_P12`, `APPLE_CERT_PASSWORD`, `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`).
- Windows: certyfikat OV/EV (~1200–1800 zł/rok). Bez EV reputacja SmartScreen i tak buduje się
  przez kilka tygodni pobrań, więc na start nie ma wielkiego sensu.

## 5. Migracja bazy — ZRÓB TO RAZ, przed pierwszym wydaniem

Supabase → SQL Editor → uruchom `sql/migrate_word_progress_to_srs.sql`.

Bez tego historia nauki z desktopu (tabela `word_progress`) nie pojawi się w kanonicznym
`srs_progress`, czyli nie zobaczy jej ani web, ani mobile.

## 6. Checklista wydania

- [ ] `sql/migrate_word_progress_to_srs.sql` uruchomiony w Supabase
- [ ] repo publiczne (darmowe minuty macOS w Actions)
- [ ] `git tag v1.0.0 && git push origin v1.0.0`
- [ ] Release ma trzy assety o dokładnie tych nazwach, co w `index.html`
- [ ] Test Windows: instalacja → logowanie → nakładka na wierzchu → zasobnik → test → audio
- [ ] Test macOS: prawy klik → Otwórz → ikona w pasku menu (nie w Docku) → nakładka → audio
- [ ] Test cross-surface: zrób test na desktopie → sprawdź, czy licznik „Opanowane" w web się ruszył
