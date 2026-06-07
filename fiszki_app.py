"""
FISZKI W TLE – wersja kompletna (moduły 1–8 scalone)
Wymagania: pip install PyQt6 supabase python-dotenv
"""

import sys
import json
import webbrowser
import urllib.request
import urllib.parse
from pathlib import Path

from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout,
    QLabel, QLineEdit, QSystemTrayIcon, QScrollArea,
    QMenu, QPushButton, QGridLayout, QMessageBox, QHBoxLayout
)
from PyQt6.QtCore import Qt, QTimer, QThread, pyqtSignal
from PyQt6.QtGui import QFont, QColor, QIcon, QPixmap, QPainter, QBrush, QPen

import os
from dotenv import load_dotenv

# ── TTS (gTTS + playsound) ──────────────────────────
_tts_available = False

def _ensure_tts():
    global _tts_available
    try:
        from gtts import gTTS
        import playsound
        _tts_available = True
        return True
    except ImportError:
        pass
    try:
        import subprocess, sys
        print("[TTS] Instaluję gtts i playsound...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "gtts", "playsound==1.2.2", "-q"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        from gtts import gTTS
        import playsound
        _tts_available = True
        print("[TTS] Zainstalowano pomyślnie.")
        return True
    except Exception as e:
        print(f"[TTS] Nie udało się zainstalować: {e}")
        return False

_ensure_tts()

def _jp_tts_word(word):
    """Wytnij z japońskiego słowa tylko kanji (usuń hiragana/katakana jeśli jest kanji)."""
    import re as _re
    # Usuń romaji w nawiasie: "食べる (taberu)" → "食べる"
    word = _re.sub(r'\s*\([^)]*\)', '', word).strip()
    # Rozdziel po ・ jeśli jest mieszane
    parts = [p.strip() for p in word.split('・') if p.strip()]
    if len(parts) > 1:
        # Sprawdź które części mają kanji (CJK Unified Ideographs: U+4E00–U+9FFF)
        kanji_parts = [p for p in parts if any('一' <= ch <= '鿿' for ch in p)]
        if kanji_parts:
            return kanji_parts[0]  # Czytaj tylko pierwsze kanji
        # Brak kanji - weź ostatnią (zwykle kanji lub kana bez romaji)
        return parts[-1]
    # Jedna część - jeśli jest kanji, użyj jej
    has_kanji = any('一' <= ch <= '鿿' for ch in word)
    if has_kanji:
        # Usuń hiragana/katakana przed kanji jeśli jest (np. "たべる食べる" → "食べる")
        kanji_only = _re.sub(r'^[぀-ヿ]+', '', word).strip()
        return kanji_only if kanji_only else word
    return word

LANG_TTS_MAP = {
    "en": "en", "es": "es", "nl": "nl",
    "jp": "ja", "de": "de", "fr": "fr",
}

def speak_word(word, lang_code):
    """Czytaj słowo przez gTTS + playsound w osobnym wątku."""
    if not _tts_available:
        return
    try:
        if not APP_SETTINGS.get("audio_enabled", False):
            return
    except Exception:
        pass
    import threading, tempfile
    def _speak():
        try:
            from gtts import gTTS
            import playsound as ps
            tts_lang = LANG_TTS_MAP.get(lang_code, "en")
            tts = gTTS(text=word, lang=tts_lang, slow=False)
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                tmp = f.name
            tts.save(tmp)
            ps.playsound(tmp)
            os.unlink(tmp)
        except Exception as e:
            print(f"[TTS] {e}")
    threading.Thread(target=_speak, daemon=True).start()
from supabase import create_client, Client

load_dotenv()

# ── POSTHOG ANALITYKI ──────────────────────────────
from posthog import Posthog

_ph = Posthog(
    project_api_key='phc_um2sjdPyZpuwdn4k2bAGeZeD4xCrnUhxzuZGiS4rpPcz',
    host='https://eu.i.posthog.com'
)
_ph_user_id = None  # ustawiany po zalogowaniu

def ph_identify(user_id: str, email: str):
    global _ph_user_id
    _ph_user_id = user_id
    try:
        _ph.identify(distinct_id=user_id, properties={"email": email})
    except Exception:
        pass

def ph_capture(event: str, props: dict = None):
    if _ph_user_id:
        try:
            _ph.capture(distinct_id=_ph_user_id, event=event, properties=props or {})
        except Exception:
            pass

# ───────────────────────────────────────────────────

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[BLAD] Brak SUPABASE_URL lub SUPABASE_KEY w pliku .env")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ──────────────────────────────────────────────────────
# STRIPE
# ──────────────────────────────────────────────────────
STRIPE_PUBLISHABLE_KEY = "pk_test_51TYAtMV05aXKkNZ4865obSfQ3WGFIrP40PNOXX1xUeoQhxOIJWZEnKWaZQGyIw9mtn1wNywS6I2UGfzGts0Cc58300BvCWuVuH"
STRIPE_CHECKOUT_URL = f"{SUPABASE_URL}/functions/v1/stripe-checkout"

STRIPE_PRICES = {
    "premium_monthly": "price_1TYB7jV05aXKkNZ4EbWK2Wrp",
    "premium_yearly":  "price_1TYB7jV05aXKkNZ4LGPUaQmp",
    "en_A1": "price_1TYB7kV05aXKkNZ4gLtfwAcj",
    "en_A2": "price_1TYB7lV05aXKkNZ4Xbx6DJE5",
    "en_B1": "price_1TYB7mV05aXKkNZ4vy4s7A2p",
    "en_B2": "price_1TYB7nV05aXKkNZ4PrULFXQd",
    "en_C1": "price_1TYB7oV05aXKkNZ4udeH2EEz",
    "en_C2": "price_1TYB7pV05aXKkNZ444JxuN5E",
    "es_A1": "price_1TYB7qV05aXKkNZ4geXGcWnN",
    "es_A2": "price_1TYB7rV05aXKkNZ4zskrh0Hx",
    "es_B1": "price_1TYB7rV05aXKkNZ4vIxjquhU",
    "es_B2": "price_1TYB7sV05aXKkNZ4kWEEHg1L",
    "es_C1": "price_1TYB7tV05aXKkNZ4E9TLJX2J",
    "es_C2": "price_1TYB7uV05aXKkNZ41B8ZBXp8",
    "jp_A1": "price_1TYB7vV05aXKkNZ4BAiJzFvt",
    "jp_A2": "price_1TYB7wV05aXKkNZ4ZClRZD3D",
    "jp_B1": "price_1TYB7xV05aXKkNZ4BmL2Tjy4",
    "jp_B2": "price_1TYB7yV05aXKkNZ4lPgp2DbQ",
    "jp_C1": "price_1TYB7yV05aXKkNZ4CFqUpA8g",
    "jp_C2": "price_1TYB7zV05aXKkNZ4dXFS4UPO",
    "nl_A1": "price_1TYB80V05aXKkNZ47DnpYC1G",
    "nl_A2": "price_1TYB81V05aXKkNZ4AAh5bSd5",
    "nl_B1": "price_1TYB82V05aXKkNZ4eCq86z7t",
    "nl_B2": "price_1TYB83V05aXKkNZ4QYaVjw7s",
    "nl_C1": "price_1TYB84V05aXKkNZ4WwI6PF7Q",
    "nl_C2": "price_1TYB85V05aXKkNZ440aOk0fP",
    "en_pack3": "price_1TYB86V05aXKkNZ4eCFCOIVw",
    "es_pack3": "price_1TYB87V05aXKkNZ4oUJ08GgE",
    "jp_pack3": "price_1TYB87V05aXKkNZ4ru3lQ6Fy",
    "nl_pack3": "price_1TYB88V05aXKkNZ45YqcrFnP",
}

def create_checkout_session(price_key: str, user_email: str) -> str | None:
    """Tworzy sesję Stripe Checkout i zwraca URL."""
    try:
        token = ""
        try:
            resp = supabase.auth.get_session()
            if resp and hasattr(resp, 'access_token'):
                token = resp.access_token
            elif resp and hasattr(resp, 'session') and resp.session:
                token = resp.session.access_token
        except Exception:
            pass
        body = json.dumps({
            "price_key": price_key,
            "user_email": user_email,
        }).encode()
        req = urllib.request.Request(
            STRIPE_CHECKOUT_URL,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "apikey": SUPABASE_KEY,
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            return data.get("url")
    except Exception as e:
        print(f"[STRIPE] Błąd checkout: {e}")
        return None

# ──────────────────────────────────────────────────────
# SESJA
# ──────────────────────────────────────────────────────
SESSION_FILE = Path.home() / ".fiszki_session.json"

def save_session(session):
    json.dump({
        "access_token":  session.access_token,
        "refresh_token": session.refresh_token,
    }, open(SESSION_FILE, "w"))

def load_session():
    if not SESSION_FILE.exists():
        return None
    try:
        return json.load(open(SESSION_FILE))
    except Exception:
        return None

def clear_session():
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()

def try_restore_session() -> bool:
    saved = load_session()
    if not saved:
        return False
    try:
        # 1) Ustaw zapisaną sesję w kliencie
        supabase.auth.set_session(saved["access_token"], saved["refresh_token"])
        # 2) Wymuś odświeżenie — zapisany access_token mógł wygasnąć.
        #    Bez tego get_user() w wątkach roboczych zwraca None
        #    ('NoneType' object has no attribute 'user') do czasu re-logowania.
        sess = None
        try:
            resp = supabase.auth.refresh_session(saved["refresh_token"])
            sess = getattr(resp, "session", None)
        except Exception:
            sess = None
        # 3) Fallback — pobierz bieżącą sesję, jeśli refresh nic nie zwrócił
        if sess is None:
            try:
                cur = supabase.auth.get_session()
                sess = getattr(cur, "session", cur)
            except Exception:
                sess = None
        if sess and getattr(sess, "access_token", None):
            save_session(sess)
            # 4) Weryfikacja: użytkownik musi być realnie dostępny
            if current_user() is not None:
                return True
    except Exception:
        pass
    clear_session()
    return False


def current_user():
    """Zwraca obiekt użytkownika lub None.

    Odporne na wygasły access_token: przy braku użytkownika
    próbuje raz odświeżyć sesję i ponawia. Dzięki temu wątki robocze
    nie wywracają się na 'NoneType' object has no attribute 'user'.
    """
    try:
        resp = supabase.auth.get_user()
        if resp and getattr(resp, "user", None):
            return resp.user
    except Exception:
        pass
    try:
        supabase.auth.refresh_session()
        resp = supabase.auth.get_user()
        if resp and getattr(resp, "user", None):
            return resp.user
    except Exception:
        pass
    return None


def current_uid():
    u = current_user()
    if u is None:
        raise RuntimeError("Sesja wygasła — zaloguj się ponownie.")
    return u.id


def current_email():
    u = current_user()
    if u is None:
        raise RuntimeError("Sesja wygasła — zaloguj się ponownie.")
    return u.email


# ──────────────────────────────────────────────────────
# KONFIGURACJA
# ──────────────────────────────────────────────────────
LANGUAGES = [
    {"code": "en", "label": "Angielski",    "flag": "🇬🇧", "available": True},
    {"code": "es", "label": "Hiszpański",   "flag": "🇪🇸", "available": True},
    {"code": "jp", "label": "Japoński",     "flag": "🇯🇵", "available": True},
    {"code": "nl", "label": "Niderlandzki", "flag": "🇳🇱", "available": True},
    {"code": "de", "label": "Niemiecki",    "flag": "🇩🇪", "available": False},
    {"code": "fr", "label": "Francuski",    "flag": "🇫🇷", "available": False},
    {"code": "it", "label": "Włoski",       "flag": "🇮🇹", "available": False},
    {"code": "pt", "label": "Portugalski",  "flag": "🇵🇹", "available": False},
    {"code": "ru", "label": "Rosyjski",     "flag": "🇷🇺", "available": False},
    {"code": "uk", "label": "Ukraiński",    "flag": "🇺🇦", "available": False},
    {"code": "zh", "label": "Chiński",      "flag": "🇨🇳", "available": False},
    {"code": "ko", "label": "Koreański",    "flag": "🇰🇷", "available": False},
    {"code": "ar", "label": "Arabski",      "flag": "🇸🇦", "available": False},
]
LEVELS = [
    {"code": "A1", "label": "A1", "desc": "Początkujący",        "free": False},
    {"code": "A2", "label": "A2", "desc": "Podstawowy",          "free": False},
    {"code": "B1", "label": "B1", "desc": "Średniozaawansowany", "free": False},
    {"code": "B2", "label": "B2", "desc": "Wyższy średni",       "free": False},
    {"code": "C1", "label": "C1", "desc": "Zaawansowany",        "free": False},
    {"code": "C2", "label": "C2", "desc": "Biegły",              "free": False},
]
CATEGORIES = []  # ładowane z bazy po wyborze języka/poziomu

def _jwt_refresh_sync():
    """Synchroniczne odświeżenie tokena JWT."""
    try:
        supabase.auth.refresh_session()
        return True
    except Exception:
        return False


def load_categories(lang=None, level=None, _retry=True):
    global CATEGORIES
    try:
        if lang and level:
            try:
                resp = supabase.rpc("get_categories_for_lang_level", {
                    "p_lang": lang, "p_level": level
                }).execute()
                if resp.data:
                    CATEGORIES = [{"code": r["code"], "label": r.get("label", r["code"]),
                                   "icon": r.get("icon", "📚")}
                                  for r in resp.data]
                    print(f"[CATEGORIES] RPC {lang}/{level}: {len(CATEGORIES)} kategorii")
                    return
            except Exception as e:
                err = str(e)
                if "JWT" in err and _retry:
                    print("[CATEGORIES] JWT wygasł - odświeżam token...")
                    if _jwt_refresh_sync():
                        load_categories(lang, level, _retry=False)
                    return
                print(f"[CATEGORIES] RPC error: {e}")
            # Fallback: wszystkie kategorie
            try:
                resp = supabase.table("categories").select("code,label,icon").order("id").execute()
                CATEGORIES = [{"code": r["code"], "label": r.get("label", r["code"]),
                               "icon": r.get("icon", "📚")}
                              for r in (resp.data or [])]
                print(f"[CATEGORIES] fallback: {len(CATEGORIES)} kategorii")
            except Exception as e2:
                if "JWT" in str(e2) and _retry:
                    if _jwt_refresh_sync():
                        load_categories(lang, level, _retry=False)
            return
        resp = supabase.table("categories").select("code,label,icon").order("id").execute()
        CATEGORIES = [{"code": r["code"], "label": r.get("label", r["code"]),
                       "icon": r.get("icon", "📚")}
                      for r in (resp.data or [])]
    except Exception as e:
        err = str(e)
        if "JWT" in err and _retry:
            if _jwt_refresh_sync():
                load_categories(lang, level, _retry=False)
        else:
            print(f"[CATEGORIES] błąd: {e}")
            CATEGORIES = []

INTERVAL_MS = 6000
OPACITY     = 0.82

# ── USTAWIENIA ─────────────────────────────────────────
import json, pathlib
SETTINGS_FILE = pathlib.Path.home() / ".eyelingo_settings.json"

DEFAULT_SETTINGS = {
    "opacity":      0.82,
    "text_alpha":   240,
    "audio_enabled": False,
    "display_time": 8,
    "card_effect":  "none",
    "hotkeys": {
        "next_cat":      "alt+right",
        "prev_cat":      "alt+left",
        "toggle":        "alt+space",
        "pause":         "alt+p",
        "show_sel":      "alt+s",
        "start_test":    "alt+t",
        "show_settings": "alt+u",
        "read_card":     "alt+r",
    }
}

HOTKEY_LABELS = {
    "next_cat":      "Następna kategoria",
    "prev_cat":      "Poprzednia kategoria",
    "toggle":        "Pokaż/Ukryj fiszkę",
    "pause":         "Pauza",
    "show_sel":      "Otwórz menu",
    "start_test":    "Rozpocznij test",
    "show_settings": "Otwórz ustawienia",
    "read_card":     "Czytaj słówko (TTS)",
}

def load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            saved  = json.load(open(SETTINGS_FILE, encoding="utf-8"))
            merged = dict(DEFAULT_SETTINGS)
            merged.update(saved)
            merged["hotkeys"] = dict(DEFAULT_SETTINGS["hotkeys"])
            merged["hotkeys"].update(saved.get("hotkeys", {}))
            return merged
        except Exception:
            pass
    return dict(DEFAULT_SETTINGS)

def save_settings(s: dict):
    try:
        SETTINGS_FILE.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[SETTINGS] {e}")

APP_SETTINGS = load_settings()

# ── EFEKTY WIZUALNE SŁÓWKA ──────────────────────────────
WORD_EFFECTS_LABELS = {
    "none":        "🚫  Brak",
    "flash_gold":  "✨  Złoty błysk",
    "flash_red":   "🔴  Czerwony błysk",
    "flash_cyan":  "🩵  Cyjanowy błysk",
    "flash_pink":  "💗  Różowy błysk",
    "flash_lime":  "💚  Limonkowy",
    "flash_blue":  "🔵  Niebieski błysk",
    "glow_white":  "⚪  Biały blask",
    "glow_orange": "🟠  Pomarańcz",
    "glow_purple": "🟣  Fiolet",
    "neon_green":  "🟢  Neon zielony",
    "neon_blue":   "💙  Neon niebieski",
    "pulse":       "💓  Pulsowanie",
    "shake":       "💫  Drżenie",
    "rainbow":     "🌈  Tęcza",
    "zoom_in":     "🔍  Powiększenie",
    "zoom_out":    "🔎  Pomniejszenie",
    "typewriter":  "⌨️   Maszyna",
    "bounce":      "🏀  Odbicie",
    "spin_color":  "🎡  Obrót kolorów",
    "fire_text":   "🔥  Ognisty tekst",
}

def lang_label(code):
    return next((l["label"] for l in LANGUAGES if l["code"] == code), code)


# ──────────────────────────────────────────────────────
# HELPERS UI
# ──────────────────────────────────────────────────────
DARK_BG = QColor(20, 20, 45, 209)
BORDER  = QColor(80, 100, 200, 100)

class _DraggableWindow(QWidget):
    """Mixin: przeciąganie przez pasek tytułu (górne 32px) + ESC zamyka."""
    DRAG_BAR_HEIGHT = 32   # wysokość strefy drag u góry

    def __init__(self):
        super().__init__()
        self._drag_pos_win = None

    def _in_drag_zone(self, pos):
        return pos.y() < self.DRAG_BAR_HEIGHT

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton and self._in_drag_zone(e.position().toPoint()):
            self._drag_pos_win = e.globalPosition().toPoint() - self.frameGeometry().topLeft()
            e.accept()
        else:
            self._drag_pos_win = None
            super().mousePressEvent(e)

    def mouseMoveEvent(self, e):
        if self._drag_pos_win and e.buttons() == Qt.MouseButton.LeftButton:
            self.move(e.globalPosition().toPoint() - self._drag_pos_win)
            e.accept()
        else:
            super().mouseMoveEvent(e)

    def mouseReleaseEvent(self, e):
        self._drag_pos_win = None
        super().mouseReleaseEvent(e)

    def keyPressEvent(self, e):
        if e.key() == Qt.Key.Key_Escape:
            self.hide()
        else:
            super().keyPressEvent(e)


def _right_third_pos(w):
    """Ustaw okno w prawej 1/3 monitora, wyśrodkowane pionowo."""
    sc  = QApplication.primaryScreen().availableGeometry()
    rx  = sc.left() + int(sc.width() * 2 / 3)          # lewa krawędź prawej 1/3
    rx  = min(rx, sc.right() - w.width() - 20)          # nie wypadaj poza ekran
    cy  = sc.top() + (sc.height() - w.height()) // 2    # środek pionowy
    w.move(rx, cy)

def _styled_window(w):
    w.setWindowFlags(
        Qt.WindowType.FramelessWindowHint |
        Qt.WindowType.WindowStaysOnTopHint |
        Qt.WindowType.Tool
    )
    w.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
    try:
        import platform
        if platform.system() == "Windows":
            import ctypes
            hwnd = int(w.winId())
            HWND_TOPMOST = -1
            SWP_NOMOVE = 0x0002
            SWP_NOSIZE = 0x0001
            ctypes.windll.user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
        else:
            # Mac / Linux — używamy flag Qt
            w.setWindowFlag(Qt.WindowType.WindowStaysOnTopHint, True)
    except Exception:
        pass

def _paint_bg(widget, _):
    from PyQt6.QtCore import QRectF, QPointF, QRect
    p = QPainter(widget)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    r = QRectF(widget.rect()).adjusted(1, 1, -1, -1)
    # Tło okna
    p.setBrush(QBrush(DARK_BG))
    p.setPen(BORDER)
    p.drawRoundedRect(r, 16, 16)
    # Pasek drag u góry - ciemniejszy, zaokrąglony tylko górne narożniki
    p.setPen(Qt.PenStyle.NoPen)
    p.setBrush(QBrush(QColor(255, 255, 255, 18)))
    drag_r = QRectF(r.left(), r.top(), r.width(), 32)
    p.drawRoundedRect(drag_r, 16, 16)
    # Przykryj dolne zaokrąglenie paska prostokątem
    p.drawRect(QRectF(r.left(), r.top() + 16, r.width(), 16))

def _close_btn(target):
    btn = QPushButton("✖  Zamknij")
    btn.setStyleSheet("""
        QPushButton { background:rgba(150,40,40,160); color:white;
            border:1px solid rgba(200,80,80,120);
            border-radius:10px; padding:7px; font-size:12px; }
        QPushButton:hover { background:rgba(190,60,60,200); }
    """)
    btn.setCursor(Qt.CursorShape.PointingHandCursor)
    btn.clicked.connect(target.hide)
    return btn

def _back_btn(text, cb):
    btn = QPushButton(text)
    btn.setStyleSheet("""
        QPushButton { background:rgba(60,60,100,160);
            color:rgba(200,210,255,200);
            border:1px solid rgba(100,110,180,100);
            border-radius:10px; padding:8px; font-size:12px; }
        QPushButton:hover { background:rgba(80,80,130,200); }
    """)
    btn.setCursor(Qt.CursorShape.PointingHandCursor)
    btn.clicked.connect(cb)
    return btn



# ──────────────────────────────────────────────────────
# ANALITYKI – sesja nauki i interakcje
# ──────────────────────────────────────────────────────
import time as _time

class LearningSession:
    """Śledzi czas nauki i interakcje użytkownika."""

    def __init__(self):
        self._app_start     = _time.time()
        self._slides_start  = None   # kiedy zaczęły się fiszki
        self._slides_lang   = None
        self._slides_cat    = None
        self._interactions  = {}     # event_name -> count
        self._session_sent  = False

    # ── czas ──────────────────────────────────────────
    def slides_started(self, lang, level, cat):
        self._slides_start = _time.time()
        self._slides_lang  = lang
        self._slides_cat   = cat
        self._slides_level = level

    def slides_stopped(self):
        if self._slides_start:
            duration_sec = int(_time.time() - self._slides_start)
            ph_capture("slides_session_ended", {
                "language":     self._slides_lang,
                "level":        getattr(self, "_slides_level", ""),
                "category":     self._slides_cat,
                "duration_sec": duration_sec,
                "duration_min": round(duration_sec / 60, 1),
            })
            self._slides_start = None

    # ── interakcje ────────────────────────────────────
    def track(self, event: str, props: dict = None):
        """Śledź interakcję — wysyłaj od razu do PostHog."""
        self._interactions[event] = self._interactions.get(event, 0) + 1
        ph_capture(event, props or {})

    # ── zamknięcie ────────────────────────────────────
    def on_app_close(self):
        self.slides_stopped()
        total_sec = int(_time.time() - self._app_start)
        ph_capture("app_session_ended", {
            "total_duration_sec": total_sec,
            "total_duration_min": round(total_sec / 60, 1),
            "interactions":       self._interactions,
        })
        _ph.flush()

_session = LearningSession()

# ──────────────────────────────────────────────────────
# WORKER – logowanie / rejestracja
# ──────────────────────────────────────────────────────
class AuthWorker(QThread):
    success = pyqtSignal(object)
    error   = pyqtSignal(str)

    def __init__(self, action, email, password):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.action   = action
        self.email    = email
        self.password = password

    def run(self):
        try:
            if self.action == "login":
                resp = supabase.auth.sign_in_with_password(
                    {"email": self.email, "password": self.password})
            else:
                resp = supabase.auth.sign_up(
                    {"email": self.email, "password": self.password})
            if resp.session:
                self.success.emit(resp.session)
            else:
                self.error.emit("Brak sesji.")
        except Exception as e:
            self.error.emit(str(e))


# ──────────────────────────────────────────────────────
# WORKER – pobieranie fiszek
# ──────────────────────────────────────────────────────
class FetchWorker(QThread):
    done  = pyqtSignal(list)
    error = pyqtSignal(str)

    def __init__(self, lang, level, cat):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.lang  = lang
        self.level = level
        self.cat   = cat

    def run(self):
        # Auto-refresh JWT jeśli potrzeba
        try:
            supabase.auth.get_user()
        except Exception:
            try: supabase.auth.refresh_session()
            except Exception: pass
        try:
            # Pobierz normalne fiszki
            resp = supabase.rpc("get_flashcards", {
                "p_lang":  self.lang,
                "p_level": self.level,
                "p_cat":   self.cat,
            }).execute()
            # Deduplikacja - tylko unikalne słowa w kategorii
            seen_words = set()
            normal = []
            for r in (resp.data or []):
                key = r["word"].strip().lower()
                if key not in seen_words:
                    seen_words.add(key)
                    normal.append({"word": r["word"], "translation": r["translation"],
                                   "romaji": r.get("romaji", ""), "srs": False,
                                   "flashcard_id": r.get("id", 0)})
            # Pobierz słowa do powtórki SRS
            try:
                srs_resp = supabase.rpc("get_due_cards_all", {
                    "p_lang": self.lang, "p_limit": 5,
                }).execute()
                srs_cards = [{"word": r["word"], "translation": r["translation"],
                              "romaji": r.get("romaji", ""), "srs": True,
                              "flashcard_id": r.get("flashcard_id", 0),
                              "category": r.get("category_code", "")}
                             for r in (srs_resp.data or [])
                             if r.get("category_code") != self.cat]
            except Exception:
                srs_cards = []
            # Mieszaj 70% normalne + 30% SRS
            import random
            if srs_cards and normal:
                n_srs = max(1, len(normal) // 3)
                mixed = normal + srs_cards[:n_srs]
                random.shuffle(mixed)
                cards = mixed
            else:
                cards = normal
            if cards:
                self.done.emit(cards)
            else:
                self.error.emit("Brak fiszek w bazie dla tego wyboru.")
        except Exception as e:
            self.error.emit(str(e))


# ──────────────────────────────────────────────────────
# WORKER – odświeżanie tokena JWT Supabase
# ──────────────────────────────────────────────────────
class TokenRefreshWorker(QThread):
    refreshed = pyqtSignal()
    failed    = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.finished.connect(self.deleteLater)

    def run(self):
        try:
            supabase.auth.refresh_session()
            self.refreshed.emit()
        except Exception as e:
            print(f"[JWT] Refresh failed: {e}")
            self.failed.emit()


# ──────────────────────────────────────────────────────
# WORKER – liczba poznanych słów
# ──────────────────────────────────────────────────────
class KnownWordsWorker(QThread):
    done = pyqtSignal(int)
    def __init__(self, lang, level=None, cat=None):
        super().__init__()
        self.lang = lang
        self.level = level
        self.cat = cat
        self.finished.connect(self.deleteLater)
    def run(self):
        import time as _t
        for attempt in range(3):
            try:
                # Filtruj fiszki per lang/level/cat
                q = supabase.table("flashcards")                    .select("id")                    .eq("language_id",
                        supabase.table("languages").select("id").eq("code", self.lang).execute().data[0]["id"]
                    )
                if self.level:
                    q = q.eq("level_id",
                        supabase.table("levels").select("id").eq("code", self.level).execute().data[0]["id"]
                    )
                if self.cat:
                    q = q.eq("category_id",
                        supabase.table("categories").select("id").eq("code", self.cat).execute().data[0]["id"]
                    )
                card_ids = [r["id"] for r in (q.execute().data or [])]
                if not card_ids:
                    self.done.emit(0); return
                resp = supabase.table("word_progress")                    .select("flashcard_id", count="exact")                    .in_("flashcard_id", card_ids)                    .gte("ease_factor", 2.5).gte("repetitions", 2).execute()
                self.done.emit(resp.count or 0)
                return
            except Exception as e:
                if attempt == 2:
                    print(f"[KNOWN] {e}"); self.done.emit(0)
                else: _t.sleep(1)


# ──────────────────────────────────────────────────────
# WORKER – zaliczone kategorie z bazy
# ──────────────────────────────────────────────────────
class CompletedCatsWorker(QThread):
    done = pyqtSignal(list)
    def __init__(self, lang):
        super().__init__()
        self.lang = lang
        self.finished.connect(self.deleteLater)
    def run(self):
        import time as _t
        for attempt in range(3):
            try:
                resp = supabase.rpc("get_completed_categories", {"p_lang": self.lang}).execute()
                codes = [r["category_code"] for r in (resp.data or [])]
                self.done.emit(codes); return
            except Exception as e:
                if attempt == 2:
                    print(f"[COMPLETED_CATS] {e}"); self.done.emit([])
                else: _t.sleep(1)


# ──────────────────────────────────────────────────────
# WORKER – oznacz wszystkie słowa jako znane (90 dni)
# ──────────────────────────────────────────────────────
class MarkAllKnownWorker(QThread):
    done = pyqtSignal()
    def __init__(self, lang, level, cat):
        super().__init__()
        self.lang = lang; self.level = level; self.cat = cat
        self.finished.connect(self.deleteLater)
    def run(self):
        import time as _t
        try:
            resp = supabase.rpc("get_flashcards", {
                "p_lang": self.lang, "p_level": self.level, "p_cat": self.cat
            }).execute()
            cards = resp.data or []
            user_id = current_uid()
            from datetime import date, timedelta
            next_review = (date.today() + timedelta(days=90)).isoformat()
            for c in cards:
                fid = c.get("id", 0)
                if not fid: continue
                try:
                    supabase.table("word_progress").upsert({
                        "user_id": user_id, "flashcard_id": fid,
                        "ease_factor": 3.5, "interval_days": 90,
                        "repetitions": 5, "next_review": next_review,
                        "times_seen": 1, "times_correct": 1,
                    }, on_conflict="user_id,flashcard_id").execute()
                except Exception: pass
                _t.sleep(0.05)
            self.done.emit()
        except Exception as e:
            print(f"[MARK_ALL_KNOWN] {e}"); self.done.emit()


# ──────────────────────────────────────────────────────
# WORKER – smart słowa do testu
# ──────────────────────────────────────────────────────
class TestCardsWorker(QThread):
    done = pyqtSignal(list)
    def __init__(self, lang, level, cat):
        super().__init__()
        self.lang = lang; self.level = level; self.cat = cat
        self.finished.connect(self.deleteLater)
    def run(self):
        try:
            resp = supabase.rpc("get_flashcards", {
                "p_lang": self.lang, "p_level": self.level, "p_cat": self.cat
            }).execute()
            cat_cards = resp.data or []
            try:
                due_resp = supabase.rpc("get_due_cards_all", {
                    "p_lang": self.lang, "p_limit": 10
                }).execute()
                due_cards = [r for r in (due_resp.data or [])
                            if r.get("category_code") != self.cat]
            except Exception:
                due_cards = []
            try:
                prog_resp = supabase.table("word_progress")                    .select("flashcard_id,repetitions,ease_factor")                    .eq("user_id", current_uid()).execute()
                prog = {r["flashcard_id"]: r for r in (prog_resp.data or [])}
            except Exception:
                prog = {}
            test_from_cat = []
            for c in cat_cards:
                fid = c.get("id", 0)
                p = prog.get(fid)
                if not p: status = "unknown"
                elif p["repetitions"] < 3 or p["ease_factor"] < 2.0: status = "learning"
                else: continue
                test_from_cat.append({
                    "flashcard_id": fid, "word": c["word"],
                    "translation": c["translation"], "romaji": c.get("romaji", ""),
                    "status": status, "from_cat": self.cat
                })
            max_due = max(1, len(test_from_cat) // 3)
            test_due = []
            for c in due_cards[:max_due]:
                p = prog.get(c.get("flashcard_id", 0))
                if p and p["repetitions"] >= 3 and p["ease_factor"] >= 2.0: continue
                test_due.append({
                    "flashcard_id": c.get("flashcard_id", 0),
                    "word": c["word"], "translation": c["translation"],
                    "romaji": c.get("romaji", ""), "status": "review",
                    "from_cat": c.get("category_code", "")
                })
            import random
            result = test_from_cat + test_due
            random.shuffle(result)
            self.done.emit(result)
        except Exception as e:
            print(f"[TEST_CARDS] {e}"); self.done.emit([])


# ──────────────────────────────────────────────────────
# OKNO LOGOWANIA
# ──────────────────────────────────────────────────────
INPUT_STYLE = """
    QLineEdit {
        background: rgba(40,40,80,180); color: white;
        border: 1px solid rgba(100,120,220,150);
        border-radius: 8px; padding: 8px 12px; font-size: 13px;
    }
    QLineEdit:focus { border: 1px solid rgba(140,160,255,220); }
"""
BTN_PRIMARY = """
    QPushButton {
        background: rgba(60,100,220,200); color: white;
        border: none; border-radius: 10px;
        padding: 10px; font-size: 13px; font-weight: bold;
    }
    QPushButton:hover   { background: rgba(80,130,255,220); }
    QPushButton:pressed { background: rgba(40,70,160,255); }
    QPushButton:disabled{ background: rgba(60,60,100,120); color: rgba(255,255,255,80); }
"""

ONBOARDING_KEY = "onboarding_done_v1"

class OnboardingWindow(_DraggableWindow):
    """Okno onboardingu — pokazuje się przy pierwszym uruchomieniu."""
    finished = pyqtSignal()

    SLIDES = [
        {
            "icon": "👁️",
            "title": "Witaj w Eyelingo!",
            "body": "Uczysz się języków bez odrywania się od tego co robisz. Fiszki pojawiają się w tle ekranu — podczas pracy, gry, przeglądania.",
        },
        {
            "icon": "🌍",
            "title": "Wybierz język",
            "body": "Angielski, Hiszpański, Japoński, Niderlandzki — każdy z 6 poziomami od A1 do C2. Więcej języków już wkrótce.",
        },
        {
            "icon": "✏️",
            "title": "Własne zestawy",
            "body": "Stwórz własne fiszki z dowolnego materiału — Eyelingo pokaże je w tle podczas pracy, dokładnie wtedy, gdy mózg najlepiej je przyswaja.",
        },
        {
            "icon": "🚀",
            "title": "Zaczynajmy!",
            "body": "Kliknij ikonę Eyelingo w zasobniku systemowym aby zarządzać fiszkami. Miłej nauki!",
        },
    ]

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(360, 420)
        self._slide = 0
        self._build()
        sc = QApplication.primaryScreen().availableGeometry()
        self.move(sc.center().x() - 180, sc.center().y() - 210)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("✨  Eyelingo")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        il = QVBoxLayout(inner); il.setContentsMargins(28, 20, 28, 24); il.setSpacing(16)
        lay.addWidget(inner, 1)

        # Ikona
        self.lbl_icon = QLabel()
        self.lbl_icon.setFont(QFont("Segoe UI Emoji", 48))
        self.lbl_icon.setStyleSheet("background:transparent;")
        self.lbl_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)
        il.addWidget(self.lbl_icon)

        # Tytuł
        self.lbl_title = QLabel()
        self.lbl_title.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        self.lbl_title.setStyleSheet("color:white;background:transparent;")
        self.lbl_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_title.setWordWrap(True)
        il.addWidget(self.lbl_title)

        # Opis
        self.lbl_body = QLabel()
        self.lbl_body.setFont(QFont("Segoe UI", 11))
        self.lbl_body.setStyleSheet("color:rgba(200,215,255,200);background:transparent;")
        self.lbl_body.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_body.setWordWrap(True)
        il.addWidget(self.lbl_body)

        il.addStretch()

        # Dots
        dots_w = QWidget(); dots_w.setStyleSheet("background:transparent;")
        dots_l = QHBoxLayout(dots_w); dots_l.setContentsMargins(0,0,0,0); dots_l.setSpacing(8)
        dots_l.addStretch()
        self._dots = []
        for i in range(len(self.SLIDES)):
            d = QLabel("●")
            d.setFont(QFont("Segoe UI", 8))
            d.setStyleSheet("background:transparent;")
            dots_l.addWidget(d)
            self._dots.append(d)
        dots_l.addStretch()
        il.addWidget(dots_w)

        # Przycisk
        self.btn_next = QPushButton("Dalej →")
        self.btn_next.setStyleSheet(BTN_PRIMARY)
        self.btn_next.setMinimumHeight(40)
        self.btn_next.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_next.clicked.connect(self._next)
        il.addWidget(self.btn_next)

        self._update_slide()

    def _update_slide(self):
        s = self.SLIDES[self._slide]
        self.lbl_icon.setText(s["icon"])
        self.lbl_title.setText(s["title"])
        self.lbl_body.setText(s["body"])
        is_last = self._slide == len(self.SLIDES) - 1
        self.btn_next.setText("Zaczynajmy! 🚀" if is_last else "Dalej →")
        for i, d in enumerate(self._dots):
            d.setStyleSheet(f"color:{'rgba(255,255,255,220)' if i==self._slide else 'rgba(255,255,255,60)'};background:transparent;")

    def _next(self):
        if self._slide < len(self.SLIDES) - 1:
            self._slide += 1
            self._update_slide()
        else:
            self._mark_done()
            self.hide()
            self.finished.emit()

    def _mark_done(self):
        try:
            import json as _j
            path = Path.home() / ".eyelingo_prefs.json"
            prefs = {}
            if path.exists():
                prefs = _j.loads(path.read_text())
            prefs[ONBOARDING_KEY] = True
            path.write_text(_j.dumps(prefs))
        except Exception:
            pass

    @staticmethod
    def should_show():
        try:
            import json as _j
            path = Path.home() / ".eyelingo_prefs.json"
            if not path.exists():
                return True
            prefs = _j.loads(path.read_text())
            return not prefs.get(ONBOARDING_KEY, False)
        except Exception:
            return True

    def paintEvent(self, e):
        _paint_bg(self, e)


class LoginWindow(_DraggableWindow):
    logged_in = pyqtSignal(object)

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(320, 500)
        self._mode = "login"
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # ── Pasek drag ──
        hdr = QWidget(); hdr.setFixedHeight(32)
        hdr.setStyleSheet("background:transparent;")
        lay.addWidget(hdr)

        # ── Logo ──
        logo_w = QWidget(); logo_w.setStyleSheet("background:transparent;")
        logo_l = QVBoxLayout(logo_w); logo_l.setContentsMargins(24, 6, 24, 0)
        lbl_logo = QLabel()
        lbl_logo.setAlignment(Qt.AlignmentFlag.AlignCenter)
        logo_loaded = False
        for lp in [
            Path(__file__).parent / "logo_transparent_navy.png",
            Path(__file__).parent / "logo_navy.png",
        ]:
            if lp.exists():
                pix = QPixmap(str(lp)).scaledToWidth(220, Qt.TransformationMode.SmoothTransformation)
                lbl_logo.setPixmap(pix)
                logo_loaded = True
                break
        if not logo_loaded:
            lbl_logo.setText("Eyelingo")
            lbl_logo.setFont(QFont("Segoe UI", 20, QFont.Weight.Bold))
            lbl_logo.setStyleSheet("color:white;background:transparent;")
        logo_l.addWidget(lbl_logo)
        lay.addWidget(logo_w)

        # ── Treść ──
        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        inner_lay = QVBoxLayout(inner)
        inner_lay.setContentsMargins(24, 12, 24, 20)
        inner_lay.setSpacing(8)
        lay.addWidget(inner, 1)

        self.lbl_mode = QLabel("Zaloguj się")
        self.lbl_mode.setFont(QFont("Segoe UI", 10))
        self.lbl_mode.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_mode.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner_lay.addWidget(self.lbl_mode)

        self.inp_email = QLineEdit()
        self.inp_email.setPlaceholderText("E-mail")
        self.inp_email.setMinimumHeight(36)
        self.inp_email.setStyleSheet(INPUT_STYLE)
        inner_lay.addWidget(self.inp_email)

        # Pole pseudonimu - widoczne tylko przy rejestracji
        self.inp_username = QLineEdit()
        self.inp_username.setPlaceholderText("Pseudonim (widoczny w rankingu)")
        self.inp_username.setMinimumHeight(36)
        self.inp_username.setStyleSheet(INPUT_STYLE)
        self.inp_username.hide()
        inner_lay.addWidget(self.inp_username)

        self.inp_pass = QLineEdit()
        self.inp_pass.setPlaceholderText("Hasło")
        self.inp_pass.setEchoMode(QLineEdit.EchoMode.Password)
        self.inp_pass.setMinimumHeight(36)
        self.inp_pass.setStyleSheet(INPUT_STYLE)
        self.inp_pass.returnPressed.connect(self._submit)
        inner_lay.addWidget(self.inp_pass)

        self.lbl_error = QLabel("")
        self.lbl_error.setFont(QFont("Segoe UI", 9))
        self.lbl_error.setStyleSheet("color:rgba(255,100,100,220);background:transparent;")
        self.lbl_error.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_error.setWordWrap(True)
        self.lbl_error.setMinimumHeight(18)
        inner_lay.addWidget(self.lbl_error)

        self.btn_submit = QPushButton("Zaloguj się")
        self.btn_submit.setMinimumHeight(38)
        self.btn_submit.setStyleSheet(BTN_PRIMARY)
        self.btn_submit.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_submit.clicked.connect(self._submit)
        inner_lay.addWidget(self.btn_submit)

        self.btn_switch = QPushButton("Nie masz konta? Zarejestruj się")
        self.btn_switch.setStyleSheet("""
            QPushButton { background:transparent; color:rgba(160,180,255,200);
                border:none; font-size:11px; padding:4px; }
            QPushButton:hover { color:white; }
        """)
        self.btn_switch.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_switch.clicked.connect(self._toggle_mode)
        inner_lay.addWidget(self.btn_switch)

        inner_lay.addSpacing(8)

        btn_quit = QPushButton("✖  Zamknij aplikację")
        btn_quit.setMinimumHeight(36)
        btn_quit.setStyleSheet("""
            QPushButton { background:rgba(150,40,40,160); color:white;
                border:1px solid rgba(200,80,80,120);
                border-radius:10px; padding:7px; font-size:11px; }
            QPushButton:hover { background:rgba(190,60,60,200); }
        """)
        btn_quit.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_quit.clicked.connect(QApplication.quit)
        inner_lay.addWidget(btn_quit)

    def reset(self):
        """Resetuje stan okna logowania — wywołaj po wylogowaniu."""
        self._mode = "login"
        self.lbl_mode.setText("Zaloguj się")
        self.btn_submit.setText("Zaloguj się")
        self.btn_submit.setEnabled(True)
        self.btn_switch.setText("Nie masz konta? Zarejestruj się")
        self.inp_email.clear()
        self.inp_pass.clear()
        self.lbl_error.setText("")

    def _toggle_mode(self):
        if self._mode == "login":
            self._mode = "register"
            self.lbl_mode.setText("Utwórz nowe konto")
            self.btn_submit.setText("Zarejestruj się")
            self.btn_switch.setText("Masz już konto? Zaloguj się")
            self.inp_username.show()
        else:
            self._mode = "login"
            self.lbl_mode.setText("Zaloguj się")
            self.btn_submit.setText("Zaloguj się")
            self.btn_switch.setText("Nie masz konta? Zarejestruj się")
            self.inp_username.hide()
        self.lbl_error.setText("")

    def _submit(self):
        email    = self.inp_email.text().strip()
        password = self.inp_pass.text()
        username = self.inp_username.text().strip() if self._mode == "register" else ""

        if not email or not password:
            self.lbl_error.setText("Wypełnij e-mail i hasło.")
            return
        if len(password) < 6:
            self.lbl_error.setText("Hasło musi mieć co najmniej 6 znaków.")
            return
        if self._mode == "register":
            if not username:
                self.lbl_error.setText("Wpisz pseudonim.")
                return
            if len(username) < 3:
                self.lbl_error.setText("Pseudonim musi mieć co najmniej 3 znaki.")
                return
            if len(username) > 20:
                self.lbl_error.setText("Pseudonim może mieć maksymalnie 20 znaków.")
                return
        self._username = username
        self.lbl_error.setText("")
        self.btn_submit.setEnabled(False)
        self.btn_submit.setText("Łączenie...")
        self._worker = AuthWorker(self._mode, email, password)
        self._worker.success.connect(self._on_success)
        self._worker.error.connect(self._on_error)
        self._worker.start()

    def _on_success(self, session):
        save_session(session)
        self.hide()
        try:
            user = current_user()
            if user:
                ph_identify(user.id, user.email)
                ph_capture("user_logged_in")
                # Zapisz pseudonim przy rejestracji
                if self._mode == "register" and hasattr(self, '_username') and self._username:
                    supabase.from_("profiles").update({
                        "username": self._username
                    }).eq("user_id", user.id).execute()
        except Exception:
            pass
        self.logged_in.emit(session)

    def _on_error(self, msg):
        print(f"[AUTH ERROR] {msg}")
        msg_low = msg.lower()
        if self._mode == "register":
            if "already" in msg_low:
                self.lbl_error.setText("Ten e-mail jest już zarejestrowany.")
            elif "password" in msg_low:
                self.lbl_error.setText("Hasło musi mieć co najmniej 6 znaków.")
            else:
                self.lbl_error.setText("Błąd rejestracji. Sprawdź dane i internet.")
        else:
            if "invalid" in msg_low:
                self.lbl_error.setText("Nieprawidłowy e-mail lub hasło.")
            else:
                self.lbl_error.setText("Błąd połączenia. Sprawdź internet.")
        self.btn_submit.setEnabled(True)
        self.btn_submit.setText("Zaloguj się" if self._mode == "login" else "Zarejestruj się")

    def paintEvent(self, e):
        _paint_bg(self, e)


# ──────────────────────────────────────────────────────
# OKNO FISZKI
# ──────────────────────────────────────────────────────
class FlashcardOverlay(QWidget):
    def __init__(self):
        super().__init__()
        self.index = 0
        self.cards = []
        self.lang  = "en"
        self.level = "A1"
        self.cat   = ""
        self._cards_shown = 0
        self._init_window()
        self._init_ui()
        self._init_timer()
        self._apply_click_through()

    def _init_window(self):
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint     |
            Qt.WindowType.WindowStaysOnTopHint    |
            Qt.WindowType.Tool                    |
            Qt.WindowType.WindowTransparentForInput
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setWindowOpacity(OPACITY)
        screen = QApplication.primaryScreen().availableGeometry()
        self.setGeometry(screen.left() + 20, screen.top() + 20, 320, 130)
        self.setFixedSize(320, 130)   # ZAWSZE stały rozmiar

    def _init_ui(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 8, 14, 8)
        lay.setSpacing(3)

        # górny pasek: info + postęp
        top = QWidget()
        top.setStyleSheet("background:transparent;")
        top_lay = QHBoxLayout(top)
        top_lay.setContentsMargins(0,0,0,0)
        top_lay.setSpacing(4)

        self.lbl_info = QLabel("📚  Wybierz język i kategorię")
        self.lbl_info.setFont(QFont("Segoe UI", 8))
        self.lbl_info.setStyleSheet("color:rgba(255,255,255,160); background:transparent;")

        self.lbl_known = QLabel("")
        self.lbl_known.setFont(QFont("Segoe UI", 8))
        self.lbl_known.setStyleSheet("color:rgba(100,220,150,220); background:transparent;")
        self.lbl_known.setAlignment(Qt.AlignmentFlag.AlignRight)

        top_lay.addWidget(self.lbl_info)
        top_lay.addWidget(self.lbl_known)

        self.lbl_word = QLabel("")
        self.lbl_word.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        self.lbl_word.setStyleSheet("color:rgba(255,255,255,240);")
        self.lbl_word.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_word.setWordWrap(True)
        self.lbl_word.setMaximumWidth(320)

        self.lbl_tr = QLabel("")
        self.lbl_tr.setFont(QFont("Segoe UI", 11))
        self.lbl_tr.setStyleSheet("color:rgba(200,220,255,210);")
        self.lbl_tr.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.lbl_romaji = QLabel("")
        self.lbl_romaji.setFont(QFont("Segoe UI", 13, QFont.Weight.Bold))
        self.lbl_romaji.setStyleSheet("color:rgba(255,255,255,240);")
        self.lbl_romaji.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_romaji.hide()

        lay.addWidget(top)
        lay.addWidget(self.lbl_word)
        lay.addWidget(self.lbl_romaji)
        lay.addWidget(self.lbl_tr)

    def load_from_supabase(self, lang, level, cat):
        self.lang  = lang
        self.level = level
        self.cat   = cat
        _session.slides_started(lang, level, cat)
        _session.track("slides_started", {
            "language": lang, "level": level, "category": cat
        })
        # Zapisz ostatni wybór do pliku (wznowienie po restarcie)
        try:
            import json, pathlib
            _last = pathlib.Path.home() / ".eyelingo_last.json"
            _last.write_text(json.dumps({"lang": lang, "level": level, "cat": cat}), encoding="utf-8")
        except Exception:
            pass
        icon = next((c["icon"] for c in CATEGORIES if c["code"] == cat), "📚")
        self.lbl_info.setText(f"{icon} {cat}  ·  {level}  ·  {lang_label(lang)}")
        self.lbl_word.setText("Ładowanie...")
        self.lbl_tr.setText("")
        self._worker = FetchWorker(lang, level, cat)
        self._worker.done.connect(self._on_loaded)
        self._worker.error.connect(self._on_error)
        self._worker.start()

    def _on_loaded(self, cards):
        self.cards = cards
        self.index = 0
        self._is_custom = False
        self.show()
        self._update()

    def _on_error(self, msg):
        self.lbl_word.setText("Błąd")
        self.lbl_tr.setText(msg)

    def load_custom(self, name, cards):
        """Ładuje własne fiszki bezpośrednio (bez Supabase)."""
        short_name = name[:15] if len(name) > 15 else name
        self.cat   = short_name
        self.level = ""
        self._is_custom = True
        self.cards = [{"word": c["word"], "translation": c["translation"],
                       "romaji": "", "flashcard_id": i, "custom": True, "set_name": short_name}
                      for i, c in enumerate(cards)]
        self.index = 0
        self.show()
        self._update()

    def _init_timer(self):
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._next)
        ms = int(APP_SETTINGS.get("display_time", 8) * 1000)
        self.timer.start(ms)

    def set_known_words(self, count):
        if count > 0:
            self.lbl_known.setText(f"✓ {count} słów")
        else:
            self.lbl_known.setText("")

    def _next(self):
        if self.cards:
            self.index = (self.index + 1) % len(self.cards)
            self._cards_shown += 1
            self._update()

    def _get_word_font_size(self, word: str) -> int:
        """Zwraca rozmiar czcionki zależnie od długości słowa."""
        length = len(word)
        if length <= 15:
            return 16
        elif length <= 25:
            return 13
        elif length <= 40:
            return 11
        else:
            return 9

    def _update(self):
        if not self.cards:
            return
        c = self.cards[self.index]
        romaji = c.get("romaji", "")
        word = c["word"]
        if romaji and self.lang == "jp":
            # Japoński: lbl_word = kanji (styl jak tłumaczenie), lbl_romaji = romaji pośrodku
            font_size = self._get_word_font_size(romaji)
            self.lbl_word.setFont(QFont("Segoe UI", 13))
            self.lbl_word.setStyleSheet("color:rgba(200,220,255,210);")
            self.lbl_word.setText(word)
            self.lbl_romaji.setFont(QFont("Segoe UI", min(font_size, 13), QFont.Weight.Bold))
            self.lbl_romaji.setText(romaji)
            self.lbl_romaji.show()
        else:
            font_size = self._get_word_font_size(word)
            self.lbl_word.setFont(QFont("Segoe UI", font_size, QFont.Weight.Bold))
            self.lbl_word.setStyleSheet("color:rgba(255,255,255,240);")
            self.lbl_word.setText(word)
            self.lbl_romaji.hide()
        self.lbl_tr.setText(c["translation"])
        # Dopasuj rozmiar okna do zawartości
        QTimer.singleShot(10, self.adjustSize)
        # Przywróć font słówka (na wypadek gdyby coś go zmieniło)
        if not (romaji and self.lang == "jp"):
            self.lbl_word.setFont(QFont("Segoe UI", self._get_word_font_size(word), QFont.Weight.Bold))
        # Efekt wizualny słówka
        QTimer.singleShot(50, self._play_word_effect)
        # Etykieta SRS / własny zestaw
        if c.get("srs"):
            cat_label = c.get("category", "poprzednia kategoria")
            icon_srs = next((x["icon"] for x in CATEGORIES if x["code"] == cat_label), "🔁")
            self.lbl_info.setText(f"🔁  Powtórka · {icon_srs} {cat_label}")
        elif getattr(self, "_is_custom", False):
            self.lbl_info.setText(f"✏️  {self.cat}")
        else:
            icon = next((x["icon"] for x in CATEGORIES if x["code"] == self.cat), "📚")
            self.lbl_info.setText(f"{icon}  {self.cat}  ·  {self.level}  ·  {lang_label(self.lang)}")
        # Auto-czytanie TTS
        if APP_SETTINGS.get("audio_enabled", False):
            raw = c.get("word", "")
            lang = self.lang or "en"
            if lang == "jp":
                raw = _jp_tts_word(raw)
            speak_word(raw, lang)

    def _play_word_effect(self):
        """Efekt wizualny TYLKO koloru słówka - bez zmiany rozmiaru/pozycji. Max ~300ms."""
        fx = APP_SETTINGS.get("card_effect", "none")
        if fx == "none" or not fx:
            return
        # Efekt na romaji jeśli JP, inaczej na słówku
        lbl  = self.lbl_romaji if (self.lang == "jp" and self.lbl_romaji.isVisible()) else self.lbl_word
        alpha = int(APP_SETTINGS.get("text_alpha", 240))
        orig = f"color:rgba(255,255,255,{alpha});"

        def s(t, col):
            QTimer.singleShot(t, lambda: lbl.setStyleSheet(f"color:{col};"))
        def r(t):
            QTimer.singleShot(t, lambda: lbl.setStyleSheet(orig))

        COLORS = {
            "flash_gold":  "rgba(255,215,0,255)",
            "flash_red":   "rgba(255,65,65,255)",
            "flash_cyan":  "rgba(0,235,205,255)",
            "flash_pink":  "rgba(255,75,185,255)",
            "flash_lime":  "rgba(115,255,65,255)",
            "flash_blue":  "rgba(75,145,255,255)",
            "glow_white":  "rgba(255,255,255,255)",
            "glow_orange": "rgba(255,140,0,255)",
            "glow_purple": "rgba(185,75,255,255)",
            "neon_green":  "rgba(57,255,20,255)",
            "neon_blue":   "rgba(77,77,255,255)",
            "zoom_in":     "rgba(255,220,80,255)",
            "zoom_out":    "rgba(100,200,255,255)",
            "typewriter":  "rgba(200,255,200,255)",
            "bounce":      "rgba(255,180,0,255)",
            "shake":       "rgba(255,100,100,255)",
        }

        if fx in COLORS:
            c = COLORS[fx]
            s(0, c); s(90, orig); s(160, c); r(260)

        elif fx == "pulse":
            s(0,   "rgba(255,255,255,255)")
            s(70,  "rgba(255,255,255,60)")
            s(140, "rgba(255,255,255,255)")
            s(210, "rgba(255,255,255,60)")
            r(290)

        elif fx == "rainbow":
            cols = ["rgba(255,80,80,255)","rgba(255,160,0,255)","rgba(240,220,0,255)",
                    "rgba(80,220,80,255)","rgba(0,180,255,255)","rgba(160,80,255,255)"]
            for i, c in enumerate(cols):
                s(i*45, c)
            r(len(cols)*45 + 30)

        elif fx == "spin_color":
            cols = ["rgba(255,50,50,255)","rgba(255,150,0,255)","rgba(50,255,100,255)",
                    "rgba(0,200,255,255)","rgba(150,50,255,255)","rgba(255,50,150,255)"]
            for i, c in enumerate(cols):
                s(i*40, c)
            r(len(cols)*40 + 30)

        elif fx == "fire_text":
            s(0,  "rgba(255,255,60,255)")
            s(60, "rgba(255,160,0,255)")
            s(120,"rgba(255,80,0,255)")
            s(180,"rgba(255,160,0,255)")
            s(240,"rgba(255,255,60,255)")
            r(300)

    def paintEvent(self, event):
        import math, time
        from PyQt6.QtCore import QRectF
        from PyQt6.QtGui import QLinearGradient, QRadialGradient
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        r = QRectF(self.rect())
        fx = APP_SETTINGS.get("card_effect", "none")
        t = time.time()

        p.setBrush(QBrush(QColor(20, 20, 40, 180)))
        p.setPen(Qt.PenStyle.NoPen)

        p.drawRoundedRect(r, 14, 14)

        # Efekty wymagają odświeżania
        # Tło zawsze statyczne - efekty są na słówku

    def _apply_click_through(self):
        try:
            import platform
            if platform.system() == "Windows":
                import ctypes
                hwnd = int(self.winId())
                style = ctypes.windll.user32.GetWindowLongW(hwnd, -20)
                ctypes.windll.user32.SetWindowLongW(hwnd, -20, style | 0x00080000 | 0x00000020)
            elif platform.system() == "Darwin":
                try:
                    from AppKit import NSApp, NSWindow
                    from Foundation import NSObject
                    import objc
                    ns_view = objc.objc_object(c_void_p=self.winId().__int__())
                    ns_window = ns_view.window()
                    if ns_window:
                        # NSWindowStyleMaskNonactivatingPanel = 1 << 7
                        ns_window.setIgnoresMouseEvents_(True)
                except ImportError:
                    # pyobjc nie jest zainstalowane — fallback
                    self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        except Exception as e:
            print(f"[click-through] {e}")


# ──────────────────────────────────────────────────────
# OKNO KATEGORII
# ──────────────────────────────────────────────────────
class CategoryWindow(_DraggableWindow):
    def __init__(self, on_selected, on_back):
        super().__init__()
        self.on_selected  = on_selected
        self.on_back      = on_back
        self.curr_lang    = "en"
        self.curr_lvl     = "A1"
        self._is_premium  = False
        self._bought_levels = []
        _styled_window(self)
        self.setFixedSize(400, 600)
        self._build()
        _right_third_pos(self)

    def set_premium(self, is_premium: bool, bought_levels: list = None):
        self._is_premium    = is_premium
        self._bought_levels = bought_levels or []

    def _build(self):
        from PyQt6.QtWidgets import QScrollArea as _SA
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag z tytułem
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        self.title = QLabel("📚  Wybierz kategorię")
        self.title.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        self.title.setStyleSheet("color:white;background:transparent;")
        self.title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(self.title)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        inner_lay = QVBoxLayout(inner)
        inner_lay.setContentsMargins(16, 8, 16, 16)
        inner_lay.setSpacing(8)
        lay.addWidget(inner, 1)

        self.sub = QLabel("")
        self.sub.setFont(QFont("Segoe UI", 9))
        self.sub.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner_lay.addWidget(self.sub)

        self._scroll = _SA()
        self._scroll.setWidgetResizable(True)
        self._scroll.setStyleSheet("QScrollArea { background: transparent; border: none; } QScrollBar:vertical { background: rgba(255,255,255,0.05); width: 6px; border-radius: 3px; } QScrollBar::handle:vertical { background: rgba(255,255,255,0.25); border-radius: 3px; }")
        self._inner_w = QWidget()
        self._inner_w.setStyleSheet("background: transparent;")
        self._scroll.setWidget(self._inner_w)
        inner_lay.addWidget(self._scroll, 1)

        inner_lay.addWidget(_back_btn("← Wróć do poziomów", self._go_back))
        inner_lay.addWidget(_close_btn(self))

    def mark_done(self, cat_code):
        """Oznacz kategorię zielonym ptaszkiem - tylko przy ikonie."""
        if not hasattr(self, '_done_cats'):
            self._done_cats = set()
        self._done_cats.add(cat_code)
        if not hasattr(self, '_cat_btns'):
            self._cat_btns = {}
        btn = self._cat_btns.get(cat_code)
        if btn:
            labels = btn.findChildren(QLabel)
            if labels:
                # Pierwszy label = ikona - zamień na ✅
                icon_lbl = labels[0]
                if "✅" not in icon_lbl.text():
                    icon_lbl.setText("✅")
                    icon_lbl.setStyleSheet("background:transparent; font-size:16px;")
            btn.setStyleSheet("QPushButton { background:rgba(30,100,50,180); border:1px solid rgba(80,200,120,150); border-radius:12px; } QPushButton:hover { background:rgba(40,130,70,220); }")

    def _rebuild_grid(self):
        if not hasattr(self, '_done_cats'):
            self._done_cats = set()
        self._cat_btns = {}
        old_widget = self._scroll.takeWidget()
        if old_widget:
            old_widget.deleteLater()
        self._inner_w = QWidget()
        self._inner_w.setStyleSheet("background: transparent;")
        self._scroll.setWidget(self._inner_w)
        inner_lay = QGridLayout(self._inner_w)
        inner_lay.setContentsMargins(0, 4, 4, 4)
        inner_lay.setSpacing(6)
        for i, cat in enumerate(CATEGORIES):
            btn = self._cat_btn(cat)
            self._cat_btns[cat["code"]] = btn
            inner_lay.addWidget(btn, i // 2, i % 2)
        for code in self._done_cats:
            self.mark_done(code)

    def _cat_btn(self, cat):
        btn = QPushButton()
        btn.setFixedHeight(58)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.setStyleSheet("""
            QPushButton { background:rgba(50,70,150,180);
                border:1px solid rgba(100,130,220,120); border-radius:12px; }
            QPushButton:hover  { background:rgba(70,100,190,220); }
            QPushButton:pressed{ background:rgba(30,50,110,255); }
        """)
        inner = QVBoxLayout(btn)
        inner.setContentsMargins(8, 5, 8, 5)
        inner.setSpacing(1)
        li = QLabel(cat["icon"])
        li.setFont(QFont("Segoe UI", 15))
        li.setStyleSheet("background:transparent;")
        li.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ln = QLabel(cat["label"])
        ln.setFont(QFont("Segoe UI", 9, QFont.Weight.Bold))
        ln.setStyleSheet("color:rgba(220,235,255,220); background:transparent;")
        ln.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner.addWidget(li)
        inner.addWidget(ln)
        btn.clicked.connect(lambda _, c=cat["code"]: self._pick(c))
        return btn

    def set_context(self, lang, lvl):
        self.curr_lang = lang
        self.curr_lvl  = lvl
        flag = next((l["flag"] for l in LANGUAGES if l["code"] == lang), "")
        self.sub.setText(f"{flag}  {lang_label(lang)}  ·  Poziom {lvl}")

    def _pick(self, cat):
        self.on_selected(self.curr_lang, self.curr_lvl, cat)
        self.hide()

    def _go_back(self):
        self.hide()
        self.on_back()

    def paintEvent(self, e):
        _paint_bg(self, e)


# ──────────────────────────────────────────────────────
# OKNO POZIOMU
# ──────────────────────────────────────────────────────
class LevelWindow(_DraggableWindow):
    open_purchase = pyqtSignal(str)

    def __init__(self, on_selected, on_back):
        super().__init__()
        self.on_selected  = on_selected
        self.on_back      = on_back
        self.current_lang = "en"
        self._is_premium    = False
        self._bought_levels = []
        _styled_window(self)
        self.setFixedSize(340, 400)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag z tytułem
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        self.title = QLabel("🎯  Wybierz poziom")
        self.title.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        self.title.setStyleSheet("color:white;background:transparent;")
        self.title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(self.title)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        inner_lay = QVBoxLayout(inner)
        inner_lay.setContentsMargins(20, 8, 20, 16)
        inner_lay.setSpacing(8)
        lay.addWidget(inner, 1)

        self.sub = QLabel("")
        self.sub.setFont(QFont("Segoe UI", 9))
        self.sub.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner_lay.addWidget(self.sub)

        self._grid = QGridLayout()
        self._grid.setSpacing(10)
        for i, lv in enumerate(LEVELS):
            self._grid.addWidget(self._lvl_btn(lv), i // 2, i % 2)
        inner_lay.addLayout(self._grid)

        inner_lay.addWidget(_back_btn("← Wróć do języków", self._go_back))
        inner_lay.addWidget(_close_btn(self))

    def _lvl_btn(self, level):
        btn = QPushButton()
        btn.setFixedHeight(70)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        inner = QVBoxLayout(btn)
        inner.setContentsMargins(10, 6, 10, 6)
        inner.setSpacing(2)

        lc = QLabel(level["label"])
        lc.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        lc.setStyleSheet("color:white; background:transparent;")
        lc.setAlignment(Qt.AlignmentFlag.AlignCenter)

        ld = QLabel(level["desc"])
        ld.setFont(QFont("Segoe UI", 8))
        ld.setStyleSheet("color:rgba(200,220,255,180); background:transparent;")
        ld.setAlignment(Qt.AlignmentFlag.AlignCenter)

        inner.addWidget(lc)
        inner.addWidget(ld)

        key = f"{self.current_lang}_{level['code']}"
        unlocked = level["free"] or self._is_premium or key in self._bought_levels
        if unlocked:
            btn.setStyleSheet("""
                QPushButton { background:rgba(40,130,80,180);
                    border:1px solid rgba(80,200,120,150); border-radius:12px; }
                QPushButton:hover  { background:rgba(50,160,100,220); }
                QPushButton:pressed{ background:rgba(30,100,60,255); }
            """)
            btn.clicked.connect(lambda _, c=level["code"]: self._pick(c))
        else:
            ll = QLabel("🔒")
            ll.setFont(QFont("Segoe UI", 10))
            ll.setStyleSheet("background:transparent;")
            ll.setAlignment(Qt.AlignmentFlag.AlignCenter)
            inner.addWidget(ll)
            btn.setStyleSheet("""
                QPushButton { background:rgba(40,40,60,140);
                    border:1px solid rgba(80,80,120,100); border-radius:12px; }
                QPushButton:hover { background:rgba(60,60,90,180); }
            """)
            btn.clicked.connect(lambda _, c=level["code"]: self._locked(c))
        return btn

    def set_bought_levels(self, levels: list):
        """Odblokuj konkretne poziomy kupione za złoto."""
        self._bought_levels = levels
        for i in reversed(range(self._grid.count())):
            w = self._grid.itemAt(i).widget()
            if w: w.deleteLater()
        for i, lv in enumerate(LEVELS):
            self._grid.addWidget(self._lvl_btn(lv), i // 2, i % 2)

    def set_premium(self, is_premium: bool):
        """Odblokuj wszystkie poziomy jeśli użytkownik ma premium."""
        self._is_premium = is_premium
        # przebuduj siatkę poziomów
        # usuń stare przyciski
        for i in reversed(range(self._grid.count())):
            w = self._grid.itemAt(i).widget()
            if w:
                w.deleteLater()
        for i, lv in enumerate(LEVELS):
            self._grid.addWidget(self._lvl_btn(lv), i // 2, i % 2)

    def set_language(self, lang_code):
        self.current_lang = lang_code
        flag = next((l["flag"] for l in LANGUAGES if l["code"] == lang_code), "")
        self.sub.setText(f"{flag}  {lang_label(lang_code)} → Polski")
        # Przebuduj siatkę dla nowego języka
        for i in reversed(range(self._grid.count())):
            w = self._grid.itemAt(i).widget()
            if w: w.deleteLater()
        for i, lv in enumerate(LEVELS):
            self._grid.addWidget(self._lvl_btn(lv), i // 2, i % 2)

    def _pick(self, lvl):
        self.on_selected(self.current_lang, lvl)
        self.hide()

    def _locked(self, lvl):
        price_key = f"{self.current_lang}_{lvl}"
        self.open_purchase.emit(price_key)

    def _go_back(self):
        self.hide()
        self.on_back()

    def paintEvent(self, e):
        _paint_bg(self, e)


# ──────────────────────────────────────────────────────
# OKNO JĘZYKA
# ──────────────────────────────────────────────────────
class LanguageWindow(_DraggableWindow):
    def __init__(self, on_selected):
        super().__init__()
        self.on_selected = on_selected
        _styled_window(self)
        self.setFixedSize(320, 620)
        self._build()
        _right_third_pos(self)

    def _build(self):
        from PyQt6.QtWidgets import QScrollArea as _SA
        main = QVBoxLayout(self)
        main.setContentsMargins(0, 0, 0, 0)
        main.setSpacing(0)

        # ── Pasek drag (32px) z tytułem wyśrodkowanym ──
        hdr = QWidget(); hdr.setFixedHeight(32)
        hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("🌍  Wybierz język")
        t.setFont(QFont("Segoe UI", 13, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        main.addWidget(hdr)

        # Podtytuł
        inner_w = QWidget(); inner_w.setStyleSheet("background:transparent;")
        inner_l = QVBoxLayout(inner_w); inner_l.setContentsMargins(20, 12, 20, 12); inner_l.setSpacing(12)

        s = QLabel("Język obcy → Polski")
        s.setFont(QFont("Segoe UI", 9))
        s.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        s.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner_l.addWidget(s)

        # ── Scroll na języki (oddzielony) ──
        scroll = _SA()
        scroll.setWidgetResizable(True)
        scroll.setFixedHeight(220)
        scroll.setStyleSheet("""
            QScrollArea { background: rgba(20,20,50,120); border: 1px solid rgba(100,110,180,60); border-radius: 10px; }
            QScrollBar:vertical { background: rgba(255,255,255,0.05); width: 6px; border-radius: 3px; }
            QScrollBar::handle:vertical { background: rgba(255,255,255,0.25); border-radius: 3px; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
        """)
        lang_w = QWidget(); lang_w.setStyleSheet("background:transparent;")
        lang_l = QVBoxLayout(lang_w); lang_l.setContentsMargins(8, 8, 8, 8); lang_l.setSpacing(5)

        STY_LANG = """
            QPushButton { background:rgba(60,80,160,180); color:white;
                border:1px solid rgba(100,130,220,120);
                border-radius:10px; padding:10px 16px;
                font-size:14px; text-align:left; }
            QPushButton:hover  { background:rgba(80,110,200,220); }
            QPushButton:pressed{ background:rgba(40,60,130,255); }
        """
        STY_GREY = """
            QPushButton { background:rgba(40,40,60,120); color:rgba(150,160,180,140);
                border:1px solid rgba(70,75,100,80);
                border-radius:10px; padding:10px 16px;
                font-size:14px; text-align:left; }
        """

        for lang in LANGUAGES:
            available = lang.get("available", True)
            label = f"{lang['flag']}  {lang['label']}"
            if not available:
                label += "  🔜"
            btn = QPushButton(label)
            btn.setStyleSheet(STY_LANG if available else STY_GREY)
            btn.setFont(QFont("Segoe UI", 12))
            btn.setCursor(Qt.CursorShape.PointingHandCursor if available else Qt.CursorShape.ForbiddenCursor)
            btn.setEnabled(available)
            if available:
                btn.clicked.connect(lambda _, c=lang["code"]: self.on_selected(c))
            lang_l.addWidget(btn)

        lang_l.addStretch()
        scroll.setWidget(lang_w)
        inner_l.addWidget(scroll)

        # Separator
        sep = QWidget(); sep.setFixedHeight(1)
        sep.setStyleSheet("background:rgba(100,110,180,80);")
        inner_l.addWidget(sep)

        # ── Przyciski akcji — ciemne z kolorową lewą krawędzią ──
        def _sty(border_color, hover_color="rgba(255,255,255,8)"):
            return f"""
                QPushButton {{
                    background: rgba(30,32,60,160);
                    color: rgba(220,225,255,210);
                    border: 1px solid rgba(80,85,120,80);
                    border-left: 3px solid {border_color};
                    border-radius: 10px;
                    padding: 8px 16px;
                    font-size: 13px;
                    text-align: left;
                }}
                QPushButton:hover {{
                    background: {hover_color};
                    color: white;
                }}
                QPushButton:pressed {{
                    background: rgba(20,22,50,200);
                }}
            """

        STY_PURPLE = _sty("rgba(130,100,230,220)", "rgba(50,40,90,180)")
        STY_BLUE   = _sty("rgba(80,140,230,220)",  "rgba(30,50,90,180)")
        STY_GREY   = _sty("rgba(140,145,165,180)",  "rgba(40,40,65,180)")
        STY_GOLD   = _sty("rgba(210,175,0,220)",    "rgba(50,42,20,180)")
        STY_GREEN  = _sty("rgba(60,180,100,220)",   "rgba(20,50,35,180)")

        btn_my = QPushButton("📂  Moje własne zestawy")
        btn_my.setStyleSheet(STY_PURPLE)
        btn_my.setFont(QFont("Segoe UI", 12))
        btn_my.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_my.clicked.connect(lambda: self.on_selected("my_sets"))
        inner_l.addWidget(btn_my)

        btn_custom = QPushButton("✏️  Stwórz własne fiszki  ·  ⭐ Premium")
        btn_custom.setStyleSheet(_sty("rgba(130,80,220,220)", "rgba(40,20,60,180)"))
        btn_custom.setFont(QFont("Segoe UI", 12))
        btn_custom.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_custom.clicked.connect(lambda: self.on_selected("create"))
        inner_l.addWidget(btn_custom)

        btn_settings = QPushButton("⚙️  Ustawienia")
        btn_settings.setStyleSheet(STY_GREY)
        btn_settings.setFont(QFont("Segoe UI", 12))
        btn_settings.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_settings.clicked.connect(lambda: self.on_selected("settings"))
        inner_l.addWidget(btn_settings)

        btn_test = QPushButton("📝  Zrób test")
        btn_test.setStyleSheet(STY_GREEN)
        btn_test.setFont(QFont("Segoe UI", 12))
        btn_test.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_test.clicked.connect(lambda: self.on_selected("test"))
        inner_l.addWidget(btn_test)

        inner_l.addWidget(_close_btn(self))
        main.addWidget(inner_w, 1)


    def paintEvent(self, e):
        _paint_bg(self, e)



# ──────────────────────────────────────────────────────
# WORKER – zapis własnego zestawu do Supabase
# ──────────────────────────────────────────────────────
class SaveSetWorker(QThread):
    done  = pyqtSignal(int)   # id nowego zestawu
    error = pyqtSignal(str)

    def __init__(self, name, cards):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.name  = name
        self.cards = cards

    def run(self):
        try:
            user_id = current_uid()

            # zapisz zestaw
            resp = supabase.table("user_sets").insert({
                "user_id": user_id,
                "name":    self.name,
            }).execute()
            set_id = resp.data[0]["id"]

            # zapisz fiszki
            rows = [{"set_id": set_id, "word": c["word"],
                     "translation": c["translation"], "sort_order": i}
                    for i, c in enumerate(self.cards)]
            supabase.table("user_set_cards").insert(rows).execute()
            self.done.emit(set_id)
        except Exception as e:
            self.error.emit(str(e))


# ──────────────────────────────────────────────────────
# WORKER – pobieranie własnych zestawów
# ──────────────────────────────────────────────────────
class LoadSetsWorker(QThread):
    done  = pyqtSignal(list)
    error = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.finished.connect(self.deleteLater)

    def run(self):
        try:
            user_id = current_uid()
            resp = supabase.table("user_sets").select("id,name,is_public,likes_count").eq("user_id", user_id).execute()
            self.done.emit(resp.data or [])
        except Exception as e:
            self.error.emit(str(e))


# ──────────────────────────────────────────────────────
# WORKER – pobieranie kart własnego zestawu
# ──────────────────────────────────────────────────────
class LoadSetCardsWorker(QThread):
    done  = pyqtSignal(list)
    error = pyqtSignal(str)

    def __init__(self, set_id):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.set_id = set_id

    def run(self):
        try:
            resp = supabase.table("user_set_cards").select(
                "word,translation"
            ).eq("set_id", self.set_id).order("sort_order").execute()
            self.done.emit(resp.data or [])
        except Exception as e:
            self.error.emit(str(e))



class LoadPublicSetsWorker(QThread):
    done  = pyqtSignal(list)
    error = pyqtSignal(str)

    def __init__(self, query=""):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.query = query

    def run(self):
        try:
            q = supabase.table("user_sets").select(
                "id,name,likes_count,user_id,user_set_cards(word,translation)"
            ).eq("is_public", True).order("likes_count", desc=True).limit(50)
            if self.query:
                q = q.ilike("name", f"%{self.query}%")
            resp = q.execute()
            self.done.emit(resp.data or [])
        except Exception as e:
            self.error.emit(str(e))


class ImportSetWorker(QThread):
    done  = pyqtSignal(str)   # nazwa zestawu
    error = pyqtSignal(str)

    def __init__(self, set_id, set_name, cards):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.set_id   = set_id
        self.set_name = set_name
        self.cards    = cards

    def run(self):
        try:
            uid = current_uid()
            # Sprawdź czy już zaimportowany
            existing = supabase.table("user_sets").select("id").eq("user_id", uid).eq("name", self.set_name).execute()
            if existing.data:
                self.done.emit(self.set_name)
                return
            resp = supabase.table("user_sets").insert({
                "user_id": uid,
                "name": self.set_name,
                "is_public": False,
            }).execute()
            new_id = resp.data[0]["id"]
            rows = [{"set_id": new_id, "word": c["word"],
                     "translation": c["translation"], "sort_order": i}
                    for i, c in enumerate(self.cards)]
            supabase.table("user_set_cards").insert(rows).execute()
            self.done.emit(self.set_name)
        except Exception as e:
            self.error.emit(str(e))


class PublicSetsWindow(_DraggableWindow):
    """Okno przeglądania i importu publicznych zestawów."""
    set_imported = pyqtSignal()

    def __init__(self):
        super().__init__()
        self._is_premium = False
        _styled_window(self)
        self.setFixedSize(420, 560)
        self._build()
        _right_third_pos(self)

    def set_premium(self, v): self._is_premium = v

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("🌐  Zestawy społeczności")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        il = QVBoxLayout(inner); il.setContentsMargins(16, 10, 16, 14); il.setSpacing(8)
        lay.addWidget(inner, 1)

        # Wyszukiwarka
        self.inp_search = QLineEdit()
        self.inp_search.setPlaceholderText("🔍 Szukaj zestawów...")
        self.inp_search.setMinimumHeight(34)
        self.inp_search.setStyleSheet(INPUT_STYLE)
        self.inp_search.textChanged.connect(self._on_search)
        il.addWidget(self.inp_search)

        # Lista zestawów
        from PyQt6.QtWidgets import QScrollArea
        sa = QScrollArea(); sa.setWidgetResizable(True)
        sa.setStyleSheet("""
            QScrollArea{background:transparent;border:none;}
            QScrollBar:vertical{background:rgba(255,255,255,.04);width:5px;border-radius:2px;}
            QScrollBar::handle:vertical{background:rgba(255,255,255,.22);border-radius:2px;}
            QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0;}
        """)
        self._list_w = QWidget(); self._list_w.setStyleSheet("background:transparent;")
        self._list_l = QVBoxLayout(self._list_w); self._list_l.setContentsMargins(0,0,4,0); self._list_l.setSpacing(6)
        self._list_l.addStretch()
        sa.setWidget(self._list_w)
        il.addWidget(sa, 1)

        self.lbl_status = QLabel("Ładowanie...")
        self.lbl_status.setFont(QFont("Segoe UI", 9))
        self.lbl_status.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_status.setAlignment(Qt.AlignmentFlag.AlignCenter)
        il.addWidget(self.lbl_status)

        il.addWidget(_back_btn("← Wróć do moich zestawów", self._go_back_to_my_sets))
        il.addWidget(_close_btn(self))

    def _go_back_to_my_sets(self):
        self.hide()
        # Sygnał do TrayApp żeby pokazać MySetsPicker
        if hasattr(self, '_on_back_callback') and self._on_back_callback:
            self._on_back_callback()

    def set_back_callback(self, cb):
        self._on_back_callback = cb

    def show_and_load(self):
        self.show(); self.raise_(); self.activateWindow()
        self._load()

    def _load(self, query=""):
        self.lbl_status.setText("Ładowanie...")
        self._clear_list()
        self._worker = LoadPublicSetsWorker(query)
        self._worker.done.connect(self._on_loaded)
        self._worker.error.connect(lambda e: self.lbl_status.setText(f"Błąd: {e}"))
        self._worker.start()

    def _on_search(self, text):
        QTimer.singleShot(400, lambda: self._load(text.strip()))

    def _clear_list(self):
        while self._list_l.count() > 1:
            item = self._list_l.takeAt(0)
            if item.widget(): item.widget().deleteLater()

    def _on_loaded(self, sets):
        self._clear_list()
        if not sets:
            self.lbl_status.setText("Brak zestawów.")
            return
        self.lbl_status.setText(f"{len(sets)} zestaw(ów)")
        for s in sets:
            self._add_row(s)

    def _add_row(self, s):
        row = QWidget(); row.setStyleSheet("background:transparent;")
        rl = QHBoxLayout(row); rl.setContentsMargins(0,0,0,0); rl.setSpacing(6)

        info = QVBoxLayout(); info.setSpacing(1)
        lname = QLabel(f"📖  {s['name']}")
        lname.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        lname.setStyleSheet("color:white;background:transparent;")
        cards = s.get("user_set_cards", [])
        lmeta = QLabel(f"❤️ {s.get('likes_count',0)} · {len(cards)} fiszek")
        lmeta.setFont(QFont("Segoe UI", 9))
        lmeta.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        info.addWidget(lname); info.addWidget(lmeta)

        btn = QPushButton("⬇ Importuj")
        btn.setFixedWidth(90)
        btn.setStyleSheet("""
            QPushButton{background:rgba(30,32,60,160);color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);border-left:3px solid rgba(210,175,0,220);
                border-radius:8px;padding:6px 10px;font-size:11px;}
            QPushButton:hover{background:rgba(50,42,20,180);color:white;}
            QPushButton:disabled{color:rgba(100,255,150,220);border-left-color:rgba(60,200,100,150);}
        """)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)

        if not self._is_premium:
            btn.setEnabled(False)
            btn.setText("⭐ Premium")
        else:
            btn.clicked.connect(lambda _, sid=s["id"], sname=s["name"], sc=cards: self._import(sid, sname, sc, btn))

        rl.addLayout(info, 1)
        rl.addWidget(btn)
        self._list_l.insertWidget(self._list_l.count()-1, row)

    def _import(self, set_id, set_name, cards, btn):
        btn.setEnabled(False); btn.setText("⏳")
        self._import_worker = ImportSetWorker(set_id, set_name, cards)
        self._import_worker.done.connect(lambda n: (btn.__setattr__('_done', True), btn.setText("✅ Dodano"), self.set_imported.emit()))
        self._import_worker.error.connect(lambda e: (btn.setEnabled(True), btn.setText("⬇ Importuj")))
        self._import_worker.start()

    def paintEvent(self, e):
        _paint_bg(self, e)
class CategoryViewWorker(QThread):
    done = pyqtSignal(int)  # łączna liczba widoków

    def __init__(self, lang, level, cat):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.lang  = lang
        self.level = level
        self.cat   = cat

    def run(self):
        try:
            resp = supabase.rpc("increment_category_views", {
                "p_lang": self.lang, "p_level": self.level, "p_cat": self.cat
            }).execute()
            self.done.emit(resp.data or 0)
        except Exception as e:
            print(f"[VIEWS] {e}")


# ──────────────────────────────────────────────────────
# WORKER – aktualizacja SRS po teście
# ──────────────────────────────────────────────────────
class SRSUpdateWorker(QThread):
    def __init__(self, results):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.results = results  # lista (flashcard_id, quality)

    def run(self):
        for fid, quality in self.results:
            try:
                supabase.rpc("update_word_srs", {
                    "p_flashcard_id": fid,
                    "p_quality": quality
                }).execute()
            except Exception as e:
                print(f"[SRS] {e}")

# ──────────────────────────────────────────────────────
# OKNO TWORZENIA WŁASNYCH FISZEK
# ──────────────────────────────────────────────────────
MAX_CARDS = 20  # darmowy limit

class CustomSetWindow(_DraggableWindow):
    set_created = pyqtSignal(str, list)

    def __init__(self, on_back):
        super().__init__()
        self.on_back     = on_back
        self.card_rows   = []
        self._is_premium = False
        _styled_window(self)
        self.setFixedSize(440, 580)
        self._build()
        _right_third_pos(self)

    def set_premium(self, is_premium: bool):
        self._is_premium = is_premium
        limit = 9999 if is_premium else MAX_CARDS
        if hasattr(self, 'lbl_limit'):
            if is_premium:
                self.lbl_limit.hide()
            else:
                self.lbl_limit.show()

    def _build(self):
        from PyQt6.QtWidgets import QScrollArea

        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("✏️  Stwórz własny zestaw")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        self.main_lay = QVBoxLayout(inner)
        self.main_lay.setContentsMargins(20, 10, 20, 16)
        self.main_lay.setSpacing(8)
        lay.addWidget(inner, 1)

        # Info o limicie dla darmowych
        self.lbl_limit = QLabel(f"⭐ Plan darmowy: do {MAX_CARDS} fiszek w zestawie · Subskrypcja = bez limitu")
        self.lbl_limit.setFont(QFont("Segoe UI", 9))
        self.lbl_limit.setStyleSheet("color:rgba(210,175,0,200);background:transparent;")
        self.lbl_limit.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_limit.setWordWrap(True)
        self.main_lay.addWidget(self.lbl_limit)

        # Nazwa zestawu
        self.inp_name = QLineEdit()
        self.inp_name.setPlaceholderText("Nazwa zestawu (np. Angielski – sprawdzian)")
        self.inp_name.setMinimumHeight(36)
        self.inp_name.setStyleSheet(INPUT_STYLE)
        self.main_lay.addWidget(self.inp_name)

        # Nagłówki kolumn
        hdr_w = QWidget(); hdr_w.setStyleSheet("background:transparent;")
        hdr_lay = QHBoxLayout(hdr_w); hdr_lay.setContentsMargins(4, 0, 4, 0)
        for txt in ["Słowo / pytanie", "Tłumaczenie / odpowiedź", ""]:
            lh = QLabel(txt)
            lh.setFont(QFont("Segoe UI", 8))
            lh.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
            hdr_lay.addWidget(lh, 0 if txt == "" else 1)
        self.main_lay.addWidget(hdr_w)

        # Scroll na fiszki — stała wysokość
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFixedHeight(340)
        scroll.setStyleSheet("""
            QScrollArea { border:none; background:transparent; }
            QScrollBar:vertical { background:rgba(255,255,255,.04); width:5px; border-radius:2px; }
            QScrollBar::handle:vertical { background:rgba(255,255,255,.22); border-radius:2px; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height:0; }
        """)
        self.cards_widget = QWidget(); self.cards_widget.setStyleSheet("background:transparent;")
        self.cards_lay = QVBoxLayout(self.cards_widget)
        self.cards_lay.setContentsMargins(0, 0, 4, 0)
        self.cards_lay.setSpacing(6)
        self.cards_lay.addStretch()
        scroll.setWidget(self.cards_widget)
        self.main_lay.addWidget(scroll)

        # Dodaj pierwsze 3 wiersze
        for _ in range(3):
            self._add_row()

        # Przyciski
        btn_add = QPushButton("+ Dodaj wiersz")
        btn_add.setStyleSheet("""
            QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);
                border-left:3px solid rgba(60,180,100,220);
                border-radius:10px; padding:8px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(20,50,35,180); color:white; }
        """)
        btn_add.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_add.clicked.connect(self._add_row)
        self.main_lay.addWidget(btn_add)

        self.lbl_error = QLabel("")
        self.lbl_error.setStyleSheet("color:rgba(255,100,100,220);font-size:11px;background:transparent;")
        self.lbl_error.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.main_lay.addWidget(self.lbl_error)

        self.btn_save = QPushButton("💾  Zapisz zestaw")
        self.btn_save.setMinimumHeight(36)
        self.btn_save.setStyleSheet(BTN_PRIMARY)
        self.btn_save.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_save.clicked.connect(self._save)
        self.main_lay.addWidget(self.btn_save)

        self.main_lay.addWidget(_back_btn("← Wróć", self._go_back))

    def _add_row(self):
        limit = 9999 if self._is_premium else MAX_CARDS
        if len(self.card_rows) >= limit:
            if not self._is_premium:
                self.lbl_error.setText(f"Limit {MAX_CARDS} fiszek w planie darmowym · kup subskrypcję po więcej")
            return

        row_widget = QWidget()
        row_widget.setStyleSheet("background:transparent;")
        row_lay = QHBoxLayout(row_widget)
        row_lay.setContentsMargins(0, 0, 0, 0)
        row_lay.setSpacing(8)

        inp_word = QLineEdit()
        inp_word.setPlaceholderText("słowo")
        inp_word.setMinimumHeight(32)
        inp_word.setStyleSheet(INPUT_STYLE)

        inp_tr = QLineEdit()
        inp_tr.setPlaceholderText("tłumaczenie")
        inp_tr.setMinimumHeight(32)
        inp_tr.setStyleSheet(INPUT_STYLE)

        btn_del = QPushButton("✕")
        btn_del.setFixedSize(28, 28)
        btn_del.setStyleSheet("QPushButton{background:rgba(150,40,40,140);color:white;border-radius:6px;font-size:10px;}"
                              "QPushButton:hover{background:rgba(190,60,60,200);}")
        btn_del.setCursor(Qt.CursorShape.PointingHandCursor)

        row_lay.addWidget(inp_word)
        row_lay.addWidget(inp_tr)
        row_lay.addWidget(btn_del)

        # Wstaw przed stretch
        count = self.cards_lay.count()
        self.cards_lay.insertWidget(count - 1, row_widget)
        self.card_rows.append((inp_word, inp_tr, row_widget))

        def _remove():
            row_widget.hide()
            row_widget.deleteLater()
            self.card_rows[:] = [(w, t, r) for w, t, r in self.card_rows if r is not row_widget]
            self.lbl_error.setText("")

        btn_del.clicked.connect(_remove)

    def _save(self):
        name = self.inp_name.text().strip()
        if not name:
            self.lbl_error.setText("Wpisz nazwę zestawu.")
            return

        cards = []
        for row in self.card_rows:
            inp_w, inp_t = row[0], row[1]
            w = inp_w.text().strip()
            t = inp_t.text().strip()
            if w and t:
                cards.append({"word": w, "translation": t})

        if len(cards) < 2:
            self.lbl_error.setText("Dodaj co najmniej 2 wypełnione fiszki.")
            return

        self.lbl_error.setText("")
        self.btn_save.setEnabled(False)
        self.btn_save.setText("Zapisywanie...")

        self._worker = SaveSetWorker(name, cards)
        self._worker.done.connect(lambda _: self._on_saved(name, cards))
        self._worker.error.connect(self._on_error)
        self._worker.start()

    def _on_saved(self, name, cards):
        self.btn_save.setEnabled(True)
        self.btn_save.setText("💾  Stwórz zestaw")
        self.hide()
        self.set_created.emit(name, cards)

    def _on_error(self, msg):
        self.lbl_error.setText(f"Błąd zapisu: {msg}")
        self.btn_save.setEnabled(True)
        self.btn_save.setText("💾  Stwórz zestaw")

    def _go_back(self):
        self.hide()
        self.on_back()

    def paintEvent(self, e):
        _paint_bg(self, e)


# ──────────────────────────────────────────────────────
# OKNO WYBORU WŁASNEGO ZESTAWU
# ──────────────────────────────────────────────────────
class MySetsPicker(_DraggableWindow):
    set_picked = pyqtSignal(str, list)

    FREE_SET_LIMIT = 1
    FREE_CARD_LIMIT = 20

    def __init__(self, on_back, on_create, on_browse_community=None):
        super().__init__()
        self.on_back   = on_back
        self.on_create = on_create
        self.on_browse_community = on_browse_community
        self.sets      = []
        self._is_premium = False
        _styled_window(self)
        self.setFixedSize(340, 460)
        self._build()
        _right_third_pos(self)

    def set_premium(self, is_premium: bool):
        self._is_premium = is_premium

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("📂  Moje zestawy")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        self.lay = QVBoxLayout(inner)
        self.lay.setContentsMargins(20, 10, 20, 16)
        self.lay.setSpacing(8)
        lay.addWidget(inner, 1)

        # Info o limicie
        self.lbl_limit = QLabel("")
        self.lbl_limit.setFont(QFont("Segoe UI", 9))
        self.lbl_limit.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_limit.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_limit.setWordWrap(True)
        self.lay.addWidget(self.lbl_limit)

        sep = QWidget(); sep.setFixedHeight(1)
        sep.setStyleSheet("background:rgba(100,110,180,60);")
        self.lay.addWidget(sep)

        self.lbl_status = QLabel("Ładowanie...")
        self.lbl_status.setFont(QFont("Segoe UI", 9))
        self.lbl_status.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_status.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lay.addWidget(self.lbl_status)

        self.sets_lay = QVBoxLayout()
        self.sets_lay.setSpacing(6)
        self.lay.addLayout(self.sets_lay)

        self.lay.addStretch()

        # Przycisk nowego zestawu
        self.btn_new = QPushButton("✏️  Stwórz nowy zestaw")
        self.btn_new.setStyleSheet("""
            QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);
                border-left:3px solid rgba(130,80,220,220);
                border-radius:10px; padding:9px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(40,20,60,180); color:white; }
            QPushButton:disabled { color:rgba(120,125,145,120);
                border-left:3px solid rgba(80,80,100,60); }
        """)
        self.btn_new.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_new.clicked.connect(self._on_create_clicked)
        self.lay.addWidget(self.btn_new)

        # Premium info (ukryty domyślnie)
        self.lbl_premium = QLabel("⭐ Subskrypcja odblokuje nieograniczone zestawy")
        self.lbl_premium.setFont(QFont("Segoe UI", 9))
        self.lbl_premium.setStyleSheet("color:rgba(210,175,0,200);background:transparent;")
        self.lbl_premium.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_premium.setWordWrap(True)
        self.lbl_premium.hide()
        self.lay.addWidget(self.lbl_premium)

        # Przycisk lokalnego przeglądania zestawów w programie
        btn_browse_local = QPushButton("🔍  Przeglądaj zestawy w programie")
        btn_browse_local.setStyleSheet("""
            QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);
                border-left:3px solid rgba(80,140,230,220);
                border-radius:10px; padding:8px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(30,50,90,180); color:white; }
        """)
        btn_browse_local.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_browse_local.clicked.connect(self._on_browse_community)
        self.lay.addWidget(btn_browse_local)

        # Przycisk przeglądania na stronie www
        btn_browse_www = QPushButton("🌐  Materiały na stronie eyelingo")
        btn_browse_www.setStyleSheet("""
            QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);
                border-left:3px solid rgba(210,175,0,220);
                border-radius:10px; padding:8px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(50,42,20,180); color:white; }
        """)
        btn_browse_www.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_browse_www.clicked.connect(lambda: webbrowser.open("https://fabianadrianw.github.io/eyelingo/?page=community"))
        self.lay.addWidget(btn_browse_www)

        self.lay.addWidget(_back_btn("← Wróć do języków", self._go_back))
        self.lay.addWidget(_close_btn(self))

    def load_sets(self):
        self.lbl_status.setText("Ładowanie...")
        for i in reversed(range(self.sets_lay.count())):
            w = self.sets_lay.itemAt(i).widget()
            if w: w.deleteLater()
        self._loader = LoadSetsWorker()
        self._loader.done.connect(self._on_sets_loaded)
        self._loader.error.connect(lambda e: self.lbl_status.setText(f"Błąd: {e}"))
        self._loader.start()

    def _on_sets_loaded(self, sets):
        self.sets = sets
        count = len(sets)
        at_limit = not self._is_premium and count >= self.FREE_SET_LIMIT

        if not sets:
            self.lbl_status.setText("")
            if not self._is_premium:
                self.lbl_limit.setText(f"Możesz stworzyć 1 darmowy zestaw ({self.FREE_CARD_LIMIT} fiszek)")
            else:
                self.lbl_limit.setText("Nieograniczone zestawy ⭐")
        else:
            self.lbl_status.setText(f"Twoje zestawy ({count}):")
            if not self._is_premium:
                self.lbl_limit.setText(f"Plan darmowy: {count}/{self.FREE_SET_LIMIT} zestaw")
            else:
                self.lbl_limit.setText(f"Plan Premium: {count} zestaw(ów) ⭐")

        for s in sets:
            row = QWidget(); row.setStyleSheet("background:transparent;")
            rl = QHBoxLayout(row); rl.setContentsMargins(0,0,0,0); rl.setSpacing(6)

            btn = QPushButton(f"📖  {s['name']}")
            btn.setStyleSheet("""
                QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                    border:1px solid rgba(80,85,120,80);
                    border-left:3px solid rgba(80,140,230,220);
                    border-radius:10px; padding:9px 16px; font-size:12px; text-align:left; }
                QPushButton:hover { background:rgba(30,50,90,180); color:white; }
            """)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, sid=s["id"], sname=s.get("name","Zestaw"): self._pick_set(sid, sname))

            # Przełącznik publiczny/prywatny
            is_public = s.get("is_public", False)
            btn_pub = QPushButton("🌐" if is_public else "🔒")
            btn_pub.setFixedSize(34, 34)
            btn_pub.setToolTip("Publiczny" if is_public else "Prywatny")
            btn_pub.setStyleSheet(f"""
                QPushButton {{ background:{'rgba(30,100,50,160)' if is_public else 'rgba(60,40,40,160)'};
                    border:1px solid {'rgba(60,200,100,100)' if is_public else 'rgba(120,60,60,100)'};
                    border-radius:8px; font-size:14px; }}
                QPushButton:hover {{ background:rgba(60,60,90,200); }}
            """)
            btn_pub.setCursor(Qt.CursorShape.PointingHandCursor)
            btn_pub.clicked.connect(lambda _, sid=s["id"], pub=is_public, b=btn_pub: self._toggle_public(sid, pub, b))

            rl.addWidget(btn, 1)
            rl.addWidget(btn_pub)
            self.sets_lay.addWidget(row)

        if at_limit:
            self.btn_new.setEnabled(False)
            self.btn_new.setText("✏️  Stwórz nowy zestaw  ·  limit osiągnięty")
            self.lbl_premium.show()
        else:
            self.btn_new.setEnabled(True)
            self.btn_new.setText("✏️  Stwórz nowy zestaw")
            self.lbl_premium.setVisible(not self._is_premium)

    def _toggle_public(self, set_id, currently_public, btn):
        new_public = not currently_public
        try:
            supabase.from_("user_sets").update({"is_public": new_public}).eq("id", set_id).execute()
            btn.setText("🌐" if new_public else "🔒")
            btn.setToolTip("Publiczny" if new_public else "Prywatny")
            btn.setStyleSheet(f"""
                QPushButton {{ background:{'rgba(30,100,50,160)' if new_public else 'rgba(60,40,40,160)'};
                    border:1px solid {'rgba(60,200,100,100)' if new_public else 'rgba(120,60,60,100)'};
                    border-radius:8px; font-size:14px; }}
                QPushButton:hover {{ background:rgba(60,60,90,200); }}
            """)
            # Aktualizuj referencję dla następnego kliknięcia
            btn.clicked.disconnect()
            btn.clicked.connect(lambda _, sid=set_id, pub=new_public, b=btn: self._toggle_public(sid, pub, b))
        except Exception as e:
            print(f"[TOGGLE PUBLIC] {e}")

    def _on_browse_community(self):
        if self.on_browse_community:
            self.on_browse_community()

    def _on_create_clicked(self):
        count = len(self.sets)
        if not self._is_premium and count >= self.FREE_SET_LIMIT:
            self.lbl_premium.show()
            return
        self.on_create()
        count = len(self.sets)
        if not self._is_premium and count >= self.FREE_SET_LIMIT:
            self.lbl_premium.show()
            return
        self.on_create()

    def load_sets(self):
        self.lbl_status.setText("Ładowanie...")
        # wyczyść stare przyciski
        for i in reversed(range(self.sets_lay.count())):
            w = self.sets_lay.itemAt(i).widget()
            if w:
                w.deleteLater()

        self._loader = LoadSetsWorker()
        self._loader.done.connect(self._on_sets_loaded)
        self._loader.error.connect(lambda e: self.lbl_status.setText(f"Błąd: {e}"))
        self._loader.start()

    def _on_sets_loaded(self, sets):
        self.sets = sets
        if not sets:
            self.lbl_status.setText("Nie masz jeszcze żadnych zestawów.")
            return
        self.lbl_status.setText(f"Masz {len(sets)} zestaw(ów):")
        for s in sets:
            btn = QPushButton(f"📖  {s['name']}")
            btn.setStyleSheet("""
                QPushButton { background:rgba(50,70,150,180); color:white;
                    border:1px solid rgba(100,130,220,120);
                    border-radius:10px; padding:9px; font-size:12px;
                    text-align:left; }
                QPushButton:hover { background:rgba(70,100,190,220); }
            """)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, sid=s["id"], sname=s.get("name","Zestaw"): self._pick_set(sid, sname))
            self.sets_lay.addWidget(btn)

    def _pick_set(self, set_id, set_name="Mój zestaw"):
        self._current_set_name = set_name
        self._card_loader = LoadSetCardsWorker(set_id)
        self._card_loader.done.connect(self._on_cards_loaded)
        self._card_loader.error.connect(lambda e: self.lbl_status.setText(f"Błąd: {e}"))
        self._card_loader.start()

    def _on_cards_loaded(self, cards):
        self.hide()
        self.set_picked.emit(getattr(self, "_current_set_name", "Mój zestaw"), cards)

    def _go_back(self):
        self.hide()
        self.on_back()

    def paintEvent(self, e):
        _paint_bg(self, e)



# ──────────────────────────────────────────────────────
# WORKER – kupowanie poziomu za złoto
# ──────────────────────────────────────────────────────
class BuyLevelWorker(QThread):
    done  = pyqtSignal(bool, str, int)

    def __init__(self, lang_code, level_code):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.lang_code  = lang_code
        self.level_code = level_code

    def run(self):
        try:
            uid = current_uid()
            key = f"{self.lang_code}_{self.level_code}"
            # Pobierz złoto z learning_stats
            stats = supabase.from_("learning_stats").select("gold").eq("user_id", uid).single().execute()
            gold = stats.data.get("gold", 0) if stats.data else 0
            cost = 7500
            if gold < cost:
                self.done.emit(False, f"Potrzebujesz {cost} złota. Masz tylko {gold}.", gold)
                return
            # Pobierz levels_bought z profiles
            profile = supabase.from_("profiles").select("levels_bought").eq("user_id", uid).single().execute()
            current = profile.data.get("levels_bought") or []
            if isinstance(current, str):
                import json as _j; current = _j.loads(current)
            if not isinstance(current, list):
                current = []
            if key in current:
                self.done.emit(False, "Ten poziom już posiadasz.", gold)
                return
            current.append(key)
            new_gold = gold - cost
            # Zapisz
            supabase.from_("learning_stats").update({"gold": new_gold}).eq("user_id", uid).execute()
            supabase.from_("profiles").update({"levels_bought": current, "updated_at": "now()"}).eq("user_id", uid).execute()
            self.done.emit(True, f"Poziom {self.level_code} odblokowany! Zostało Ci {new_gold} złota.", new_gold)
        except Exception as e:
            self.done.emit(False, str(e), 0)


# ──────────────────────────────────────────────────────
# WORKER – aktualizacja streaka
# ──────────────────────────────────────────────────────
class StreakWorker(QThread):
    done = pyqtSignal(int)

    def __init__(self):
        super().__init__()
        self.finished.connect(self.deleteLater)

    def run(self):
        try:
            resp = supabase.rpc("update_streak").execute()
            self.done.emit(resp.data or 0)
        except Exception as e:
            print(f"[STREAK] {e}")


# ──────────────────────────────────────────────────────
# WORKER – pełny profil gracza
# ──────────────────────────────────────────────────────
class ProfileWorker(QThread):
    done  = pyqtSignal(dict)
    error = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.finished.connect(self.deleteLater)

    def run(self):
        try:
            resp = supabase.rpc("get_player_profile").execute()
            self.done.emit(resp.data or {})
        except Exception as e:
            self.error.emit(str(e))

# ──────────────────────────────────────────────────────
# WORKER – pobieranie złota i statusu premium
# ──────────────────────────────────────────────────────
class StatsWorker(QThread):
    done = pyqtSignal(dict)

    def run(self):
        try:
            uid = current_uid()
            stats = supabase.from_("learning_stats").select(
                "gold,cards_seen,minutes_active,streak_days,last_active"
            ).eq("user_id", uid).single().execute()
            profile = supabase.from_("profiles").select(
                "is_premium,premium_until,levels_bought,username"
            ).eq("user_id", uid).single().execute()
            sets = supabase.from_("user_sets").select(
                "id,name,likes_count", count="exact"
            ).eq("user_id", uid).execute()
            total_likes = sum(s.get("likes_count", 0) for s in (sets.data or []))
            self.done.emit({
                **(stats.data or {}),
                **(profile.data or {}),
                "sets_count": sets.count or 0,
                "total_likes": total_likes,
            })
        except Exception as e:
            print(f"[StatsWorker] {e}")
            self.done.emit({})


class StatsWindow(_DraggableWindow):
    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(380, 520)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("📊  Twoje statystyki")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        il = QVBoxLayout(inner); il.setContentsMargins(20, 12, 20, 16); il.setSpacing(10)
        lay.addWidget(inner, 1)

        self.lbl_loading = QLabel("Ładowanie...")
        self.lbl_loading.setFont(QFont("Segoe UI", 10))
        self.lbl_loading.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_loading.setAlignment(Qt.AlignmentFlag.AlignCenter)
        il.addWidget(self.lbl_loading)

        self.stats_widget = QWidget(); self.stats_widget.setStyleSheet("background:transparent;")
        self.stats_widget.hide()
        self.stats_lay = QVBoxLayout(self.stats_widget); self.stats_lay.setSpacing(8); self.stats_lay.setContentsMargins(0,0,0,0)
        il.addWidget(self.stats_widget, 1)

        il.addWidget(_close_btn(self))

    def _stat_row(self, icon, label, value, color="rgba(220,235,255,220)"):
        row = QWidget(); row.setStyleSheet("""
            QWidget { background:rgba(30,32,60,140); border:1px solid rgba(80,85,120,80);
                border-radius:10px; }
        """)
        rl = QHBoxLayout(row); rl.setContentsMargins(14, 10, 14, 10); rl.setSpacing(10)
        li = QLabel(icon); li.setFont(QFont("Segoe UI Emoji", 18))
        li.setStyleSheet("background:transparent;"); li.setFixedWidth(28)
        li.setAlignment(Qt.AlignmentFlag.AlignCenter)
        txt = QVBoxLayout(); txt.setSpacing(1)
        ll = QLabel(label); ll.setFont(QFont("Segoe UI", 9))
        ll.setStyleSheet("color:rgba(160,175,210,180);background:transparent;")
        lv = QLabel(str(value)); lv.setFont(QFont("Segoe UI", 13, QFont.Weight.Bold))
        lv.setStyleSheet(f"color:{color};background:transparent;")
        txt.addWidget(ll); txt.addWidget(lv)
        rl.addWidget(li); rl.addLayout(txt, 1)
        return row

    def load(self):
        self.lbl_loading.show()
        self.stats_widget.hide()
        self._w = StatsWorker()
        self._w.done.connect(self._on_loaded)
        self._w.start()

    def _on_loaded(self, data):
        self.lbl_loading.hide()
        # Wyczyść poprzednie
        while self.stats_lay.count():
            item = self.stats_lay.takeAt(0)
            if item.widget(): item.widget().deleteLater()

        gold = data.get("gold", 0)
        cards = data.get("cards_seen", 0)
        minutes = data.get("minutes_active", 0)
        streak = data.get("streak_days", 0)
        sets_count = data.get("sets_count", 0)
        total_likes = data.get("total_likes", 0)
        is_premium = data.get("is_premium", False)
        premium_until = data.get("premium_until")
        username = data.get("username", "—")

        # Username
        un_row = QWidget(); un_row.setStyleSheet("background:rgba(201,106,42,30);border:1px solid rgba(201,106,42,100);border-radius:10px;")
        unl = QHBoxLayout(un_row); unl.setContentsMargins(14,10,14,10)
        unl_lbl = QLabel(f"👤  {username}")
        unl_lbl.setFont(QFont("Segoe UI", 13, QFont.Weight.Bold))
        unl_lbl.setStyleSheet("color:rgba(220,180,100,220);background:transparent;")
        unl.addWidget(unl_lbl)
        self.stats_lay.addWidget(un_row)

        # Premium status
        if is_premium and premium_until:
            from datetime import datetime
            try:
                until = datetime.fromisoformat(premium_until.replace("Z", "+00:00"))
                days_left = (until - datetime.now(until.tzinfo)).days
                prem_text = f"⭐ Premium · {days_left} dni"
                prem_color = "rgba(100,220,150,220)"
            except Exception:
                prem_text = "⭐ Premium"
                prem_color = "rgba(100,220,150,220)"
        else:
            prem_text = "🔒 Plan darmowy"
            prem_color = "rgba(160,175,210,180)"
        self.stats_lay.addWidget(self._stat_row("🏆", "Status konta", prem_text, prem_color))

        # Statystyki
        self.stats_lay.addWidget(self._stat_row("📚", "Poznane słowa", f"{cards:,}".replace(",", " ")))

        hours = minutes // 60
        mins = minutes % 60
        time_str = f"{hours}h {mins}min" if hours else f"{mins} min"
        self.stats_lay.addWidget(self._stat_row("⏱️", "Czas nauki", time_str))
        self.stats_lay.addWidget(self._stat_row("📂", "Twoje zestawy", f"{sets_count}"))
        self.stats_lay.addWidget(self._stat_row("❤️", "Łączne lajki", f"{total_likes}", "rgba(255,100,120,220)"))

        self.stats_lay.addStretch()
        self.stats_widget.show()

    def paintEvent(self, e):
        _paint_bg(self, e)


class SettingsWindow(_DraggableWindow):
    done  = pyqtSignal(int, bool)  # gold, is_premium
    error = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.finished.connect(self.deleteLater)

    def run(self):
        try:
            uid  = current_uid()
            resp = supabase.table("learning_stats").select("gold").eq("user_id", uid).execute()
            gold = resp.data[0]["gold"] if resp.data else 0
            resp2 = supabase.table("profiles").select("is_premium").eq("user_id", uid).execute()
            is_premium = resp2.data[0]["is_premium"] if resp2.data else False
            self.done.emit(gold, is_premium)
        except Exception as e:
            self.error.emit(str(e))


# ──────────────────────────────────────────────────────
# WORKER – dodawanie złota
# ──────────────────────────────────────────────────────
class AddGoldWorker(QThread):
    done = pyqtSignal(int)  # nowe łączne złoto

    def __init__(self, gold_cards, gold_minutes):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.gold_cards   = gold_cards
        self.gold_minutes = gold_minutes

    def run(self):
        try:
            resp = supabase.rpc("add_gold", {
                "p_gold_cards":   self.gold_cards,
                "p_gold_minutes": self.gold_minutes,
            }).execute()
            self.done.emit(resp.data or 0)
        except Exception as e:
            print(f"[GOLD] błąd: {e}")


# ──────────────────────────────────────────────────────
# WORKER – aktywacja kodu premium
# ──────────────────────────────────────────────────────
class ActivateCodeWorker(QThread):
    done  = pyqtSignal(bool, str)  # success, message
    def __init__(self, code):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.code = code

    def run(self):
        try:
            resp = supabase.rpc("activate_premium_code", {"p_code": self.code}).execute()
            result = resp.data
            self.done.emit(result["success"], result["message"])
        except Exception as e:
            self.done.emit(False, str(e))


# ──────────────────────────────────────────────────────
# OKNO KODU PREMIUM
# ──────────────────────────────────────────────────────
class PremiumCodeWindow(_DraggableWindow):
    activated = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(320, 280)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 28, 28, 28)
        lay.setSpacing(12)

        title = QLabel("🏆  Aktywuj Premium")
        title.setFont(QFont("Segoe UI", 14, QFont.Weight.Bold))
        title.setStyleSheet("color: white;")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(title)

        sub = QLabel("Wpisz kod aby odblokować wszystkie poziomy")
        sub.setFont(QFont("Segoe UI", 9))
        sub.setStyleSheet("color: rgba(200,210,255,160);")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub.setWordWrap(True)
        lay.addWidget(sub)

        lay.addSpacing(6)

        self.inp_code = QLineEdit()
        self.inp_code.setPlaceholderText("np. EYELINGO-VIP")
        self.inp_code.setStyleSheet(INPUT_STYLE)
        self.inp_code.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.inp_code.returnPressed.connect(self._activate)
        lay.addWidget(self.inp_code)

        self.lbl_msg = QLabel("")
        self.lbl_msg.setFont(QFont("Segoe UI", 9))
        self.lbl_msg.setStyleSheet("color: rgba(255,100,100,220);")
        self.lbl_msg.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_msg.setWordWrap(True)
        lay.addWidget(self.lbl_msg)

        self.btn = QPushButton("Aktywuj")
        self.btn.setStyleSheet(BTN_PRIMARY)
        self.btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn.clicked.connect(self._activate)
        lay.addWidget(self.btn)

        lay.addStretch()
        lay.addWidget(_close_btn(self))

    def _activate(self):
        code = self.inp_code.text().strip().upper()
        if not code:
            self.lbl_msg.setText("Wpisz kod.")
            return
        self.btn.setEnabled(False)
        self.btn.setText("Sprawdzanie...")
        self._worker = ActivateCodeWorker(code)
        self._worker.done.connect(self._on_done)
        self._worker.start()

    def _on_done(self, success, message):
        if success:
            self.lbl_msg.setStyleSheet("color: rgba(100,255,100,220); font-size:9px;")
            self.lbl_msg.setText("✅ " + message)
            QTimer.singleShot(1500, self.hide)
            self.activated.emit()
        else:
            self.lbl_msg.setStyleSheet("color: rgba(255,100,100,220); font-size:9px;")
            self.lbl_msg.setText("❌ " + message)
        self.btn.setEnabled(True)
        self.btn.setText("Aktywuj")

    def paintEvent(self, e):
        _paint_bg(self, e)


# ──────────────────────────────────────────────────────
# OKNO SKLEPU ZŁOTA
# ──────────────────────────────────────────────────────
LEVEL_COST = 7500

class CheckoutWorker(QThread):
    done  = pyqtSignal(str)
    error = pyqtSignal(str)

    def __init__(self, price_key, user_email):
        super().__init__()
        self.price_key  = price_key
        self.user_email = user_email

    def run(self):
        url = create_checkout_session(self.price_key, self.user_email)
        if url:
            self.done.emit(url)
        else:
            self.error.emit("Nie udało się połączyć z serwerem płatności.")


class PurchaseWindow(_DraggableWindow):
    """Okno wyboru metody zakupu: złoto / jednorazowo / subskrypcja."""
    purchased = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(360, 460)
        self._price_key  = ""
        self._user_email = ""
        self._gold       = 0
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Nagłówek
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("🔒  Odblokuj poziom")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        il = QVBoxLayout(inner); il.setContentsMargins(20, 12, 20, 16); il.setSpacing(8)

        self.lbl_info = QLabel("")
        self.lbl_info.setFont(QFont("Segoe UI", 10))
        self.lbl_info.setStyleSheet("color:rgba(180,200,255,180);background:transparent;")
        self.lbl_info.setAlignment(Qt.AlignmentFlag.AlignCenter)
        il.addWidget(self.lbl_info)

        sep = QWidget(); sep.setFixedHeight(1)
        sep.setStyleSheet("background:rgba(100,110,180,60);")
        il.addWidget(sep)
        il.addSpacing(4)

        def _sty(border_color, hover_color):
            return f"""
                QPushButton {{
                    background: rgba(30,32,60,160);
                    color: rgba(220,225,255,210);
                    border: 1px solid rgba(80,85,120,80);
                    border-left: 3px solid {border_color};
                    border-radius: 10px;
                    padding: 10px 16px;
                    font-size: 12px;
                    text-align: left;
                }}
                QPushButton:hover {{ background: {hover_color}; color: white; }}
                QPushButton:disabled {{
                    background: rgba(20,20,40,100);
                    color: rgba(120,125,145,100);
                    border-left: 3px solid rgba(80,80,100,60);
                }}
            """

        self.btn_once = QPushButton("💳  Kup jednorazowo  ·  19,99 zł")
        self.btn_once.setStyleSheet(_sty("rgba(80,140,230,220)", "rgba(30,50,90,180)"))
        self.btn_once.setFont(QFont("Segoe UI", 12))
        self.btn_once.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_once.clicked.connect(self._pay_once)
        il.addWidget(self.btn_once)

        self.btn_sub = QPushButton("⭐  Subskrypcja  ·  14,99 zł/mies")
        self.btn_sub.setStyleSheet(_sty("rgba(160,80,220,220)", "rgba(40,20,60,180)"))
        self.btn_sub.setFont(QFont("Segoe UI", 12))
        self.btn_sub.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_sub.clicked.connect(self._pay_sub)
        il.addWidget(self.btn_sub)

        self.lbl_msg = QLabel("")
        self.lbl_msg.setFont(QFont("Segoe UI", 9))
        self.lbl_msg.setStyleSheet("color:rgba(255,100,100,220);background:transparent;")
        self.lbl_msg.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_msg.setWordWrap(True)
        il.addWidget(self.lbl_msg)

        il.addSpacing(4)
        il.addWidget(_close_btn(self))
        lay.addWidget(inner, 1)

    def show_for(self, price_key, level_label, lang_label, gold, user_email):
        self._price_key  = price_key
        self._user_email = user_email
        self._gold       = gold
        parts = price_key.split("_")
        self._lang_code  = parts[0] if len(parts) >= 2 else ""
        self._lvl_code   = parts[1] if len(parts) >= 2 else ""
        self.lbl_info.setText(f"{lang_label}  ·  Poziom {level_label}")
        self.lbl_msg.setText("")
        self.lbl_msg.setStyleSheet("color:rgba(255,100,100,220);background:transparent;")
        self.show(); self.raise_(); self.activateWindow()

    def _pay_gold(self):
        if self._gold < 7500:
            self.lbl_msg.setText("Niewystarczająca ilość złota.")
            return
        try:
            uid = current_uid()
            # Pobierz levels_bought z profiles
            profile = supabase.from_("profiles").select("levels_bought").eq("user_id", uid).single().execute()
            current = profile.data.get("levels_bought") or []
            if isinstance(current, str):
                import json as _j; current = _j.loads(current)
            if not isinstance(current, list):
                current = []
            key = f"{self._lang_code}_{self._lvl_code}"
            if key not in current:
                current.append(key)
            new_gold = self._gold - 7500
            # Zapisz złoto do learning_stats
            supabase.from_("learning_stats").update({
                "gold": new_gold
            }).eq("user_id", uid).execute()
            # Zapisz levels_bought do profiles
            supabase.from_("profiles").update({
                "levels_bought": current,
                "updated_at": "now()"
            }).eq("user_id", uid).execute()
            self._gold = new_gold
            self.lbl_msg.setText(f"✅ Poziom {self._lvl_code} odblokowany!")
            self.lbl_msg.setStyleSheet("color:rgba(100,255,150,220);background:transparent;")
            self.purchased.emit()
            QTimer.singleShot(1200, self.hide)
        except Exception as e:
            self.lbl_msg.setText(f"Błąd: {e}")
            print(f"[PAY_GOLD] {e}")

    def _pay_once(self):
        self._start_checkout(self._price_key)

    def _pay_sub(self):
        self._start_checkout("premium_monthly")

    def _start_checkout(self, price_key):
        self.lbl_msg.setText("Łączenie z płatnościami...")
        self.lbl_msg.setStyleSheet("color:rgba(200,210,255,180);background:transparent;")
        self._worker = CheckoutWorker(price_key, self._user_email)
        self._worker.done.connect(self._on_checkout_url)
        self._worker.error.connect(lambda e: self.lbl_msg.setText(e))
        self._worker.start()

    def _on_checkout_url(self, url):
        self.lbl_msg.setText("Otwieranie przeglądarki...")
        webbrowser.open(url)
        QTimer.singleShot(2000, lambda: self.lbl_msg.setText(
            "Po dokonaniu płatności uruchom aplikację ponownie."))

    def paintEvent(self, e):
        _paint_bg(self, e)


class ShopWindow(_DraggableWindow):
    level_bought = pyqtSignal(str, int)
    go_back      = pyqtSignal()

    LEVELS = [
        ("A1", "Poziom A1", "Początkujący",        7500,  "🌱"),
        ("A2", "Poziom A2", "Podstawowy",           7500,  "🌿"),
        ("B1", "Poziom B1", "Średniozaawansowany",  7500,  "🌳"),
        ("B2", "Poziom B2", "Wyższy średni",        7500,  "🌲"),
        ("C1", "Poziom C1", "Zaawansowany",         7500,  "🏆"),
        ("C2", "Poziom C2", "Biegły",               7500,  "💎"),
    ]

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(400, 580)
        self._gold         = 0
        self._is_premium   = False
        self._levels_bought= []
        self._cur_lang     = "en"  # domyślnie angielski
        self._build()
        _right_third_pos(self)

    def _build(self):
        from PyQt6.QtWidgets import QScrollArea, QComboBox
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ── Nagłówek ──────────────────────────────────
        hdr = QWidget(); hdr.setFixedHeight(32)
        hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        lbl_title = QLabel("🏺  Sklep")
        lbl_title.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        lbl_title.setStyleSheet("color:white;background:transparent;")
        lbl_title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_gold = QLabel("🏺 0 złota")
        self.lbl_gold.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
        self.lbl_gold.setStyleSheet("color:rgba(255,215,0,255);background:transparent;")
        hl.addWidget(lbl_title, 1); hl.addWidget(self.lbl_gold)
        root.addWidget(hdr)

        # ── Wybór języka (dropdown) ────────────────────
        lang_w = QWidget(); lang_w.setStyleSheet("background:transparent;")
        lang_l = QVBoxLayout(lang_w); lang_l.setContentsMargins(16, 8, 16, 4); lang_l.setSpacing(6)

        lbl_choose = QLabel("Wybierz język:")
        lbl_choose.setFont(QFont("Segoe UI", 10))
        lbl_choose.setStyleSheet("color:rgba(180,200,255,200);background:transparent;")
        lang_l.addWidget(lbl_choose)

        self._lang_combo = QComboBox()
        self._lang_combo.setFont(QFont("Segoe UI", 11))
        self._lang_combo.setFixedHeight(36)
        self._lang_combo.setStyleSheet("""
            QComboBox {
                background: rgba(40,45,90,200);
                color: white;
                border: 1px solid rgba(100,110,200,150);
                border-radius: 10px;
                padding: 4px 12px;
            }
            QComboBox:hover { background: rgba(55,60,110,220); border-color: rgba(130,145,240,200); }
            QComboBox::drop-down { border: none; width: 24px; }
            QComboBox::down-arrow { image: none; }
            QComboBox QAbstractItemView {
                background: rgba(25,28,65,245);
                color: white;
                border: 1px solid rgba(100,110,200,150);
                border-radius: 8px;
                selection-background-color: rgba(80,100,200,200);
                padding: 4px;
            }
        """)
        for lang in LANGUAGES:
            if lang.get("available", True):
                self._lang_combo.addItem(f"{lang['flag']}  {lang['label']}", lang["code"])
            else:
                self._lang_combo.addItem(f"{lang['flag']}  {lang['label']}  🔜", lang["code"])
                idx = self._lang_combo.count() - 1
                self._lang_combo.model().item(idx).setEnabled(False)
                self._lang_combo.model().item(idx).setForeground(
                    __import__('PyQt6.QtGui', fromlist=['QColor']).QColor(120, 125, 145, 140)
                )
        self._lang_combo.currentIndexChanged.connect(self._on_combo_changed)
        # Domyślnie angielski
        for i in range(self._lang_combo.count()):
            if self._lang_combo.itemData(i) == "en":
                self._lang_combo.setCurrentIndex(i)
                break
        lang_l.addWidget(self._lang_combo)
        root.addWidget(lang_w)

        # Separator
        sep = QWidget(); sep.setFixedHeight(1)
        sep.setStyleSheet("background:rgba(100,110,180,60);")
        root.addWidget(sep)

        # ── Komunikat ─────────────────────────────────
        self.lbl_msg = QLabel("")
        self.lbl_msg.setFont(QFont("Segoe UI", 10))
        self.lbl_msg.setStyleSheet("color:rgba(200,220,255,200);margin:4px 16px;background:transparent;")
        self.lbl_msg.setWordWrap(True)
        root.addWidget(self.lbl_msg)

        # ── Scrollowalne poziomy ───────────────────────
        sa = QScrollArea(); sa.setWidgetResizable(True)
        sa.setStyleSheet("""
            QScrollArea{background:transparent;border:none;}
            QScrollBar:vertical{background:rgba(255,255,255,.04);width:5px;border-radius:2px;}
            QScrollBar::handle:vertical{background:rgba(255,255,255,.22);border-radius:2px;min-height:16px;}
            QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0;}
        """)
        self._levels_w = QWidget(); self._levels_w.setStyleSheet("background:transparent;")
        sa.setWidget(self._levels_w)
        root.addWidget(sa, 1)

        # Dolne przyciski
        bot = QWidget(); bot.setStyleSheet("background:transparent;")
        bl  = QHBoxLayout(bot); bl.setContentsMargins(12, 6, 12, 10); bl.setSpacing(8)
        btn_back = QPushButton("← Cofnij")
        btn_back.setFont(QFont("Segoe UI", 11))
        btn_back.setFixedHeight(34)
        btn_back.setStyleSheet(
            "QPushButton{background:rgba(60,60,90,200);color:white;"
            "border:1px solid rgba(100,110,180,100);border-radius:8px;padding:4px 14px;}"
            "QPushButton:hover{background:rgba(80,80,120,230);}")
        btn_back.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_back.clicked.connect(lambda: (self.hide(), self.go_back.emit()))
        bl.addWidget(btn_back)
        bl.addWidget(_close_btn(self))
        root.addWidget(bot)

        self._refresh_levels()

    def _on_combo_changed(self, idx):
        lang_code = self._lang_combo.itemData(idx)
        self._cur_lang = lang_code
        self._refresh_levels()

    def _update_lang_btns(self):
        pass  # nie używane przy combo

    def _refresh_levels(self):
        # Usuń stare widgety
        old_lay = self._levels_w.layout()
        if old_lay:
            while old_lay.count():
                item = old_lay.takeAt(0)
                if item.widget(): item.widget().deleteLater()
            QWidget().setLayout(old_lay)
        lay = QVBoxLayout(self._levels_w)
        lay.setContentsMargins(12, 8, 12, 12); lay.setSpacing(8)

        if not self._cur_lang:
            lbl = QLabel("← Wybierz język powyżej")
            lbl.setFont(QFont("Segoe UI", 11))
            lbl.setStyleSheet("color:rgba(180,200,255,160);")
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            lay.addStretch(); lay.addWidget(lbl); lay.addStretch()
            return

        lang_label_str = next((l["label"] for l in LANGUAGES if l["code"] == self._cur_lang), self._cur_lang)

        for code, name, desc, price, icon in self.LEVELS:
            key = f"{self._cur_lang}_{code}"
            bought = self._is_premium or key in self._levels_bought
            card = QWidget()
            card.setFixedHeight(76)
            card.setStyleSheet(
                "QWidget{background:rgba(30,100,50,160);border:1px solid rgba(80,200,120,100);"
                "border-radius:12px;}" if bought else
                "QWidget{background:rgba(30,35,70,180);border:1px solid rgba(80,90,150,80);"
                "border-radius:12px;}"
                "QWidget:hover{background:rgba(40,45,90,200);border-color:rgba(100,120,200,120);}"
            )
            cl = QHBoxLayout(card); cl.setContentsMargins(14, 8, 14, 8); cl.setSpacing(10)

            lbl_icon = QLabel(icon)
            lbl_icon.setFont(QFont("Segoe UI Emoji", 24))
            lbl_icon.setStyleSheet("background:transparent;")
            lbl_icon.setFixedWidth(40)
            lbl_icon.setAlignment(Qt.AlignmentFlag.AlignCenter)

            info = QVBoxLayout(); info.setSpacing(2)
            lbl_name = QLabel(f"{name}  ·  {lang_label_str}")
            lbl_name.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
            lbl_name.setStyleSheet("color:white;background:transparent;")
            lbl_desc = QLabel(desc)
            lbl_desc.setFont(QFont("Segoe UI", 9))
            lbl_desc.setStyleSheet("color:rgba(180,200,255,180);background:transparent;")
            info.addWidget(lbl_name); info.addWidget(lbl_desc)

            if bought:
                lbl_status = QLabel("✅  Zakupiony")
                lbl_status.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
                lbl_status.setStyleSheet("color:rgba(100,255,150,230);background:transparent;")
                cl.addWidget(lbl_icon); cl.addLayout(info, 1); cl.addWidget(lbl_status)
            elif price == 0:
                lbl_free = QLabel("🆓  Bezpłatny")
                lbl_free.setFont(QFont("Segoe UI", 10))
                lbl_free.setStyleSheet("color:rgba(255,215,0,200);background:transparent;")
                cl.addWidget(lbl_icon); cl.addLayout(info, 1); cl.addWidget(lbl_free)
            else:
                can_buy = self._gold >= price
                price_str = f"🏺 {price:,}".replace(",", " ")
                btn = QPushButton(price_str)
                btn.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
                btn.setFixedSize(110, 34)
                btn.setCursor(Qt.CursorShape.PointingHandCursor)
                if can_buy:
                    btn.setStyleSheet("QPushButton{background:rgba(50,130,200,220);color:white;"
                                      "border:1px solid rgba(100,180,255,150);border-radius:8px;}"
                                      "QPushButton:hover{background:rgba(70,160,230,240);}")
                else:
                    btn.setEnabled(False)
                    btn.setStyleSheet("QPushButton{background:rgba(50,50,70,150);color:rgba(180,180,200,120);"
                                      "border:1px solid rgba(80,80,100,80);border-radius:8px;}")
                btn.clicked.connect(lambda _, c=code: self._buy(c))
                cl.addWidget(lbl_icon); cl.addLayout(info, 1); cl.addWidget(btn)

            lay.addWidget(card)
        lay.addStretch()

    def _buy(self, level_code):
        price = next((p for c,_,_,p,_ in self.LEVELS if c == level_code), 0)
        if self._gold < price: return
        lang = self._cur_lang or "en"
        self._worker = BuyLevelWorker(lang, level_code)
        self._worker.done.connect(lambda ok, msg, gl: self._on_bought(ok, msg, gl, level_code))
        self._worker.start()

    def _on_bought(self, success, message, gold_left, level_code):
        self.lbl_msg.setStyleSheet(
            "color:rgba(100,255,150,220);margin:4px 16px;" if success
            else "color:rgba(255,100,100,220);margin:4px 16px;")
        self.lbl_msg.setText(message)
        if success:
            self._gold = gold_left
            self.lbl_gold.setText(f"🏺 {gold_left:,}".replace(",", " ") + " złota")
            key = f"{self._cur_lang}_{level_code}"
            if key not in self._levels_bought:
                self._levels_bought.append(key)
            self.level_bought.emit(self._cur_lang or "", gold_left)
            self._refresh_levels()

    def update_profile(self, gold, is_premium, levels_bought):
        self._gold          = gold
        self._is_premium    = is_premium
        self._levels_bought = levels_bought if isinstance(levels_bought, list) else []
        self.lbl_gold.setText(f"🏺 {gold:,}".replace(",", " ") + " złota")
        self._refresh_levels()

    def paintEvent(self, e):
        _paint_bg(self, e)


class SettingsWindow(_DraggableWindow):
    settings_changed = pyqtSignal(dict)
    go_back          = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(400, 560)
        self._recording   = None
        self._record_hook = None
        self._saved_state = {}
        self._build()
        _right_third_pos(self)

    # ── Budowa UI ───────────────────────────────────────
    def _build(self):
        from PyQt6.QtWidgets import QScrollArea, QCheckBox, QComboBox, QSlider

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # Pasek tytułu (= strefa drag)
        hdr = QLabel("⚙️  Ustawienia")
        hdr.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hdr.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        hdr.setStyleSheet("color:white; background:transparent; padding: 6px 0 2px 0;")
        hdr.setFixedHeight(32)
        root.addWidget(hdr)

        # Scrollowalna zawartość
        sa = QScrollArea(); sa.setWidgetResizable(True)
        sa.setStyleSheet("""
            QScrollArea{background:transparent;border:none;}
            QScrollBar:vertical{background:rgba(255,255,255,.04);width:5px;border-radius:2px;}
            QScrollBar::handle:vertical{background:rgba(255,255,255,.22);border-radius:2px;min-height:16px;}
            QScrollBar::add-line:vertical,QScrollBar::sub-line:vertical{height:0;}
        """)
        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        sa.setWidget(inner)
        root.addWidget(sa, 1)

        lay = QVBoxLayout(inner)
        lay.setContentsMargins(18, 6, 18, 10)
        lay.setSpacing(6)

        def sec(t):
            l = QLabel(t)
            l.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
            l.setStyleSheet("color:rgba(160,185,255,210);margin-top:6px;")
            lay.addWidget(l)

        # Wygląd
        sec("🎨  Wygląd")
        self.sl_op,  _ = self._mk_slider(lay,"Przezroczystość:", 30,100, int(APP_SETTINGS["opacity"]*100), "%")
        self.sl_txt, _ = self._mk_slider(lay,"Jasność tekstu:",  30,100, int(APP_SETTINGS["text_alpha"]/255*100), "%")

        # Czas
        sec("⏱️  Czas wyświetlania fiszki")
        self.sl_time,_ = self._mk_slider(lay,"Sekund:", 5,15, max(5,min(15,APP_SETTINGS.get("display_time",8))), "s")

        # Efekty
        sec("✨  Efekt wizualny")
        FX = [
            ("none",       "🚫  Brak"),
            ("flash_gold", "✨  Złoty błysk"),
            ("flash_red",  "🔴  Czerwony błysk"),
            ("flash_cyan", "🩵  Cyjanowy błysk"),
            ("flash_pink", "💗  Różowy błysk"),
            ("flash_lime", "💚  Limonkowy"),
            ("flash_blue", "🔵  Niebieski błysk"),
            ("glow_white", "⚪  Biały blask"),
            ("glow_orange","🟠  Pomarańcz"),
            ("glow_purple","🟣  Fiolet"),
            ("neon_green", "🟢  Neon zielony"),
            ("neon_blue",  "💙  Neon niebieski"),
            ("pulse",      "💓  Pulsowanie"),
            ("shake",      "💫  Drżenie"),
            ("rainbow",    "🌈  Tęcza"),
            ("zoom_in",    "🔍  Powiększenie"),
            ("zoom_out",   "🔎  Pomniejszenie"),
            ("typewriter", "⌨️   Maszyna"),
            ("bounce",     "🏀  Odbicie"),
            ("spin_color", "🎡  Obrót kolorów"),
            ("fire_text",  "🔥  Ognisty tekst"),
        ]
        self._fx_ids = [f[0] for f in FX]
        self._fx_cb  = QComboBox()
        self._fx_cb.setFont(QFont("Segoe UI",11))
        self._fx_cb.setFixedHeight(30)
        self._fx_cb.setStyleSheet("""
            QComboBox{background:rgba(40,50,110,200);color:white;
                border:1px solid rgba(100,130,220,150);border-radius:7px;padding:3px 10px;}
            QComboBox:hover{background:rgba(60,70,140,220);}
            QComboBox::drop-down{border:none;width:22px;}
            QComboBox::down-arrow{width:0;height:0;
                border-left:5px solid transparent;border-right:5px solid transparent;
                border-top:6px solid rgba(200,210,255,200);}
            QComboBox QAbstractItemView{background:rgba(25,28,65,245);color:white;
                selection-background-color:rgba(91,110,245,200);
                border:1px solid rgba(100,130,220,150);border-radius:6px;
                padding:2px;outline:none;}
        """)
        cur = APP_SETTINGS.get("card_effect","none")
        for fid,flbl in FX:
            self._fx_cb.addItem(flbl, fid)
        if cur in self._fx_ids:
            self._fx_cb.setCurrentIndex(self._fx_ids.index(cur))
        self._fx_cb.currentIndexChanged.connect(
            lambda i: self._on_fx(i))
        lay.addWidget(self._fx_cb)

        # Audio
        sec("🔊  Audio (TTS)")
        self.chk_audio = QCheckBox("Czytaj słówka głosem  (ALT+R)")
        self.chk_audio.setFont(QFont("Segoe UI",11))
        self.chk_audio.setStyleSheet("""
            QCheckBox{color:white;background:transparent;spacing:8px;}
            QCheckBox::indicator{width:18px;height:18px;border-radius:9px;
                border:2px solid rgba(100,120,220,200);background:rgba(40,40,80,180);}
            QCheckBox::indicator:checked{
                background:rgba(30,150,70,230);
                border-color:rgba(80,220,120,255);
                image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHBhdGggZD0iTTIgNkw1IDlMMTAgMyIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=);}
        """)
        self.chk_audio.setChecked(APP_SETTINGS.get("audio_enabled",False))
        if not _tts_available:
            self.chk_audio.setEnabled(False)
            self.chk_audio.setText("Audio niedostępne — pip install gtts playsound==1.2.2")
        lay.addWidget(self.chk_audio)

        # Skróty
        sec("⌨️  Skróty klawiszowe")
        hint = QLabel("Kliknij przycisk → naciśnij kombinację.  ✖ = wyłącz")
        hint.setStyleSheet("color:rgba(160,185,255,160);font-size:10px;")
        hint.setWordWrap(True)
        lay.addWidget(hint)

        self._hk_btns = {}
        for key, label in HOTKEY_LABELS.items():
            row = QHBoxLayout(); row.setSpacing(5)
            lb = QLabel(label); lb.setFont(QFont("Segoe UI",10))
            lb.setStyleSheet("color:white;"); lb.setFixedWidth(170)
            cur_hk = APP_SETTINGS["hotkeys"].get(key,"")
            btn = QPushButton(cur_hk or "wyłączony")
            btn.setFont(QFont("Segoe UI",10)); btn.setFixedWidth(115); btn.setFixedHeight(26)
            btn.setStyleSheet(self._hk_style(bool(cur_hk)))
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _,k=key: self._start_record(k))
            self._hk_btns[key] = btn
            bdel = QPushButton("✖"); bdel.setFixedSize(26,26)
            bdel.setFont(QFont("Segoe UI",10))
            bdel.setStyleSheet("QPushButton{background:rgba(130,35,35,200);color:white;"
                               "border:none;border-radius:5px;}"
                               "QPushButton:hover{background:rgba(180,55,55,220);}")
            bdel.setCursor(Qt.CursorShape.PointingHandCursor)
            bdel.clicked.connect(lambda _,k=key: self._disable_hk(k))
            row.addWidget(lb); row.addWidget(btn); row.addWidget(bdel); row.addStretch()
            lay.addLayout(row)

        lay.addStretch()

        # ── Pasek przycisków na dole ─────────────────────
        bar = QWidget()
        bar.setFixedHeight(52)
        bar.setStyleSheet("background:rgba(12,15,45,230);"
                          "border-top:1px solid rgba(100,110,180,70);")
        bl = QHBoxLayout(bar); bl.setContentsMargins(14,8,14,8); bl.setSpacing(6)

        def mkb(text, bg, hover, slot, bold=False):
            b = QPushButton(text)
            b.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold if bold else QFont.Weight.Normal))
            b.setFixedHeight(34)
            b.setStyleSheet(f"QPushButton{{background:{bg};color:white;"
                            f"border:1px solid rgba(255,255,255,30);border-radius:8px;padding:4px 8px;}}"
                            f"QPushButton:hover{{background:{hover};}}")
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.clicked.connect(slot)
            return b

        # Zapis=zielony, Cofnij=szary, Zamknij=czerwony, Domyślne=biały tekst
        btn_save  = mkb("💾  Zapisz",  "rgba(30,140,65,220)", "rgba(40,170,80,240)",  self._save,  True)
        btn_rev   = mkb("↩  Cofnij",   "rgba(70,72,85,210)",  "rgba(95,98,115,235)",  self._revert)
        btn_close = mkb("✕  Zamknij",  "rgba(175,38,38,220)", "rgba(215,52,52,240)",  self.hide)
        btn_def   = mkb("↺  Domyślne","rgba(48,52,78,210)",  "rgba(68,72,105,235)",  self._reset)

        bl.addWidget(btn_save)
        bl.addWidget(btn_rev)
        bl.addWidget(btn_close)
        bl.addWidget(btn_def)
        root.addWidget(bar)

    # ── Helpers ─────────────────────────────────────────
    def _mk_slider(self, lay, label, mn, mx, val, suffix):
        from PyQt6.QtWidgets import QSlider
        row = QHBoxLayout(); row.setSpacing(8)
        lb = QLabel(label); lb.setFont(QFont("Segoe UI",11))
        lb.setStyleSheet("color:white;"); lb.setFixedWidth(145)
        sl = QSlider(Qt.Orientation.Horizontal)
        sl.setMinimum(mn); sl.setMaximum(mx); sl.setValue(val)
        sl.setFixedHeight(22)
        sl.setStyleSheet("""
            QSlider::groove:horizontal{height:4px;background:rgba(100,120,220,100);border-radius:2px;}
            QSlider::handle:horizontal{width:13px;height:13px;margin:-5px 0;
                background:rgb(91,110,245);border-radius:6px;}
            QSlider::sub-page:horizontal{background:rgba(91,110,245,200);border-radius:2px;}
        """)
        vl = QLabel(f"{val}{suffix}")
        vl.setFont(QFont("Segoe UI",11,QFont.Weight.Bold))
        vl.setStyleSheet("color:rgba(255,215,0,255);"); vl.setFixedWidth(34)
        sl.valueChanged.connect(lambda v,l=vl,s=suffix: l.setText(f"{v}{s}"))
        row.addWidget(lb); row.addWidget(sl); row.addWidget(vl)
        lay.addLayout(row)
        return sl, vl

    def _hk_style(self, active):
        if active:
            return ("QPushButton{background:rgba(50,70,150,180);color:white;"
                    "border:1px solid rgba(100,130,220,120);border-radius:7px;padding:3px;font-size:10px;}"
                    "QPushButton:hover{background:rgba(70,100,190,220);}")
        return ("QPushButton{background:rgba(38,38,58,140);color:rgba(255,255,255,70);"
                "border:1px solid rgba(80,80,120,80);border-radius:7px;padding:3px;font-size:10px;}"
                "QPushButton:hover{background:rgba(58,58,88,180);}")

    def _on_fx(self, i):
        APP_SETTINGS["card_effect"] = self._fx_ids[i]

    def _start_record(self, key):
        # Anuluj poprzednie nagrywanie
        if self._recording:
            old_btn = self._hk_btns.get(self._recording)
            if old_btn:
                old_val = APP_SETTINGS["hotkeys"].get(self._recording, "")
                old_btn.setText(old_val or "wyłączony")
                old_btn.setStyleSheet(self._hk_style(bool(old_val)))
        self._recording = key
        btn = self._hk_btns[key]
        btn.setText("[ naciśnij kombinację… ]")
        btn.setStyleSheet("QPushButton{background:rgba(91,110,245,200);color:white;"
                          "border:2px solid rgba(140,160,255,255);border-radius:7px;"
                          "padding:3px;font-size:10px;}")
        # Ustaw focus na okno i zainstaluj event filter
        self.setFocus()
        self.grabKeyboard()

    def keyPressEvent(self, e):
        """Przechwytuj klawisze gdy nagrywamy skrót."""
        if self._recording is None:
            if e.key() == Qt.Key.Key_Escape:
                self.hide()
            return
        key_code = e.key()
        # Ignoruj same modyfikatory
        if key_code in (Qt.Key.Key_Alt, Qt.Key.Key_Control, Qt.Key.Key_Shift,
                        Qt.Key.Key_Meta, Qt.Key.Key_AltGr):
            return
        # Zbierz modyfikatory
        mods = []
        mod_flags = e.modifiers()
        if mod_flags & Qt.KeyboardModifier.AltModifier:     mods.append("alt")
        if mod_flags & Qt.KeyboardModifier.ControlModifier: mods.append("ctrl")
        if mod_flags & Qt.KeyboardModifier.ShiftModifier:   mods.append("shift")
        # Nazwa klawisza
        key_name = e.text().lower() if e.text() and e.text().isprintable() else ""
        if not key_name:
            seq = e.keyCombination().key()
            key_name = Qt.Key(seq).name.lower().replace("key_", "")
        combo = "+".join(mods + [key_name]) if mods else key_name
        if not combo:
            return
        rec_key = self._recording
        self._recording = None
        self.releaseKeyboard()
        APP_SETTINGS["hotkeys"][rec_key] = combo
        btn = self._hk_btns[rec_key]
        btn.setText(combo)
        btn.setStyleSheet(self._hk_style(True))

    def _on_key_event(self, event):
        pass  # nieużywane

    def _disable_hk(self, key):
        APP_SETTINGS["hotkeys"][key] = ""
        self._hk_btns[key].setText("wyłączony")
        self._hk_btns[key].setStyleSheet(self._hk_style(False))

    def _save(self):
        APP_SETTINGS["opacity"]       = self.sl_op.value()   / 100
        APP_SETTINGS["text_alpha"]    = int(self.sl_txt.value() / 100 * 255)
        APP_SETTINGS["display_time"]  = self.sl_time.value()
        APP_SETTINGS["audio_enabled"] = self.chk_audio.isChecked()
        save_settings(APP_SETTINGS)
        self.settings_changed.emit(APP_SETTINGS)
        # NIE zamyka okna

    def _revert(self):
        """Cofnij = wróć do okna wyboru języka."""
        self.hide()
        self.go_back.emit()

    def _reset(self):
        APP_SETTINGS.update({k: v for k, v in DEFAULT_SETTINGS.items() if k != "hotkeys"})
        APP_SETTINGS["hotkeys"] = dict(DEFAULT_SETTINGS["hotkeys"])
        self.sl_op.setValue(int(DEFAULT_SETTINGS["opacity"] * 100))
        self.sl_txt.setValue(int(DEFAULT_SETTINGS["text_alpha"] / 255 * 100))
        self.sl_time.setValue(DEFAULT_SETTINGS.get("display_time", 8))
        self.chk_audio.setChecked(False)
        self._fx_cb.setCurrentIndex(0)
        for key, btn in self._hk_btns.items():
            val = DEFAULT_SETTINGS["hotkeys"].get(key, "")
            btn.setText(val or "wyłączony")
            btn.setStyleSheet(self._hk_style(bool(val)))
        save_settings(APP_SETTINGS)
        self.settings_changed.emit(APP_SETTINGS)

    def paintEvent(self, e):
        _paint_bg(self, e)


def _similarity(a: str, b: str) -> float:
    """Podobieństwo ciągów 0-1, case-insensitive."""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b: return 1.0
    if not a or not b: return 0.0
    # Sekwencja wspólnych znaków (uproszczony SequenceMatcher)
    longer  = max(len(a), len(b))
    matches = sum(ca == cb for ca, cb in zip(a, b))
    # Bonus za wspólne podciągi
    common  = 0
    for i in range(len(a)):
        for j in range(len(b)):
            k = 0
            while i+k < len(a) and j+k < len(b) and a[i+k] == b[j+k]:
                k += 1
            common = max(common, k)
    return min(1.0, (matches + common) / (longer + 1))


class TestWindow(_DraggableWindow):
    test_done = pyqtSignal(list)

    def __init__(self):
        super().__init__()
        self.cards    = []
        self.index    = 0
        self.results  = []
        self.answered = False
        _styled_window(self)
        self.setFixedSize(440, 400)
        self._build()
        sc = QApplication.primaryScreen().availableGeometry()
        self.move(sc.center().x() - 220, sc.center().y() - 200)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag z tytułem i postępem
        hdr_w = QWidget(); hdr_w.setFixedHeight(32); hdr_w.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr_w); hl.setContentsMargins(16, 0, 16, 0)
        self.lbl_title = QLabel("📝  Test")
        self.lbl_title.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        self.lbl_title.setStyleSheet("color:white;background:transparent;")
        self.lbl_progress = QLabel("")
        self.lbl_progress.setFont(QFont("Segoe UI", 10))
        self.lbl_progress.setStyleSheet("color:rgba(200,210,255,180);background:transparent;")
        self.lbl_progress.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        hl.addWidget(self.lbl_title)
        hl.addWidget(self.lbl_progress)
        lay.addWidget(hdr_w)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        inner_lay = QVBoxLayout(inner)
        inner_lay.setContentsMargins(28, 16, 28, 24)
        inner_lay.setSpacing(14)
        lay.addWidget(inner, 1)

        self.lbl_question = QLabel("")
        self.lbl_question.setFont(QFont("Segoe UI", 22, QFont.Weight.Bold))
        self.lbl_question.setStyleSheet("color:white;background:transparent;")
        self.lbl_question.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_question.setWordWrap(True)
        inner_lay.addWidget(self.lbl_question)

        self.lbl_hint = QLabel("Wpisz tłumaczenie:")
        self.lbl_hint.setFont(QFont("Segoe UI", 9))
        self.lbl_hint.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner_lay.addWidget(self.lbl_hint)

        self.inp = QLineEdit()
        self.inp.setPlaceholderText("wpisz słówko...")
        self.inp.setStyleSheet(INPUT_STYLE)
        self.inp.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.inp.returnPressed.connect(self._check)
        inner_lay.addWidget(self.inp)

        self.lbl_feedback = QLabel("")
        self.lbl_feedback.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        self.lbl_feedback.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_feedback.setWordWrap(True)
        self.lbl_feedback.setStyleSheet("background:transparent;")
        inner_lay.addWidget(self.lbl_feedback)

        self.conf_widget = QWidget()
        self.conf_widget.setStyleSheet("background:transparent;")
        conf_lay = QHBoxLayout(self.conf_widget)
        conf_lay.setContentsMargins(0,0,0,0)
        conf_lay.setSpacing(8)
        self.btn_hard    = self._conf_btn("😓 Trudne",   "rgba(180,80,80,180)",  2)
        self.btn_ok      = self._conf_btn("🙂 Okej",     "rgba(180,140,40,180)", 3)
        self.btn_easy    = self._conf_btn("😊 Łatwe",    "rgba(50,140,80,180)",  4)
        self.btn_perfect = self._conf_btn("🌟 Idealnie", "rgba(40,100,180,180)", 5)
        for b in [self.btn_hard, self.btn_ok, self.btn_easy, self.btn_perfect]:
            conf_lay.addWidget(b)
        self.conf_widget.hide()
        inner_lay.addWidget(self.conf_widget)

        self.btn_check = QPushButton("Sprawdź →")
        self.btn_check.setStyleSheet(BTN_PRIMARY)
        self.btn_check.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_check.clicked.connect(self._check)
        inner_lay.addWidget(self.btn_check)
        inner_lay.addWidget(_close_btn(self))

    def _conf_btn(self, text, bg, quality):
        btn = QPushButton(text)
        btn.setStyleSheet(f"QPushButton {{ background:{bg}; color:white; border:none; border-radius:8px; padding:8px; font-size:12px; }} QPushButton:hover {{ opacity:0.85; }}")
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(lambda _, q=quality: self._rate(q))
        return btn

    def start_test(self, cards, n_review_from_other=0):
        # Deduplikacja
        seen = set()
        unique = []
        for c in cards:
            key = c.get("word", "")
            if key not in seen:
                seen.add(key); unique.append(c)
        self.cards = unique
        self.index = 0
        self.results = []
        self.progress_key = ""
        self.save_progress = None
        self.inp.show()
        self.lbl_hint.show()
        self.btn_check.show()
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self._check)
        self._show_question()
        if n_review_from_other > 0:
            self.lbl_feedback.setStyleSheet("color:rgba(255,200,80,220);")
            self.lbl_feedback.setText(f"ℹ️  Test zawiera {n_review_from_other} słów z poprzednich kategorii.")
            QTimer.singleShot(7000, lambda: self.lbl_feedback.setText("") if self.lbl_feedback.text().startswith("ℹ️") else None)
        self.show(); self.raise_(); self.activateWindow()

    def resume_test(self, saved):
        self.index = saved.get("index", 0)
        self.results = saved.get("results", [])
        self.inp.show(); self.lbl_hint.show(); self.btn_check.show()
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self._check)
        self.lbl_feedback.setStyleSheet("color:rgba(100,200,255,220);")
        self.lbl_feedback.setText("▶️  Wznawiasz poprzedni test...")
        QTimer.singleShot(2000, lambda: self.lbl_feedback.setText(""))
        self._show_question()
        self.show(); self.raise_(); self.activateWindow()

    def show_all_known(self):
        self.lbl_title.setText("🌟  Świetnie!")
        self.lbl_progress.setText("")
        self.lbl_question.setText("Wszystkie słowa znane!")
        self.lbl_hint.setText("Brak słów do powtórki.")
        self.lbl_feedback.setStyleSheet("color:rgba(100,255,150,220);")
        self.lbl_feedback.setText("System SRS nie znalazł słów wymagających powtórki.")
        self.inp.hide(); self.conf_widget.hide()
        self.btn_check.setText("Zamknij")
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self.hide)
        self.show(); self.raise_(); self.activateWindow()

    def _show_question(self):
        self.answered = False
        self.inp.clear(); self.inp.setEnabled(True)
        self.lbl_feedback.setText("")
        self.conf_widget.hide()
        self.btn_check.show()
        self.btn_check.setText("Sprawdź →")
        card = self.cards[self.index]
        self.lbl_title.setText("📝  Test")
        self.lbl_question.setText(card["translation"])
        self.lbl_progress.setText(f"{self.index + 1} / {len(self.cards)}")
        self.inp.setFocus()

    def _check(self):
        if self.answered: return
        answer = self.inp.text().strip()
        if not answer: return
        self.answered = True
        self.inp.setEnabled(False)
        card    = self.cards[self.index]
        correct = card["word"]
        # Obsługa wariantów (flat / apartment, flat (apartment))
        import re as _re
        variants = [v.strip() for v in _re.split(r'[/|]', correct)]
        variants += [_re.sub(r'[().]', '', v).strip() for v in variants]
        variants = [v for v in variants if v]
        best_sim = max(_similarity(answer, v) for v in variants)
        sim = best_sim
        if sim >= 0.85:
            self.lbl_feedback.setStyleSheet("color:rgba(100,255,150,230);")
            self.lbl_feedback.setText(f"✅  Dobrze!  ({correct})")
            self._auto_rate(4)
            QTimer.singleShot(400, self._next)
            return
        elif sim >= 0.6:
            self.lbl_feedback.setStyleSheet("color:rgba(255,200,50,230);")
            self.lbl_feedback.setText(f"〰️  Prawie!  Poprawnie: {correct}")
            self._auto_rate(3)
            QTimer.singleShot(1200, self._next)
        else:
            self.lbl_feedback.setStyleSheet("color:rgba(255,100,100,230);")
            self.lbl_feedback.setText(f"❌  Błąd.  Poprawnie: {correct}")
            self._auto_rate(1)
            QTimer.singleShot(1500, self._next)

    def _auto_rate(self, quality):
        self.results.append((self.cards[self.index].get("flashcard_id", 0), quality))
        self.btn_check.setText("Dalej →")
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self._next)

    def _show_rating(self):
        self.conf_widget.show()
        self.btn_check.hide()

    def _rate(self, quality):
        self.results.append((self.cards[self.index].get("flashcard_id", 0), quality))
        self.conf_widget.hide()
        self.btn_check.show()
        self.btn_check.setText("Dalej →")
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self._next)

    def _next(self):
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self._check)
        self.index += 1
        if self.save_progress:
            self.save_progress(self.index, list(self.results))
        if self.index >= len(self.cards):
            self._show_results()
        else:
            self._show_question()

    def _show_results(self):
        correct = sum(1 for _, q in self.results if q >= 3)
        total   = len(self.results)
        pct     = int(correct / total * 100) if total else 0
        emoji   = "🌟" if pct >= 90 else "😊" if pct >= 70 else "🙂" if pct >= 50 else "💪"
        self.lbl_title.setText("Wyniki testu")
        self.lbl_progress.setText("")
        self.lbl_question.setText(f"{emoji}  {correct} / {total}")
        self.lbl_hint.setText(f"{pct}% poprawnych odpowiedzi")
        self.lbl_feedback.setStyleSheet("color:rgba(200,210,255,180);")
        self.lbl_feedback.setText(
            "Perfekcyjnie!" if pct == 100 else
            "Świetnie! Trudne słowa pojawią się częściej." if pct >= 70 else
            "Nie przejmuj się! SRS zadba o powtórki."
        )
        self.inp.hide()
        self.conf_widget.hide()
        self.btn_check.setText("Zamknij")
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self.hide)
        self.test_done.emit(self.results)

    def paintEvent(self, e):
        _paint_bg(self, e)


