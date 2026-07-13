# -*- mode: python ; coding: utf-8 -*-
"""
Eyelingo desktop — PyInstaller spec (Windows + macOS + Linux, jeden plik).

Uruchomienie:  pyinstaller eyelingo.spec --noconfirm
Wynik:         dist/Eyelingo/  (Windows/Linux)  ·  dist/Eyelingo.app  (macOS)

Ikony powstają wcześniej:  python tools/make_icons.py
"""
import os
import sys

from PyInstaller.utils.hooks import collect_all

APP_NAME = "Eyelingo"
VERSION  = os.environ.get("EYELINGO_VERSION", "1.0.0")

IS_WIN = sys.platform.startswith("win")
IS_MAC = sys.platform == "darwin"

# ── Zasoby dołączane do paczki ───────────────────────────────────────────────
# .env jest OPCJONALNY — aplikacja ma wbudowany publiczny klucz anon (chroni go RLS).
datas       = []
binaries    = []
hiddenimports = ["PyQt6.QtMultimedia"]

for res in ("eyelingomark.png", "logo_transparent_navy.png", "logo_navy.png", ".env"):
    if os.path.exists(res):
        datas.append((res, "."))

# supabase + zależności HTTP potrafią gubić submoduły przy zamrażaniu — zbieramy jawnie.
for pkg in ("supabase", "gotrue", "supabase_auth", "postgrest", "realtime",
            "storage3", "supafunc", "httpx", "httpcore", "h11", "h2", "gtts",
            "certifi", "dotenv"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass  # pakiet nieobecny w danym środowisku — pomijamy

# `keyboard` tylko na Windows (na macOS wymaga roota; kod i tak go tam nie importuje).
excludes = ["playsound", "tkinter", "matplotlib", "numpy", "pandas",
            "PyQt6.QtWebEngineCore", "PyQt6.QtWebEngineWidgets", "PyQt6.Qt3DCore"]
if IS_WIN:
    hiddenimports.append("keyboard")
else:
    excludes.append("keyboard")

# ── Ikona ────────────────────────────────────────────────────────────────────
icon = None
if IS_WIN and os.path.exists(os.path.join("assets", "icon.ico")):
    icon = os.path.join("assets", "icon.ico")
elif IS_MAC and os.path.exists(os.path.join("assets", "icon.icns")):
    icon = os.path.join("assets", "icon.icns")


a = Analysis(
    ["fiszki_app.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,              # UPX = fałszywe alarmy antywirusów. Nie warto.
    console=False,          # aplikacja w zasobniku, bez okna konsoli
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,       # buildujemy natywnie per-runner (arm64 / x86_64)
    codesign_identity=None,
    entitlements_file=None,
    icon=icon,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name=APP_NAME,
)

if IS_MAC:
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        icon=icon,
        bundle_identifier="com.eyelingo.desktop",
        version=VERSION,
        info_plist={
            # Aplikacja żyje w pasku menu, bez ikony w Docku (parytet z _apply_macos_accessory).
            "LSUIElement": True,
            "CFBundleShortVersionString": VERSION,
            "CFBundleVersion": VERSION,
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
            "NSHumanReadableCopyright": "© Eyelingo",
        },
    )
