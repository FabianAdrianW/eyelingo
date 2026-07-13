# -*- coding: utf-8 -*-
"""
Generuje ikony aplikacji z icon512.png:
  assets/icon.ico   — Windows (wszystkie rozmiary w jednym pliku)
  assets/icon.icns  — macOS   (przez iconutil; tylko na macOS)

Uruchomienie:  python tools/make_icons.py
Zależność:     pillow
Bez ikon build i tak przejdzie — będzie tylko domyślna ikona systemowa.
"""
import os
import shutil
import subprocess
import sys

SRC_CANDIDATES = ["icon512.png", "assets/icon512.png", "eyelingomark.png"]
OUT_DIR = "assets"


def _source():
    for p in SRC_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


def make_ico(src):
    try:
        from PIL import Image
    except ImportError:
        print("[ICO] brak Pillow — pomijam (pip install pillow)")
        return
    img = Image.open(src).convert("RGBA")
    out = os.path.join(OUT_DIR, "icon.ico")
    img.save(out, format="ICO",
             sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"[ICO] {out}")


def make_icns(src):
    if sys.platform != "darwin":
        print("[ICNS] pomijam — .icns buduje się tylko na macOS (iconutil)")
        return
    try:
        from PIL import Image
    except ImportError:
        print("[ICNS] brak Pillow — pomijam")
        return
    img = Image.open(src).convert("RGBA")
    iconset = os.path.join(OUT_DIR, "icon.iconset")
    shutil.rmtree(iconset, ignore_errors=True)
    os.makedirs(iconset, exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        img.resize((size, size), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}.png"))
        img.resize((size * 2, size * 2), Image.LANCZOS).save(
            os.path.join(iconset, f"icon_{size}x{size}@2x.png"))
    out = os.path.join(OUT_DIR, "icon.icns")
    subprocess.check_call(["iconutil", "-c", "icns", iconset, "-o", out])
    shutil.rmtree(iconset, ignore_errors=True)
    print(f"[ICNS] {out}")


def main():
    src = _source()
    if not src:
        print("[UWAGA] Nie znalazłem icon512.png ani eyelingomark.png — build pójdzie bez ikony.")
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"[SRC] {src}")
    make_ico(src)
    make_icns(src)


if __name__ == "__main__":
    main()