class TestOfferWindow(QWidget):
    accepted = pyqtSignal()
    rejected = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(340, 210)
        self._cat_name = ""
        self._build()
        _right_third_pos(self)

    def show_for(self, cat_name):
        self._cat_name = cat_name
        self.lbl_sub.setText(f'Obejrzałeś kategorię\n"{cat_name}" 15 razy.\nChcesz sprawdzić swoją wiedzę?')
        self.show(); self.raise_(); self.activateWindow()

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 24, 24, 24)
        lay.setSpacing(12)

        title = QLabel("📝  Czas na test!")
        title.setFont(QFont("Segoe UI", 14, QFont.Weight.Bold))
        title.setStyleSheet("color:white;")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(title)

        self.lbl_sub = QLabel("")
        self.lbl_sub.setFont(QFont("Segoe UI", 10))
        self.lbl_sub.setStyleSheet("color:rgba(200,210,255,180);")
        self.lbl_sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(self.lbl_sub)

        btns = QHBoxLayout()
        btn_tak = QPushButton("✅  Tak!")
        btn_tak.setStyleSheet(BTN_PRIMARY)
        btn_tak.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_tak.clicked.connect(lambda: (self.hide(), self.accepted.emit()))

        btn_nie = QPushButton("Może później")
        btn_nie.setStyleSheet("QPushButton { background:rgba(60,60,100,160); color:rgba(200,210,255,200); border:1px solid rgba(100,110,180,100); border-radius:10px; padding:8px; } QPushButton:hover { background:rgba(80,80,130,200); }")
        btn_nie.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_nie.clicked.connect(lambda: (self.hide(), self.rejected.emit()))

        btns.addWidget(btn_tak)
        btns.addWidget(btn_nie)
        lay.addLayout(btns)

    def paintEvent(self, e):
        _paint_bg(self, e)

# ──────────────────────────────────────────────────────
# OKNO PROPOZYCJI TESTU SRS (przy zmianie kategorii)
# ──────────────────────────────────────────────────────
class SRSOfferWindow(_DraggableWindow):
    accepted  = pyqtSignal()
    rejected  = pyqtSignal()
    all_known = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(320, 290)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 24, 24, 24)
        lay.setSpacing(10)
        title = QLabel("💡  Wskazówka SRS")
        title.setFont(QFont("Segoe UI", 14, QFont.Weight.Bold))
        title.setStyleSheet("color: white;")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(title)
        msg = QLabel("System SRS działa najlepiej gdy zrobisz test przed zmianą kategorii.")
        msg.setFont(QFont("Segoe UI", 11))
        msg.setStyleSheet("color: rgba(200,210,255,200);")
        msg.setAlignment(Qt.AlignmentFlag.AlignCenter)
        msg.setWordWrap(True)
        lay.addWidget(msg)
        lay.addStretch()
        btn_test = QPushButton("📝  Zrób test teraz")
        btn_test.setStyleSheet(BTN_PRIMARY)
        btn_test.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        btn_test.setFixedHeight(44)
        btn_test.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_test.clicked.connect(lambda: (self.hide(), self.accepted.emit()))
        lay.addWidget(btn_test)
        btn_known = QPushButton("✅  Znam wszystkie słowa")
        btn_known.setFont(QFont("Segoe UI", 11))
        btn_known.setStyleSheet("QPushButton { background: rgba(40,120,60,180); color: white; border: 1px solid rgba(80,180,100,120); border-radius: 10px; padding: 8px; } QPushButton:hover { background: rgba(50,150,70,220); }")
        btn_known.setFixedHeight(40)
        btn_known.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_known.clicked.connect(lambda: (self.hide(), self.all_known.emit()))
        lay.addWidget(btn_known)
        btn_skip = QPushButton("➡️  Zmień bez testu")
        btn_skip.setFont(QFont("Segoe UI", 11))
        btn_skip.setStyleSheet("QPushButton { background: rgba(40,40,80,160); color: rgba(200,210,255,160); border: 1px solid rgba(100,110,180,80); border-radius: 10px; padding: 6px; } QPushButton:hover { background: rgba(60,60,110,200); }")
        btn_skip.setFixedHeight(36)
        btn_skip.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_skip.clicked.connect(lambda: (self.hide(), self.rejected.emit()))
        lay.addWidget(btn_skip)

    def keyPressEvent(self, e):
        if e.key() == Qt.Key.Key_Escape:
            self.hide(); self.rejected.emit()
        else:
            super().keyPressEvent(e)

    def paintEvent(self, e):
        _paint_bg(self, e)


# ──────────────────────────────────────────────────────
# OKNO WZNOWIENIA TESTU
# ──────────────────────────────────────────────────────
class ResumeTestWindow(_DraggableWindow):
    resume    = pyqtSignal()
    all_known = pyqtSignal()
    skip      = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(320, 280)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 24, 24, 24)
        lay.setSpacing(12)
        title = QLabel("📝  Niedokończony test")
        title.setFont(QFont("Segoe UI", 14, QFont.Weight.Bold))
        title.setStyleSheet("color: white;")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(title)
        msg = QLabel("Masz niedokończony test. Ukończ go aby SRS działał poprawnie.")
        msg.setFont(QFont("Segoe UI", 11))
        msg.setStyleSheet("color: rgba(200,210,255,200);")
        msg.setAlignment(Qt.AlignmentFlag.AlignCenter)
        msg.setWordWrap(True)
        lay.addWidget(msg)
        lay.addStretch()
        btn_resume = QPushButton("▶️  Dokończ test")
        btn_resume.setStyleSheet(BTN_PRIMARY)
        btn_resume.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        btn_resume.setFixedHeight(44)
        btn_resume.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_resume.clicked.connect(lambda: (self.hide(), self.resume.emit()))
        lay.addWidget(btn_resume)
        btn_known = QPushButton("✅  Znam wszystkie słowa")
        btn_known.setFont(QFont("Segoe UI", 11))
        btn_known.setStyleSheet("QPushButton { background: rgba(40,120,60,180); color: white; border: 1px solid rgba(80,180,100,120); border-radius: 10px; padding: 8px; } QPushButton:hover { background: rgba(50,150,70,220); }")
        btn_known.setFixedHeight(40)
        btn_known.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_known.clicked.connect(lambda: (self.hide(), self.all_known.emit()))
        lay.addWidget(btn_known)
        btn_skip = QPushButton("➡️  Pomiń")
        btn_skip.setFont(QFont("Segoe UI", 11))
        btn_skip.setStyleSheet("QPushButton { background: rgba(40,40,80,160); color: rgba(200,210,255,160); border: 1px solid rgba(100,110,180,80); border-radius: 10px; padding: 6px; } QPushButton:hover { background: rgba(60,60,110,200); }")
        btn_skip.setFixedHeight(36)
        btn_skip.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_skip.clicked.connect(lambda: (self.hide(), self.skip.emit()))
        lay.addWidget(btn_skip)

    def keyPressEvent(self, e):
        if e.key() == Qt.Key.Key_Escape:
            self.hide(); self.skip.emit()

    def paintEvent(self, e):
        _paint_bg(self, e)


def make_tray_icon() -> QIcon:
    """Tworzy ikonę tray z literą F na granatowym tle."""
    px = QPixmap(64, 64)
    px.fill(Qt.GlobalColor.transparent)
    from PyQt6.QtGui import QPainter as _P, QColor as _C, QFont as _F, QBrush as _B
    p = _P(px)
    p.setRenderHint(_P.RenderHint.Antialiasing)
    p.setBrush(_B(_C(26, 35, 64, 255)))
    p.setPen(Qt.PenStyle.NoPen)
    p.drawRoundedRect(0, 0, 64, 64, 14, 14)
    p.setPen(_C(255, 255, 255, 240))
    p.setFont(_F("Segoe UI", 36, _F.Weight.Bold))
    p.drawText(px.rect(), Qt.AlignmentFlag.AlignCenter, "F")
    p.end()
    return QIcon(px)


class TrayApp:
    def __init__(self, app, overlay, login_window):
        self.app          = app
        self.overlay      = overlay
        self.login_window = login_window
        self.visible      = True
        self._lang        = "en"
        self._lvl         = "A1"

        self.win_premium = PremiumCodeWindow()
        self.win_premium.activated.connect(self._on_premium_activated)
        self.win_shop    = ShopWindow()
        self.win_shop.level_bought.connect(self._on_level_bought)
        self.win_shop.go_back.connect(self._show_lang)
        self.win_settings = SettingsWindow()
        self.win_settings.settings_changed.connect(self._on_settings_changed)
        self.win_settings.go_back.connect(self._show_lang)
        self.win_stats = StatsWindow()
        self.win_test    = TestWindow()
        self.win_test.test_done.connect(self._on_test_done)
        self._test_progress   = {}
        self._done_categories = set()
        self._custom_sets_cache = []
        # Timer odświeżania JWT co 25 minut (token wygasa po 60min)
        self._jwt_timer = QTimer()
        self._jwt_timer.timeout.connect(self._refresh_jwt)
        self._jwt_timer.start(25 * 60 * 1000)
        self.win_srs_offer = SRSOfferWindow()
        self.win_srs_offer.accepted.connect(self._on_srs_offer_accept)
        self.win_srs_offer.rejected.connect(self._on_srs_offer_reject)
        self.win_srs_offer.all_known.connect(self._on_offer_all_known)
        self.win_resume    = ResumeTestWindow()
        self.win_resume.resume.connect(self._on_resume_test)
        self.win_resume.all_known.connect(self._on_all_known)
        self.win_resume.skip.connect(lambda: None)
        self.win_offer   = TestOfferWindow()
        self.win_offer.accepted.connect(self._start_test)
        self.win_offer.rejected.connect(lambda: None)
        self.win_lang    = LanguageWindow(self._on_lang)
        self.win_lvl     = LevelWindow(self._on_lvl, self._back_to_lang)
        self.win_lvl.open_purchase.connect(self._show_purchase)
        self.win_cat     = CategoryWindow(self._on_cat, self._back_to_lvl)
        self.win_purchase = PurchaseWindow()
        self.win_purchase.purchased.connect(self._on_purchase_done)
        self.win_my_sets = MySetsPicker(self._show_lang, self._show_custom_create, self._show_public_sets)
        self.win_custom  = CustomSetWindow(self._show_my_sets)
        self.win_public_sets = PublicSetsWindow()
        self.win_public_sets.set_imported.connect(self._show_my_sets)
        self.win_public_sets.set_back_callback(self._show_my_sets)
        self.win_custom.set_created.connect(self._on_custom_set_created)
        self.win_my_sets.set_picked.connect(self._on_custom_set_picked)

        self.tray = QSystemTrayIcon(make_tray_icon())
        self.tray.setToolTip("Fiszki w tle")

        menu = QMenu()
        menu.addAction("🌍  Zmień język / poziom / kategorię").triggered.connect(self._show_lang)
        menu.addAction("🏆  Aktywuj Premium").triggered.connect(self._show_premium)
        menu.addAction("📊  Statystyki").triggered.connect(self._show_stats)
        menu.addAction("📝  Zrób test").triggered.connect(self._start_test)
        menu.addAction("⚙️  Ustawienia").triggered.connect(lambda: (self.win_settings.show(), self.win_settings.raise_()))
        menu.addSeparator()
        self.act_toggle = menu.addAction("⏸  Ukryj fiszki")
        self.act_toggle.triggered.connect(self._toggle)
        menu.addSeparator()
        menu.addAction("🚪  Wyloguj").triggered.connect(self._logout)
        menu.addAction("✖  Zamknij").triggered.connect(self._quit)

        self.tray.setContextMenu(menu)
        self.tray.activated.connect(
            lambda r: self._show_lang() if r == QSystemTrayIcon.ActivationReason.Trigger else None
        )
        self.tray.show()

    def _show_lang(self):
        self.win_cat.hide(); self.win_lvl.hide()
        self.win_lang.show(); self.win_lang.raise_(); self.win_lang.activateWindow()

    def _show_subscription_required(self):
        """Pokaż okno informujące o wymogu subskrypcji."""
        msg = QMessageBox()
        msg.setWindowTitle("Funkcja Premium")
        msg.setText("✏️  Własne zestawy fiszek\n\nTa funkcja dostępna jest tylko w subskrypcji Premium.\n\n14,99 zł/mies · wszystkie poziomy + własne fiszki")
        msg.setIcon(QMessageBox.Icon.Information)
        btn_sub = msg.addButton("⭐ Kup subskrypcję", QMessageBox.ButtonRole.AcceptRole)
        msg.addButton("Zamknij", QMessageBox.ButtonRole.RejectRole)
        msg.exec()
        if msg.clickedButton() == btn_sub:
            self._show_purchase_subscription()

    def _show_purchase_subscription(self):
        """Otwórz okno zakupu subskrypcji."""
        try:
            user_email = current_email()
        except Exception:
            user_email = ""
        gold = getattr(self, '_gold', 0)
        self.win_purchase.show_for("premium_monthly", "Premium", "Subskrypcja", gold, user_email)

    def _on_lang(self, lang):
        if lang == "test":
            self.win_lang.hide()
            _session.track("test_started_from_menu")
            self._start_test()
            return
        if lang == "settings":
            _session.track("settings_opened")
            self.win_lang.hide()
            self.win_settings.show()
            self.win_settings.raise_()
            self.win_settings.activateWindow()
            return
        if lang == "shop":
            self.win_lang.hide()
            self.win_shop.show()
            self.win_shop.raise_()
            self.win_shop.activateWindow()
            return
        if lang == "my_sets":
            self.win_lang.hide()
            self._show_my_sets()
            return
        if lang == "create":
            self.win_lang.hide()
            self._show_custom_create_or_limit()
            return
        if lang == "custom":
            self.win_lang.hide()
            self._show_my_sets()
            return
        self._lang = lang
        self.win_lang.hide()
        self.win_lvl.set_language(lang)
        self.win_lvl.show(); self.win_lvl.raise_(); self.win_lvl.activateWindow()

    def _on_lvl(self, lang, lvl):
        self._lvl = lvl
        self.win_lvl.hide()
        self.win_cat.set_context(lang, lvl)
        self.win_cat.set_premium(
            getattr(self, '_is_premium', False),
            getattr(self, '_levels_bought', [])
        )
        load_categories(lang, lvl)
        self.win_cat._rebuild_grid()
        QTimer.singleShot(200, lambda: self._load_completed_cats(lang))
        self.win_cat.show(); self.win_cat.raise_(); self.win_cat.activateWindow()

    def _on_cat(self, lang, lvl, cat):
        self.overlay.load_from_supabase(lang, lvl, cat)
        self._track_views(lang, lvl, cat)
        _session.track("category_selected", {
            "language": lang, "level": lvl, "category": cat
        })

    def _track_views(self, lang, lvl, cat):
        self._view_worker = CategoryViewWorker(lang, lvl, cat)
        self._view_worker.done.connect(lambda count: self._check_test_offer(count, cat))
        self._view_worker.start()

    def _check_test_offer(self, count, cat):
        if count == 15:
            self.win_offer.show_for(cat)

    def _start_test(self):
        # Własny zestaw
        if getattr(self.overlay, "_is_custom", False):
            cards = self.overlay.cards
            if not cards: return
            import random
            test_cards = [{"flashcard_id": c.get("flashcard_id", i),
                           "word": c["word"], "translation": c["translation"],
                           "romaji": c.get("romaji", ""), "status": "unknown",
                           "from_cat": self.overlay.cat}
                          for i, c in enumerate(cards)]
            random.shuffle(test_cards)
            self.win_test.start_test(test_cards)
            return
        lang  = self.overlay.lang or "en"
        level = self.overlay.level or "A1"
        cat   = self.overlay.cat or ""
        if not cat: return
        # Sprawdź postęp
        saved = self._test_progress.get(f"{lang}_{level}_{cat}")
        if saved:
            self.win_test.resume_test(saved); return
        # Smart słowa
        self._test_cards_worker = TestCardsWorker(lang, level, cat)
        self._test_cards_worker.done.connect(lambda cards: self._launch_test(cards, lang, level, cat))
        self._test_cards_worker.start()

    def _launch_test(self, cards, lang, level, cat):
        if not cards:
            self.win_test.show_all_known(); return
        n_review = sum(1 for c in cards if c.get("from_cat") != cat)
        self.win_test.start_test(cards, n_review_from_other=n_review)
        key = f"{lang}_{level}_{cat}"
        self.win_test.progress_key = key
        self.win_test.save_progress = lambda idx, results: self._save_test_progress(key, idx, results)

    def _on_test_done(self, results):
        if results:
            self._srs_worker = SRSUpdateWorker(results)
            self._srs_worker.start()
            correct = sum(1 for _, q in results if q >= 3)
            _session.track("test_completed", {
                "total":    len(results), "correct": correct,
                "score_pct": int(correct / len(results) * 100) if results else 0,
                "language": self.overlay.lang, "category": self.overlay.cat,
            })
        # Próg 80%
        correct = sum(1 for _, q in results if q >= 3) if results else 0
        total   = len(results) if results else 0
        pct     = int(correct / total * 100) if total > 0 else 0
        cat = self.overlay.cat; lang = self.overlay.lang or "en"; level = self.overlay.level or "A1"
        key = f"{lang}_{level}_{cat}" if cat else ""
        self._clear_test_progress(key)
        if pct >= 80:
            if cat:
                self._done_categories.add(key)
                self.win_cat.mark_done(cat)
            if getattr(self, "_pending_test_then_nav", False):
                self._pending_test_then_nav = False
                QTimer.singleShot(500, lambda: self._do_nav_category(
                    getattr(self, "_pending_nav_direction", 1)))
        else:
            # < 80% - usuń dobrze znane z rotacji
            known_ids = {fid for fid, q in results if q >= 4}
            if known_ids and cat:
                QTimer.singleShot(500, lambda: self._reload_cat_without_known(lang, level, cat, known_ids))
        # Odśwież licznik poznanych słów
        QTimer.singleShot(2000, lambda: self._load_completed_cats(lang))
        self._kw2 = KnownWordsWorker(lang, level, cat)
        self._kw2.done.connect(self.overlay.set_known_words)
        QTimer.singleShot(2100, self._kw2.start)

    def _show_premium(self):
        self.win_premium.show()
        self.win_premium.raise_()
        self.win_premium.activateWindow()

    def _show_shop(self):
        self.win_shop.show()
        self.win_shop.raise_()
        self.win_shop.activateWindow()

    def _show_stats(self):
        self.win_stats.load()
        self.win_stats.show()
        self.win_stats.raise_()
        self.win_stats.activateWindow()

    def _on_level_bought(self, level_code, gold_left):
        # Odśwież profil po chwili
        QTimer.singleShot(1500, self.load_user_stats)

    def _on_premium_activated(self):
        """Po aktywacji kodu — odśwież pełny profil z bazy."""
        self._load_profile()


    def load_user_stats(self):
        """Wczytaj pełny profil gracza."""
        self._profile_worker = ProfileWorker()
        self._profile_worker.done.connect(self._on_profile_loaded)
        self._profile_worker.start()

    def _on_profile_loaded(self, profile):
        gold          = profile.get("gold", 0)
        is_premium    = profile.get("is_premium", False)
        levels_bought = profile.get("levels_bought", []) or []
        # Upewnij się że to lista
        if isinstance(levels_bought, str):
            try:
                levels_bought = json.loads(levels_bought)
            except Exception:
                levels_bought = []
        if not isinstance(levels_bought, list):
            levels_bought = []
        streak        = profile.get("streak_days", 0)
        self._gold          = gold
        self._is_premium    = is_premium
        self._levels_bought = levels_bought
        lang  = self.overlay.lang or "en"
        level = self.overlay.level or "A1"
        cat   = self.overlay.cat or None
        self._known_worker = KnownWordsWorker(lang, level, cat)
        self._known_worker.done.connect(self.overlay.set_known_words)
        self._known_worker.start()
        self._load_completed_cats(self.overlay.lang or "en")
        self.win_lvl.set_premium(is_premium)
        self.win_lvl.set_bought_levels(levels_bought)
        self.win_cat.set_premium(is_premium, levels_bought)
        self.win_shop.update_profile(gold, is_premium, levels_bought)

    def _load_profile(self):
        """Odśwież profil użytkownika po zakupie."""
        self._profile_worker = ProfileWorker()
        self._profile_worker.done.connect(self._on_profile_loaded)
        self._profile_worker.start()

    def _show_shop_from_cat(self):
        """Otwórz sklep gdy użytkownik klika zablokowaną kategorię."""
        self.win_cat.hide()
        self.win_shop.show()
        self.win_shop.raise_()
        self.win_shop.activateWindow()

    def _show_purchase(self, price_key: str):
        """Otwórz okno zakupu dla konkretnego poziomu."""
        lang_code = self.win_lvl.current_lang
        lvl_code  = price_key.split("_")[1] if "_" in price_key else price_key
        lang_label_str = next((l["label"] for l in LANGUAGES if l["code"] == lang_code), lang_code)
        gold = self._gold if hasattr(self, "_gold") else 0
        try:
            user_email = current_email()
        except Exception:
            user_email = ""
        self.win_purchase.show_for(price_key, lvl_code, lang_label_str, gold, user_email)

    def _on_purchase_done(self):
        """Po zakupie złotem — odśwież profil i poziomy."""
        def _refresh_after_load(profile):
            gold          = profile.get("gold", 0)
            is_premium    = profile.get("is_premium", False)
            levels_bought = profile.get("levels_bought", []) or []
            self._gold          = gold
            self._is_premium    = is_premium
            self._levels_bought = levels_bought
            self.win_lvl.set_premium(is_premium)
            self.win_lvl.set_bought_levels(levels_bought)
            self.win_shop.update_profile(gold, is_premium, levels_bought)

        self._refresh_worker = ProfileWorker()
        self._refresh_worker.done.connect(_refresh_after_load)
        self._refresh_worker.start()

    def _refresh_jwt(self):
        """Odśwież token JWT żeby nie wygasł."""
        self._jwt_worker = TokenRefreshWorker()
        self._jwt_worker.refreshed.connect(lambda: print("[JWT] Token odświeżony"))
        self._jwt_worker.failed.connect(self._on_jwt_failed)
        self._jwt_worker.start()

    def _on_jwt_failed(self):
        """Token wygasł i nie da się odświeżyć - wyloguj."""
        print("[JWT] Sesja wygasła, wylogowuję...")
        try:
            supabase.auth.sign_out()
        except Exception:
            pass
        clear_session()
        self.overlay.hide()
        self.login_window.reset()
        self.login_window.show()
        self.login_window.raise_()
        self.login_window.activateWindow()

    def _restart_timer(self):
        ms = int(APP_SETTINGS.get("display_time", 8) * 1000)
        self.overlay.timer.stop()
        self.overlay.timer.start(ms)

    def _on_settings_changed(self, s):
        """Zastosuj nowe ustawienia wyglądu i skrótów."""
        _session.track("settings_saved", {
            "opacity":    s["opacity"],
            "text_alpha": s["text_alpha"],
        })
        # przezroczystość
        self.overlay.setWindowOpacity(s["opacity"])
        # jasność tekstu - wpływa na słówko, romaji i tłumaczenie
        alpha = int(s["text_alpha"])
        self.overlay.lbl_word.setStyleSheet(f"color:rgba(255,255,255,{alpha});")
        self.overlay.lbl_romaji.setStyleSheet(f"color:rgba(255,255,255,{alpha});")
        self.overlay.lbl_tr.setStyleSheet(f"color:rgba(200,220,255,{int(alpha*0.87)});")
        self.overlay.lbl_info.setStyleSheet(f"color:rgba(180,200,255,{int(alpha*0.75)});")
        # przeładuj skróty - unhook_all + setup na nowo
        try:
            keyboard.unhook_all()
        except Exception:
            pass
        setup_hotkeys(self.app, self)
        self._restart_timer()

    def _show_my_sets(self):
        self.win_my_sets.set_premium(getattr(self, '_is_premium', False))
        self.win_custom.hide()
        self.win_my_sets.load_sets()
        self.win_my_sets.show(); self.win_my_sets.raise_(); self.win_my_sets.activateWindow()

    def _show_custom_create_or_limit(self):
        """Pokaż okno tworzenia zestawu lub limit info."""
        is_premium = getattr(self, '_is_premium', False)
        # Sprawdź ile zestawów ma użytkownik
        try:
            uid = current_uid()
            resp = supabase.from_("user_sets").select("id").eq("user_id", uid).execute()
            count = len(resp.data) if resp.data else 0
        except Exception:
            count = 0
        if not is_premium and count >= 1:
            # Pokaż MySetsPicker z info o limicie
            self._show_my_sets()
        else:
            self.win_my_sets.hide()
            self.win_custom.show()
            self.win_custom.raise_()
            self.win_custom.activateWindow()

    def _show_public_sets(self):
        self.win_public_sets.set_premium(getattr(self, '_is_premium', False))
        self.win_my_sets.hide()
        self.win_public_sets.show_and_load()

    def _show_custom_create(self):
        self.win_my_sets.hide()
        self.win_custom.set_premium(getattr(self, '_is_premium', False))
        self.win_custom.show(); self.win_custom.raise_(); self.win_custom.activateWindow()

    def _on_custom_set_created(self, name, cards):
        self.overlay.load_custom(name, cards)


    def _on_custom_set_picked(self, name, cards):
        self.overlay.load_custom(name, cards)
        self._custom_sets_cache = self.win_my_sets.sets if hasattr(self.win_my_sets, 'sets') else []

    def _back_to_lang(self):
        self._show_lang()

    def _back_to_lvl(self):
        self.win_cat.hide()
        self.win_lvl.set_language(self._lang)
        self.win_lvl.show(); self.win_lvl.raise_(); self.win_lvl.activateWindow()

    def _toggle(self):
        if self.visible:
            self.overlay.hide()
            self.act_toggle.setText("▶  Pokaż fiszki")
            _session.slides_stopped()
            _session.track("slides_hidden")
        else:
            self.overlay.show()
            self.act_toggle.setText("⏸  Ukryj fiszki")
            if self.overlay.cat:
                _session.slides_started(self.overlay.lang, self.overlay.level, self.overlay.cat)
            _session.track("slides_shown")
        self.visible = not self.visible

    def next_card_now(self):
        """ALT+N – następna fiszka od razu."""
        self.overlay._next()
        self.overlay.timer.start(INTERVAL_MS)
        _session.track("hotkey_used", {"hotkey": "alt+n", "action": "next_card"})

    def toggle_pause(self):
        """ALT+P – pauza / wznów."""
        if self.overlay.timer.isActive():
            self.overlay.timer.stop()
            _session.track("hotkey_used", {"hotkey": "alt+p", "action": "pause"})
        else:
            self.overlay.timer.start(INTERVAL_MS)
            _session.track("hotkey_used", {"hotkey": "alt+p", "action": "resume"})


    def _nav_category(self, direction):
        """Zmień kategorię — z propozycją testu SRS."""
        _session.track("hotkey_used", {
            "hotkey": "alt+right" if direction > 0 else "alt+left",
            "action": "category_change"
        })
        # Własne zestawy - przełączaj swobodnie
        if getattr(self.overlay, "_is_custom", False):
            self._do_nav_category(direction); return
        if self.overlay.cards and self.overlay.cat:
            self._pending_nav_direction = direction
            lang  = self.overlay.lang or "en"
            level = self.overlay.level or "A1"
            cat   = self.overlay.cat
            key   = f"{lang}_{level}_{cat}"
            # Cofanie - bez pytania
            if direction < 0:
                self._do_nav_category(direction); return
            # Zaliczona - bez pytania
            if key in self._done_categories:
                self._do_nav_category(direction); return
            # Niedokończony test
            if key in self._test_progress:
                self._pending_resume_key = key
                self.win_resume.show(); self.win_resume.raise_()
                self.win_resume.activateWindow(); return
            # Propozycja testu
            self.win_srs_offer.show(); self.win_srs_offer.raise_()
            self.win_srs_offer.activateWindow(); return
        self._do_nav_category(direction)

    def _do_nav_category(self, direction):
        if getattr(self.overlay, "_is_custom", False):
            self._nav_custom_set(direction); return
        cats = [c["code"] for c in CATEGORIES]
        cur  = self.overlay.cat
        lang = self.overlay.lang or "en"
        lvl  = self.overlay.level or "A1"
        if not cur: return
        try: idx = cats.index(cur)
        except ValueError: idx = 0
        new_cat = cats[(idx + direction) % len(cats)]
        self.overlay.load_from_supabase(lang, lvl, new_cat)

    def _nav_custom_set(self, direction):
        sets = self._custom_sets_cache
        if not sets: return
        current = self.overlay.cat
        names = [s.get("name", "")[:15] for s in sets]
        try: idx = names.index(current)
        except ValueError: idx = 0
        new_idx = (idx + direction) % len(sets)
        s = sets[new_idx]
        self._nav_set_worker = LoadSetCardsWorker(s["id"])
        self._nav_set_worker.done.connect(
            lambda cards, n=s.get("name", "Zestaw"): self.overlay.load_custom(n, cards)
        )
        self._nav_set_worker.start()

    def _on_srs_offer_accept(self):
        self._pending_test_then_nav = True
        self._start_test()

    def _on_srs_offer_reject(self):
        self._do_nav_category(self._pending_nav_direction)

    def _on_offer_all_known(self):
        cat = self.overlay.cat; lang = self.overlay.lang or "en"; level = self.overlay.level or "A1"
        if cat:
            key = f"{lang}_{level}_{cat}"
            self._done_categories.add(key)
            self.win_cat.mark_done(cat)
            self._mark_worker = MarkAllKnownWorker(lang, level, cat)
            self._mark_worker.done.connect(lambda: self._load_completed_cats(lang))
            self._mark_worker.start()
        self._do_nav_category(self._pending_nav_direction)

    def _on_resume_test(self):
        key = getattr(self, "_pending_resume_key", "")
        saved = self._test_progress.get(key)
        if saved: self.win_test.resume_test(saved)
        else: self._start_test()

    def _on_all_known(self):
        key = getattr(self, "_pending_resume_key", "")
        self._test_progress.pop(key, None)
        cat = self.overlay.cat; lang = self.overlay.lang or "en"; level = self.overlay.level or "A1"
        if cat:
            self._done_categories.add(f"{lang}_{level}_{cat}")
            self.win_cat.mark_done(cat)
            self._mark_worker2 = MarkAllKnownWorker(lang, level, cat)
            self._mark_worker2.done.connect(lambda: self._load_completed_cats(lang))
            self._mark_worker2.start()
        self._do_nav_category(self._pending_nav_direction)

    def _load_completed_cats(self, lang):
        self._comp_worker = CompletedCatsWorker(lang)
        self._comp_worker.done.connect(self._on_completed_cats)
        self._comp_worker.start()

    def _on_completed_cats(self, codes):
        lang  = self.overlay.lang or "en"
        level = self.overlay.level or "A1"
        for code in codes:
            key = f"{lang}_{level}_{code}"
            self._done_categories.add(key)
            self.win_cat.mark_done(code)

    def _save_test_progress(self, key, idx, results):
        self._test_progress[key] = {"index": idx, "results": results}

    def _clear_test_progress(self, key):
        self._test_progress.pop(key, None)

    def _read_current_card(self):
        """ALT+R — toggle audio."""
        enabled = not APP_SETTINGS.get("audio_enabled", False)
        APP_SETTINGS["audio_enabled"] = enabled
        save_settings(APP_SETTINGS)
        if hasattr(self.win_settings, 'chk_audio'):
            self.win_settings.chk_audio.setChecked(enabled)
        if enabled:
            self.overlay.lbl_info.setText("🔊  Audio włączone")
            if self.overlay.cards:
                card = self.overlay.cards[self.overlay.index]
                word = card.get("word", "")
                lang = self.overlay.lang or "en"
                if lang == "jp" and "(" in word:
                    word = word.split("(")[0].strip()
                speak_word(word, lang)
        else:
            self.overlay.lbl_info.setText("🔇  Audio wyłączone")
        QTimer.singleShot(2000, lambda: self.overlay._update())

    def _reload_cat_without_known(self, lang, level, cat, known_ids):
        if not self.overlay.cards: return
        filtered = [c for c in self.overlay.cards if c.get("flashcard_id", 0) not in known_ids]
        if filtered:
            self.overlay.cards = filtered
            self.overlay.index = 0
            self.overlay._update()


    def next_category(self):
        self._nav_category(+1)

    def prev_category(self):
        self._nav_category(-1)

    def next_language(self):
        """ALT+↓ – następny język."""
        langs = [l["code"] for l in LANGUAGES]
        try:
            idx = langs.index(self.overlay.lang)
            next_lang = langs[(idx + 1) % len(langs)]
        except ValueError:
            next_lang = langs[0]
        self._on_lang(next_lang)


    def prev_language(self):
        """ALT+↑ – poprzedni język."""
        langs = [l["code"] for l in LANGUAGES]
        try:
            idx = langs.index(self.overlay.lang)
            prev_lang = langs[(idx - 1) % len(langs)]
        except ValueError:
            prev_lang = langs[-1]
        self._on_lang(prev_lang)


    def _logout(self):
        clear_session()
        try:
            supabase.auth.sign_out()
        except Exception:
            pass
        self.overlay.hide()
        # Ukryj wszystkie okna
        for w in [self.win_lang, self.win_lvl, self.win_cat,
                  self.win_settings, self.win_shop, self.win_custom]:
            try:
                w.hide()
            except Exception:
                pass
        # Reset okna logowania i pokaż je
        self.login_window.reset()
        self.login_window.show()
        self.login_window.raise_()
        self.login_window.activateWindow()


    def _quit(self):
        _session.on_app_close()
        self.tray.hide()
        self.app.quit()



# ──────────────────────────────────────────────────────
# GLOBALNE SKRÓTY KLAWISZOWE (biblioteka keyboard)
# ──────────────────────────────────────────────────────
import keyboard
from PyQt6.QtCore import pyqtSignal, QObject

class HotkeySignals(QObject):
    """Sygnały Qt wyzwalane z wątku keyboard — bezpieczne przejście między wątkami."""
    next_cat  = pyqtSignal()
    prev_cat  = pyqtSignal()
    toggle    = pyqtSignal()
    pause     = pyqtSignal()
    show_sel   = pyqtSignal()
    start_test    = pyqtSignal()
    show_settings = pyqtSignal()
    read_card     = pyqtSignal()

_hotkey_signals = HotkeySignals()

def setup_hotkeys(app_ref, tray_ref):
    """Rejestruje globalne skróty – działają zawsze, nawet w innym oknie."""
    s = _hotkey_signals
    # Rozłącz stare połączenia żeby nie nakładały się przy przeładowaniu
    for sig in [s.next_cat, s.prev_cat,
                s.toggle, s.pause, s.show_sel,
                s.start_test, s.show_settings, s.read_card]:
        try: sig.disconnect()
        except Exception: pass
    s.next_cat.connect(tray_ref.next_category)
    s.prev_cat.connect(tray_ref.prev_category)
    s.toggle.connect(tray_ref._toggle)
    s.pause.connect(tray_ref.toggle_pause)
    s.show_sel.connect(tray_ref._show_lang)
    s.start_test.connect(tray_ref._start_test)
    s.show_settings.connect(lambda: (tray_ref.win_settings.show(), tray_ref.win_settings.raise_()))
    s.read_card.connect(tray_ref._read_current_card)

    hk = APP_SETTINGS["hotkeys"]
    signal_map = {
        "next_cat":     s.next_cat,
        "prev_cat":     s.prev_cat,
        "toggle":       s.toggle,
        "pause":        s.pause,
        "show_sel":     s.show_sel,
        "start_test":   s.start_test,
        "show_settings":s.show_settings,
        "read_card":    s.read_card,
    }
    for key, sig in signal_map.items():
        combo = hk.get(key, "")
        if combo:
            try:
                keyboard.add_hotkey(combo, lambda sg=sig: sg.emit())
            except Exception as e:
                print(f"[HOTKEY] błąd dla {combo}: {e}")

# ──────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────
def main():
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)

    overlay      = FlashcardOverlay()
    overlay.hide()
    login_window = LoginWindow()

    def on_logged_in(_session):
        tray.load_user_stats()
        try:
            import json, pathlib
            _last = pathlib.Path.home() / ".eyelingo_last.json"
            if _last.exists():
                data = json.loads(_last.read_text(encoding="utf-8"))
                lang = data.get("lang", "en")
                level = data.get("level", "A1")
                cat = data.get("cat", "")
                if cat:
                    QTimer.singleShot(800, lambda: (
                        load_categories(lang, level),
                        overlay.load_from_supabase(lang, level, cat),
                    ))
        except Exception:
            pass

    login_window.logged_in.connect(on_logged_in)
    tray = TrayApp(app, overlay, login_window)
    setup_hotkeys(overlay, tray)

    def show_login():
        if OnboardingWindow.should_show():
            onboarding = OnboardingWindow()
            onboarding.finished.connect(lambda: (login_window.show(), login_window.raise_()))
            onboarding.show()
        else:
            login_window.show()

    if try_restore_session():
        try:
            user = current_user()
            if user:
                ph_identify(user.id, user.email)
                ph_capture("app_opened", {"session": "restored"})
        except Exception:
            pass
        on_logged_in(None)
    else:
        ph_capture("app_opened", {"session": "new"})
        show_login()
        overlay.hide()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()

    