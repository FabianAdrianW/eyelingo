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
    QMenu, QPushButton, QGridLayout, QMessageBox, QHBoxLayout, QCheckBox
)
from PyQt6.QtCore import Qt, QTimer, QThread, pyqtSignal
from PyQt6.QtGui import QFont, QColor, QIcon, QPixmap, QPainter, QBrush, QPen

import os
import threading
from dotenv import load_dotenv


# ── Bootstrap platformy (cross-platform) — MUSI wykonać się przed QApplication ──
def _bootstrap_platform():
    """Ustawienia środowiska zależne od OS, wymagane zanim powstanie QApplication."""
    import platform as _pf
    if _pf.system() == "Linux":
        # Natywny Wayland blokuje arbitralne pozycjonowanie okna nakładki → wymuś XWayland (xcb),
        # o ile użytkownik nie nadpisał QT_QPA_PLATFORM ręcznie.
        _sess = (os.environ.get("XDG_SESSION_TYPE", "") or "").lower()
        _wayland = (_sess == "wayland") or bool(os.environ.get("WAYLAND_DISPLAY"))
        if _wayland and not os.environ.get("QT_QPA_PLATFORM"):
            os.environ["QT_QPA_PLATFORM"] = "xcb"

_bootstrap_platform()

# ── TTS (gTTS + Qt Multimedia) ──────────────────────
# PAK-1: w spakowanej aplikacji NIE MA pip ani zapisywalnego site-packages, więc
#        auto-instalacja zależności w runtime musiała zniknąć (wieszała start).
# PAK-2: playsound 1.2.2 jest martwy (nie działa na macOS/Py3.12, nie pakuje się
#        czysto). Odtwarzanie idzie teraz przez QtMultimedia — część PyQt6,
#        zero dodatkowych zależności, działa na Windows i macOS.
_tts_available = False
_gTTS = None
try:
    from gtts import gTTS as _gTTS_imp
    _gTTS = _gTTS_imp
    _tts_available = True
except Exception as _e_tts:
    print(f"[TTS] Synteza mowy niedostępna ({_e_tts}). Aplikacja działa dalej, bez audio.")

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
    "en": "en", "es": "es", "de": "de", "fr": "fr", "it": "it",
    "nl": "nl", "pt": "pt", "no": "no", "ru": "ru", "uk": "uk",
    "ar": "ar", "jp": "ja", "zh": "zh-CN", "ko": "ko",
}

# Jezyki o pismie nielatynskim — pokazujemy transliteracje (kolumna romaji), tak jak w japonskim
NON_LATIN_LANGS = {"jp", "zh", "ko", "ar", "ru", "uk"}

# Odtwarzacz musi żyć w wątku GUI (Qt), a pobranie MP3 z gTTS to sieć — więc
# rozdzielamy: wątek roboczy pobiera plik, sygnał wraca na główny wątek, ten gra.
from PyQt6.QtCore import QObject as _QObject, QUrl as _QUrl

_tts_bridge   = None
_tts_player   = None
_tts_audioout = None
_tts_tmp      = []


class _TTSBridge(_QObject):
    ready = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.ready.connect(self._play)

    def _play(self, path):
        global _tts_player, _tts_audioout, _tts_tmp
        # Sprzątanie poprzednich plików tymczasowych (nie kasujemy tego, co gra teraz)
        for old_p in _tts_tmp[:-1]:
            try:
                os.unlink(old_p)
            except Exception:
                pass
        _tts_tmp = _tts_tmp[-1:]
        try:
            from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput
            if _tts_player is None:
                _tts_player   = QMediaPlayer()
                _tts_audioout = QAudioOutput()
                _tts_player.setAudioOutput(_tts_audioout)
            _tts_audioout.setVolume(1.0)
            _tts_player.setSource(_QUrl.fromLocalFile(path))
            _tts_player.play()
            _tts_tmp.append(path)
        except Exception as e:
            print(f"[TTS] odtwarzanie: {e}")
            try:
                os.unlink(path)
            except Exception:
                pass


def speak_word(word, lang_code):
    """Czytaj słowo: gTTS (wątek) → QMediaPlayer (wątek GUI)."""
    if not _tts_available or not _gTTS:
        return
    try:
        if not APP_SETTINGS.get("audio_enabled", False):
            return
    except Exception:
        pass
    global _tts_bridge
    if _tts_bridge is None:
        _tts_bridge = _TTSBridge()
    bridge = _tts_bridge
    import threading, tempfile

    def _fetch():
        try:
            tts_lang = LANG_TTS_MAP.get(lang_code, "en")
            tts = _gTTS(text=word, lang=tts_lang, slow=False)
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
                tmp = f.name
            tts.save(tmp)
            bridge.ready.emit(tmp)
        except Exception as e:
            print(f"[TTS] {e}")

    threading.Thread(target=_fetch, daemon=True).start()
from supabase import create_client, Client

def _resource_path(rel):
    """Ścieżka do zasobu — działa też w spakowanej aplikacji (PyInstaller _MEIPASS)."""
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, rel)

_env_path = _resource_path(".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path)
else:
    load_dotenv()

# ── ANALITYKA FIRST-PARTY (Supabase, region UE) — zastępuje PostHog (audyt 2.4) ──
import threading as _an_threading
_ph_user_id = None   # id użytkownika (ustawiany po zalogowaniu)
_an_token = None     # access_token do auth.uid() w RPC
_an_sid = None       # identyfikator sesji

# mapowanie zdarzeń desktopu na kanon wspólnego panelu (cross-surface)
_AN_ALIAS = {
    "app_opened": "session_start",
    "test_completed": "review_session_completed",
}

def _an_ensure_sid():
    global _an_sid
    if not _an_sid:
        import uuid as _uuid
        _an_sid = _uuid.uuid4().hex
    return _an_sid

def ph_identify(user_id: str, email: str):
    global _ph_user_id
    _ph_user_id = user_id

def _an_send(batch):
    try:
        url = SUPABASE_URL.rstrip("/") + "/rest/v1/rpc/track_events"
        tok = _an_token or SUPABASE_KEY
        body = json.dumps({"p_batch": batch}).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("apikey", SUPABASE_KEY)
        req.add_header("Authorization", "Bearer " + (tok or ""))
        with urllib.request.urlopen(req, timeout=10) as _r:
            _r.read()
    except Exception:
        pass

def ph_capture(event: str, props: dict = None):
    if not _ph_user_id:
        return
    try:
        sid = _an_ensure_sid()
        batch = [{"event": event, "props": props or {}, "surface": "desktop", "session": sid}]
        alias = _AN_ALIAS.get(event)
        if alias:
            batch.append({"event": alias, "props": props or {}, "surface": "desktop", "session": sid})
        _an_threading.Thread(target=_an_send, args=(batch,), daemon=True).start()
    except Exception:
        pass

# ───────────────────────────────────────────────────

# PAK-3: użytkownik końcowy nie dostanie (ani nie utrzyma) pliku .env obok exe.
# Klucz anon jest PUBLICZNY z założenia — ten sam leży jawnie w index.html na
# GitHub Pages, chroni go RLS. Wbudowujemy go jako fallback, żeby paczka po prostu
# działała. .env nadal nadpisuje wartości (tryb dev / inny projekt).
DEFAULT_SUPABASE_URL = "https://sntlgkhktscezxpxrchl.supabase.co"
DEFAULT_SUPABASE_KEY = "sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8"

SUPABASE_URL = os.getenv("SUPABASE_URL") or DEFAULT_SUPABASE_URL
SUPABASE_KEY = os.getenv("SUPABASE_KEY") or DEFAULT_SUPABASE_KEY

try:
    from supabase.lib.client_options import ClientOptions as _ClientOptions
    # Bibliteczny auto-refresh odpala się w tle i rywalizuje z naszym
    # (try_restore_session / timer JWT / current_user) o JEDNORAZOWY rotujący
    # refresh_token -> przy starcie z przywróconej sesji jeden wątek unieważnia
    # sesję ('Sesja wygasła', premium=FREE, zestawy nie ładują się do re-logowania).
    # Wyłączamy go i zostawiamy wyłącznie nasze, zserializowane odświeżanie.
    supabase: Client = create_client(
        SUPABASE_URL, SUPABASE_KEY,
        options=_ClientOptions(auto_refresh_token=False),
    )
except Exception:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ══════════════════════════════════════════════════════════════════
# KANONICZNY SRS — srs_progress (wspólne źródło web + mobile + desktop)
# Logic Bible: srs_progress jest kanoniczne; word_progress jest legacy (desktop).
# Desktop CZYTA z srs_progress, a PISZE do obu (word_progress zostaje, bo karmi
# serwerowe RPC get_due_cards_all / get_completed_categories).
# Klucz karty i formuła SM-2 są IDENTYCZNE jak w index.html (sm2Local/usrsRecord),
# inaczej ten sam wyraz rozjechałby się między powierzchniami.
# ══════════════════════════════════════════════════════════════════
_SRS_SCRIPT_RANGES = {
    "jp": [(0x3040, 0x30FF), (0x4E00, 0x9FFF)],
    "zh": [(0x4E00, 0x9FFF)],
    "ko": [(0xAC00, 0xD7AF), (0x1100, 0x11FF)],
    "ar": [(0x0600, 0x06FF), (0x0750, 0x077F)],
    "ru": [(0x0400, 0x04FF)],
    "uk": [(0x0400, 0x04FF)],
}


def _srs_norm_lang(code):
    c = str(code or "").strip().lower()
    if c == "ja":
        return "jp"          # kanoniczny kod japońskiego = 'jp'
    return c


def _srs_true_lang(word, lang):
    """Pismo ma ostatnie słowo (Logic Bible §9.9). UI nigdy nie ustala języka —
    ustala go treść karty i baza. Puste, gdy nie wiadomo (nigdy nie zgadujemy)."""
    lang = _srs_norm_lang(lang)
    txt = str(word or "")
    for code, ranges in _SRS_SCRIPT_RANGES.items():
        if code in ("ru", "uk") and lang in ("ru", "uk"):
            continue         # cyrylica nie rozstrzyga między ru a uk — zostaw deklarację
        for ch in txt:
            o = ord(ch)
            for lo, hi in ranges:
                if lo <= o <= hi:
                    if code == "zh" and lang == "jp":
                        return "jp"   # kanji w japońskim to nadal japoński
                    return code
    return lang


def _srs_card_key(word, translation):
    return (str(word or "").strip().lower() + "|" +
            str(translation or "").strip().lower())


def _srs_sm2(prev, quality):
    """SM-2 — 1:1 z sm2Local() z index.html."""
    from datetime import date, timedelta
    ef       = (prev or {}).get("ease_factor") or 2.5
    reps     = (prev or {}).get("repetitions") or 0
    interval = (prev or {}).get("interval_days") or 1
    if quality >= 3:
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 3
        else:
            interval = int(round(interval * ef))
        reps += 1
    else:
        reps = 0
        interval = 1
    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if ef < 1.3:
        ef = 1.3
    return {
        "ease_factor":   round(float(ef), 3),
        "repetitions":   reps,
        "interval_days": interval,
        "next_review":   (date.today() + timedelta(days=interval)).isoformat(),
    }


def srs_upsert(card, quality):
    """Zapis oceny do kanonicznego srs_progress. `card` musi mieć word+translation."""
    try:
        word = str(card.get("word") or "").strip()
        tr   = str(card.get("translation") or "").strip()
        if not word or not tr:
            return           # karta jednostronna = niepowtarzalna (parytet z web)
        uid = current_uid()
        if not uid:
            return
        key = _srs_card_key(word, tr)
        fid = card.get("flashcard_id") or card.get("id") or None
        lang = _srs_true_lang(word, card.get("lang"))

        prev = {}
        try:
            r = (supabase.table("srs_progress")
                 .select("ease_factor,repetitions,interval_days")
                 .eq("user_id", uid).eq("card_key", key).limit(1).execute())
            if r.data:
                prev = r.data[0]
        except Exception:
            prev = {}

        new = _srs_sm2(prev, quality)
        row = {
            "user_id": uid, "card_key": key, "word": word, "translation": tr,
            "lang": lang, "source": ("eyelingo" if fid else "custom"),
            "flashcard_id": fid,
            "ease_factor":   new["ease_factor"],
            "repetitions":   new["repetitions"],
            "interval_days": new["interval_days"],
            "next_review":   new["next_review"],
        }
        supabase.table("srs_progress").upsert(row, on_conflict="user_id,card_key").execute()
    except Exception as e:
        print(f"[SRS] srs_progress: {e}")


def srs_declare_seen(card):
    """Deklaracja „znam to" — stan WIDZIANE, nie mastery (Pedagogy Bible D1).
    Siła musi zostać pod progiem opanowania, żeby wymóg odtwarzania z pamięci ocalał."""
    try:
        word = str(card.get("word") or "").strip()
        tr   = str(card.get("translation") or "").strip()
        if not word or not tr:
            return
        uid = current_uid()
        if not uid:
            return
        from datetime import date, timedelta
        fid  = card.get("flashcard_id") or card.get("id") or None
        lang = _srs_true_lang(word, card.get("lang"))
        supabase.table("srs_progress").upsert({
            "user_id": uid, "card_key": _srs_card_key(word, tr),
            "word": word, "translation": tr, "lang": lang,
            "source": ("eyelingo" if fid else "custom"), "flashcard_id": fid,
            "ease_factor": 2.5, "repetitions": 1, "interval_days": 7,
            "next_review": (date.today() + timedelta(days=7)).isoformat(),
        }, on_conflict="user_id,card_key").execute()
    except Exception as e:
        print(f"[SRS] deklaracja: {e}")


import time as _time_dbg
# Audyt bezp. DESK-2: log debugowy WYŁĄCZONY domyślnie (w produkcji rósłby u użytkownika
# i mógłby zawierać dane diagnostyczne). Włącz świadomie: EYELINGO_DEBUG=1
try:
    if os.getenv("EYELINGO_DEBUG") == "1":
        import pathlib as _pl_dbg
        _DBG_LOG = str(_pl_dbg.Path.home() / ".eyelingo_debug.log")
    else:
        _DBG_LOG = None
except Exception:
    _DBG_LOG = None

def _dbg_reset():
    if _DBG_LOG:
        try:
            open(_DBG_LOG, "w", encoding="utf-8").close()
        except Exception:
            pass

def _dbg(msg):
    line = f"{_time_dbg.strftime('%H:%M:%S')} {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    if _DBG_LOG:
        try:
            with open(_DBG_LOG, "a", encoding="utf-8") as _f:
                _f.write(line + "\n")
        except Exception:
            pass

_last_synced_token = None

def _sync_postgrest_token(token=None):
    """Wymuś access_token na kliencie PostgREST/RPC — wersjo-odpornie.
    supabase.auth.set_session()/refresh_session() nie zawsze aktualizują nagłówek
    Authorization dla zapytań do tabel/RPC. Bez tego po restarcie auth.uid() jest
    NULL → RLS blokuje → premium=FREE, materiały się nie ładują. Ustawiamy nagłówek
    na wszystkich wariantach struktury klienta i logujemy wynik do konsoli."""
    global _last_synced_token, _an_token
    try:
        if not token:
            cur = supabase.auth.get_session()
            token = getattr(cur, "access_token", None) or \
                    getattr(getattr(cur, "session", None), "access_token", None)
        if not token:
            if _last_synced_token != "NONE":
                _dbg("[TOKEN] brak access_token do synchronizacji")
                _last_synced_token = "NONE"
            return
        hdr = f"Bearer {token}"
        _an_token = token
        done = []
        pg = getattr(supabase, "postgrest", None)
        # a) oficjalne API postgrest-py
        try:
            if pg is not None:
                pg.auth(token); done.append("postgrest.auth")
        except Exception as e:
            _dbg(f"[TOKEN] postgrest.auth blad: {e}")
        # b) bezpośrednio na sesji HTTP klienta postgrest (różne wersje trzymają ją inaczej)
        if pg is not None:
            for attr in ("session", "_session"):
                s = getattr(pg, attr, None)
                try:
                    if s is not None and hasattr(s, "headers"):
                        s.headers["Authorization"] = hdr; done.append(f"postgrest.{attr}.headers")
                except Exception:
                    pass
            try:
                h = getattr(pg, "headers", None)
                if h is not None:
                    h["Authorization"] = hdr; done.append("postgrest.headers")
            except Exception:
                pass
        # c) domyślne nagłówki całego klienta — dziedziczone przez nowo budowane zapytania
        try:
            opts = getattr(supabase, "options", None)
            oh = getattr(opts, "headers", None) if opts is not None else None
            if oh is not None:
                oh["Authorization"] = hdr; done.append("options.headers")
        except Exception:
            pass
        if token != _last_synced_token:
            _dbg(f"[TOKEN] ustawiono na: {done or 'NIC'}  tok=<ustawiony>")  # audyt bezp. DESK-2: nie logujemy fragmentu sekretu
            _last_synced_token = token
    except Exception as e:
        _dbg(f"[TOKEN] wyjatek: {e}")

_refresh_lock = threading.Lock()

def _refresh_and_sync():
    """Zserializowane odświeżenie JWT.
    Rotujący refresh_token jest jednorazowy — bez locka równoległe
    wątki (timer JWT, FetchWorker, current_user) unieważniają sesję
    ('Sesja wygasła'). Po odświeżeniu persystujemy nową sesję i
    synchronizujemy token postgrest (inaczej zapytania do tabel/RPC
    lecą starym tokenem → RLS blokuje → premium czyta się jako FREE).
    Zwraca True, gdy sesja jest ważna po operacji."""
    with _refresh_lock:
        try:
            resp = supabase.auth.refresh_session()
            sess = getattr(resp, "session", None) or resp
            if sess is None or not getattr(sess, "access_token", None):
                cur = supabase.auth.get_session()
                sess = getattr(cur, "session", cur)
            if sess and getattr(sess, "access_token", None):
                try:
                    save_session(sess)   # persystuje rotowany refresh_token + syncuje postgrest
                except Exception:
                    _sync_postgrest_token(getattr(sess, "access_token", None))
                return True
        except Exception as e:
            _dbg(f"[JWT] refresh_and_sync: {e}")
        return False

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
    try:
        at = getattr(session, "access_token", None)
        rt = getattr(session, "refresh_token", None)
        if not at or not rt:
            _dbg(f"[SESSION] save_session: BRAK tokenow (at={bool(at)}, rt={bool(rt)}) — nie zapisuje")
        else:
            with open(SESSION_FILE, "w", encoding="utf-8") as _f:
                json.dump({"access_token": at, "refresh_token": rt}, _f)
            _dbg(f"[SESSION] save_session: zapisano -> {SESSION_FILE}")
    except Exception as _e:
        _dbg(f"[SESSION] save_session blad: {_e}")
    try:
        _sync_postgrest_token(getattr(session, "access_token", None))
    except Exception:
        pass

def load_session():
    try:
        if not SESSION_FILE.exists():
            _dbg(f"[SESSION] load_session: plik NIE istnieje ({SESSION_FILE})")
            return None
        with open(SESSION_FILE, encoding="utf-8") as _f:
            data = json.load(_f)
        _dbg("[SESSION] load_session: wczytano plik OK")
        return data
    except Exception as _e:
        _dbg(f"[SESSION] load_session blad: {_e}")
        return None

def clear_session():
    try:
        if SESSION_FILE.exists():
            SESSION_FILE.unlink()
            _dbg("[SESSION] clear_session: USUNIETO plik sesji")
    except Exception as _e:
        _dbg(f"[SESSION] clear_session blad: {_e}")

def try_restore_session() -> bool:
    saved = load_session()
    _dbg(f"[SESSION] try_restore: saved={'TAK' if saved else 'NIE'}")
    if not saved:
        return False
    try:
        # 1) set_session sam odświeży wygasły access_token przez refresh_token.
        #    Nie zużywamy rotującego tokenu ręcznie z góry (podwójne użycie = "session missing").
        try:
            supabase.auth.set_session(saved["access_token"], saved["refresh_token"])
            _dbg("[SESSION] set_session(saved): OK")
        except Exception as _e:
            _dbg(f"[SESSION] set_session(saved) blad: {_e}")
        # 2) Pobierz aktualną sesję z klienta
        sess = None
        try:
            cur = supabase.auth.get_session()
            sess = getattr(cur, "session", None) or cur
        except Exception as _e:
            _dbg(f"[SESSION] get_session blad: {_e}")
        # 3) Dopiero gdy brak sesji/tokenu — jawny refresh (raz)
        if not (sess and getattr(sess, "access_token", None)):
            try:
                resp = supabase.auth.refresh_session(saved["refresh_token"])
                sess = getattr(resp, "session", None) or resp
                _dbg(f"[SESSION] refresh_session(token): sess={'TAK' if sess else 'NIE'}")
            except Exception as _e:
                _dbg(f"[SESSION] refresh_session(token) blad: {_e}")
        if sess and getattr(sess, "access_token", None):
            _rt = getattr(sess, "refresh_token", None) or saved["refresh_token"]
            try:
                supabase.auth.set_session(sess.access_token, _rt)
            except Exception as _e:
                _dbg(f"[SESSION] set_session(fresh) blad: {_e}")
            save_session(sess)
            _sync_postgrest_token(getattr(sess, "access_token", None))
            u = current_user()
            _dbg(f"[SESSION] try_restore: user={'TAK' if u else 'NIE'}")
            if u is not None:
                _dbg("[SESSION] try_restore: OK — sesja przywrocona")
                return True
        else:
            _dbg("[SESSION] try_restore: brak sesji po set/refresh")
    except Exception as _e:
        _dbg(f"[SESSION] try_restore: wyjatek: {_e}")
    _dbg("[SESSION] try_restore: NIEUDANE — czyszcze sesje")
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
            _sync_postgrest_token()   # postgrest zawsze na aktualnym tokenie sesji
            return resp.user
    except Exception:
        pass
    if _refresh_and_sync():
        try:
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
    {"code": "de", "label": "Niemiecki",    "flag": "🇩🇪", "available": True},
    {"code": "fr", "label": "Francuski",    "flag": "🇫🇷", "available": True},
    {"code": "it", "label": "Włoski",       "flag": "🇮🇹", "available": True},
    {"code": "pt", "label": "Portugalski",  "flag": "🇵🇹", "available": True},
    {"code": "ru", "label": "Rosyjski",     "flag": "🇷🇺", "available": True},
    {"code": "uk", "label": "Ukraiński",    "flag": "🇺🇦", "available": True},
    {"code": "zh", "label": "Chiński",      "flag": "🇨🇳", "available": True},
    {"code": "ko", "label": "Koreański",    "flag": "🇰🇷", "available": True},
    {"code": "ar", "label": "Arabski",      "flag": "🇸🇦", "available": True},
    {"code": "no", "label": "Norweski",     "flag": "🇳🇴", "available": True},
]
LEVELS = [
    {"code": "A1", "label": "A1", "desc": "Początkujący",        "free": True},
    {"code": "A2", "label": "A2", "desc": "Podstawowy",          "free": False},
    {"code": "B1", "label": "B1", "desc": "Średniozaawansowany", "free": False},
    {"code": "B2", "label": "B2", "desc": "Wyższy średni",       "free": False},
    {"code": "C1", "label": "C1", "desc": "Zaawansowany",        "free": False},
    {"code": "C2", "label": "C2", "desc": "Biegły",              "free": False},
]

def _premium_active(profile):
    """Premium uznane, gdy flaga jest prawdziwa LUB premium_until w przyszłości.
    Odporne na bool/int/string zwracane przez RPC get_player_profile."""
    def _truthy(x):
        if isinstance(x, bool): return x
        if isinstance(x, (int, float)): return x != 0
        if isinstance(x, str): return x.strip().lower() in ("true","t","1","yes","premium","active")
        return bool(x)
    if _truthy(profile.get("is_premium", False)):
        return True
    pu = profile.get("premium_until")
    if pu:
        try:
            from datetime import datetime
            until = datetime.fromisoformat(str(pu).replace("Z", "+00:00"))
            now = datetime.now(until.tzinfo) if until.tzinfo else datetime.now()
            return until > now
        except Exception:
            return False
    return False
CATEGORIES = []  # ładowane z bazy po wyborze języka/poziomu

def _jwt_refresh_sync():
    """Synchroniczne odświeżenie tokena JWT (+ sync postgrest, persystencja)."""
    return _refresh_and_sync()


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
                                   "icon": r.get("icon", "")}
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
                               "icon": r.get("icon", "")}
                              for r in (resp.data or [])]
                print(f"[CATEGORIES] fallback: {len(CATEGORIES)} kategorii")
            except Exception as e2:
                if "JWT" in str(e2) and _retry:
                    if _jwt_refresh_sync():
                        load_categories(lang, level, _retry=False)
            return
        resp = supabase.table("categories").select("code,label,icon").order("id").execute()
        CATEGORIES = [{"code": r["code"], "label": r.get("label", r["code"]),
                       "icon": r.get("icon", "")}
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

# ── Konfiguracja: chowanie fiszki przy kursorze (hover-hide) ──
HOVER_HIDE_ENABLED = True    # fiszka znika, gdy kursor jest blisko
HOVER_HIDE_MARGIN  = 45      # px wokół fiszki — wejście w tę strefę chowa ją
HOVER_SHOW_MARGIN  = 95      # px — kursor musi wyjść poza tę (szerszą) strefę, by wróciła (histereza)
HOVER_POLL_MS      = 70      # co ile ms sprawdzamy pozycję kursora

# ── Konfiguracja: przenoszenie trudnych słów między kategoriami (SRS carry-forward) ──
MASTER_REPS_MIN     = 3      # kanoniczna bramka "Opanowane": powtórzenia >= 3 ...
MASTER_INTERVAL_MIN = 21     # ... ORAZ interwał >= 21 dni (dopiero wtedy słowo przestaje krążyć)
CARRY_OVERLAY_MAX   = 6      # max różnych powtórek wmieszanych w overlay naraz
CARRY_TEST_MAX      = 8      # max słów z poprzednich kategorii dołożonych do testu

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
    "none":        "Brak",
    "flash_gold":  "Złoty błysk",
    "flash_red":   "Czerwony błysk",
    "flash_cyan":  "Cyjanowy błysk",
    "flash_pink":  "Różowy błysk",
    "flash_lime":  "Limonkowy",
    "flash_blue":  "Niebieski błysk",
    "glow_white":  "Biały blask",
    "glow_orange": "Pomarańcz",
    "glow_purple": "Fiolet",
    "neon_green":  "Neon zielony",
    "neon_blue":   "Neon niebieski",
    "pulse":       "Pulsowanie",
    "shake":       "Drżenie",
    "rainbow":     "Tęcza",
    "zoom_in":     "Powiększenie",
    "zoom_out":    "Pomniejszenie",
    "typewriter":  "Maszyna",
    "bounce":      "Odbicie",
    "spin_color":  "Obrót kolorów",
    "fire_text":   "Ognisty tekst",
}

def lang_label(code):
    return next((l["label"] for l in LANGUAGES if l["code"] == code), code)


# ──────────────────────────────────────────────────────
# HELPERS UI
# ──────────────────────────────────────────────────────
DARK_BG = QColor(16, 22, 40, 214)
BORDER  = QColor(96, 110, 150, 110)

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
            border:1px solid rgba(96,110,150,120);
            border-radius:10px; padding:8px; font-size:12px; }
        QPushButton:hover { background:rgba(72,82,128,200); border-color:rgba(201,106,42,235); }
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
        """Śledź interakcję — wysyłaj od razu do analityki first-party (Supabase)."""
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
        pass  # first-party: wysyłka natychmiastowa, brak bufora

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
        # Auto-refresh JWT jeśli potrzeba (+ sync postgrest)
        try:
            if supabase.auth.get_user() is None:
                _refresh_and_sync()
            else:
                _sync_postgrest_token()
        except Exception:
            _refresh_and_sync()
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
            # Pobierz słowa do powtórki SRS (trudne z poprzednich kategorii)
            try:
                srs_resp = supabase.rpc("get_due_cards_all", {
                    "p_lang": self.lang, "p_limit": CARRY_OVERLAY_MAX * 3,
                }).execute()
                srs_cards = []
                _seen_srs = set(seen_words)   # nie powielaj słów z bieżącej kategorii
                for r in (srs_resp.data or []):
                    if r.get("category_code") == self.cat:
                        continue
                    k = (r.get("word", "") or "").strip().lower()
                    if not k or k in _seen_srs:
                        continue
                    _seen_srs.add(k)
                    srs_cards.append({"word": r["word"], "translation": r["translation"],
                                      "romaji": r.get("romaji", ""), "srs": True,
                                      "flashcard_id": r.get("flashcard_id", 0),
                                      "category": r.get("category_code", "")})
            except Exception:
                srs_cards = []
            # Mieszaj normalne + powtórki, ale twardy limit powtórek (anti-bloat)
            import random
            if srs_cards and normal:
                n_srs = min(CARRY_OVERLAY_MAX, max(1, len(normal) // 3))
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
        if _refresh_and_sync():
            self.refreshed.emit()
        else:
            print("[JWT] Refresh failed")
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
                # Kanonicznie: srs_progress + bramka reps>=3 AND interval>=21
                # (stara wersja liczyła z word_progress po ease>=2.5/reps>=2 — inna
                #  definicja niż web/mobile, stąd rozjazd liczników między ekranami).
                resp = (supabase.table("srs_progress")
                        .select("card_key", count="exact")
                        .in_("flashcard_id", card_ids)
                        .gte("repetitions", MASTER_REPS_MIN)
                        .gte("interval_days", MASTER_INTERVAL_MIN).execute())
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
            next_review = (date.today() + timedelta(days=7)).isoformat()
            for c in cards:
                fid = c.get("id", 0)
                if not fid: continue
                try:
                    supabase.table("word_progress").upsert({
                        "user_id": user_id, "flashcard_id": fid,
                        # D1: stan „widziane, niezweryfikowane" — NIE mastery.
                        # Recall w teście awansuje kartę; deklaracja nie.
                        "ease_factor": 2.5, "interval_days": 7,
                        "repetitions": 1, "next_review": next_review,
                        "times_seen": 1, "times_correct": 0,
                    }, on_conflict="user_id,flashcard_id").execute()
                except Exception: pass
                # Kanonicznie (cross-surface): ten sam stan do srs_progress
                srs_declare_seen({
                    "flashcard_id": fid,
                    "word":        c.get("word", ""),
                    "translation": c.get("translation", ""),
                    "lang":        self.lang,
                })
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
                    "p_lang": self.lang, "p_limit": 40
                }).execute()
                due_cards = [r for r in (due_resp.data or [])
                            if r.get("category_code") != self.cat]
            except Exception:
                due_cards = []
            # Progres tylko dla potrzebnych fiszek (kategoria + due) — omija limit 1000 wierszy
            _need_ids = list({c.get("id", 0) for c in cat_cards}
                             | {c.get("flashcard_id", 0) for c in due_cards})
            _need_ids = [i for i in _need_ids if i]
            prog = {}
            try:
                if _need_ids:
                    # Kanoniczne źródło = srs_progress (widzi też postęp z web/mobile).
                    prog_resp = (supabase.table("srs_progress")
                                 .select("flashcard_id,repetitions,ease_factor,interval_days")
                                 .eq("user_id", current_uid())
                                 .in_("flashcard_id", _need_ids).execute())
                    prog = {r["flashcard_id"]: r for r in (prog_resp.data or [])
                            if r.get("flashcard_id")}
                    if not prog:
                        # Degradacja: konto sprzed migracji ma dane tylko w legacy.
                        legacy = (supabase.table("word_progress")
                                  .select("flashcard_id,repetitions,ease_factor,interval_days")
                                  .eq("user_id", current_uid())
                                  .in_("flashcard_id", _need_ids).execute())
                        prog = {r["flashcard_id"]: r for r in (legacy.data or [])}
            except Exception:
                prog = {}

            def _mastered(p):
                # Kanoniczna bramka "Opanowane": reps >= 3 ORAZ interval >= 21 dni.
                return bool(p) and p.get("repetitions", 0) >= MASTER_REPS_MIN \
                       and p.get("interval_days", 0) >= MASTER_INTERVAL_MIN

            # Słowa z bieżącej kategorii: wszystko, co NIE jest jeszcze opanowane
            test_from_cat = []
            for c in cat_cards:
                fid = c.get("id", 0)
                p = prog.get(fid)
                if _mastered(p):
                    continue
                status = "unknown" if not p else "learning"
                test_from_cat.append({
                    "flashcard_id": fid, "word": c["word"],
                    "translation": c["translation"], "romaji": c.get("romaji", ""),
                    "status": status, "from_cat": self.cat
                })

            # Priorytet trudności: brak progresu > niski ease > mało powtórzeń
            def _prio(c):
                p = prog.get(c.get("flashcard_id", 0))
                if not p:
                    return (0, 0.0, 0)
                return (1, p.get("ease_factor", 2.5), p.get("repetitions", 0))
            due_cards.sort(key=_prio)

            # Carry-forward: trudne słowa z innych kategorii, twardy limit (anti-bloat)
            max_due = min(CARRY_TEST_MAX, max(1, len(test_from_cat) // 2))
            test_due = []
            for c in due_cards:
                if len(test_due) >= max_due:
                    break
                p = prog.get(c.get("flashcard_id", 0))
                if _mastered(p):
                    continue
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
        background: rgba(26,36,60,190); color: white;
        border: 1px solid rgba(110,125,165,140);
        border-radius: 8px; padding: 8px 12px; font-size: 13px;
    }
    QLineEdit:hover { border: 1px solid rgba(201,106,42,140); }
    QLineEdit:focus { border: 1px solid rgba(201,106,42,210); }
"""
BTN_PRIMARY = """
    QPushButton {
        background: rgba(28,38,66,205); color: white;
        border: 1.5px solid rgba(201,106,42,235); border-radius: 10px;
        padding: 9px; font-size: 13px; font-weight: bold;
    }
    QPushButton:hover   { background: rgba(38,50,84,225); border-color: rgba(224,120,48,255); }
    QPushButton:pressed { background: rgba(22,30,54,235); border-color: rgba(168,86,32,255); }
    QPushButton:disabled{ background: rgba(40,46,74,120); color: rgba(255,255,255,80); border-color: rgba(90,100,140,90); }
"""

ONBOARDING_KEY = "onboarding_done_v2"

class OnboardingWindow(_DraggableWindow):
    """Onboarding (D6-D10) — kontrakt zaufania i model myślowy przed logowaniem."""
    finished = pyqtSignal()

    SLIDES = [
        {
            "tag": "WITAJ",
            "title": "Twój komputer staje się nauczycielem",
            "body": "Uczysz się obok pracy, nie zamiast niej. Fiszki pojawiają się dyskretnie w tle — podczas pracy, gry, przeglądania.",
        },
        {
            "tag": "JAK TO DZIAŁA",
            "title": "Nauka na peryferiach uwagi",
            "body": "Nie musisz się zatrzymywać. Słowa przewijają się w rogu ekranu, a mózg przyswaja je mimochodem — powtórka wtedy, gdy naprawdę jej potrzebujesz.",
        },
        {
            "tag": "UCZCIWOŚĆ",
            "title": "Opanowane znaczy zapamiętane",
            "body": "Kartę zaliczasz tylko wtedy, gdy odtworzysz słowo z pamięci — nie przez kliknięcie. Żadnych punktów, serii ani odznak. Tylko realny postęp.",
        },
        {
            "tag": "ZACZNIJ ZA DARMO",
            "title": "Diagnostyka i mapa słów",
            "body": "Na start sprawdzasz, co już umiesz, i dostajesz swoją mapę słownictwa. Bez zobowiązań — płacisz dopiero, gdy zechcesz więcej.",
        },
        {
            "tag": "GOTOWE",
            "title": "Zaczynajmy",
            "body": "Zaloguj się i wybierz język — reszta dzieje się w tle. Ikonę Eyelingo w zasobniku klikasz, gdy chcesz otworzyć panel.",
        },
    ]

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(360, 452)
        self._slide = 0
        self._build()
        sc = QApplication.primaryScreen().availableGeometry()
        self.move(sc.center().x() - 180, sc.center().y() - 226)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("Eyelingo")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        il = QVBoxLayout(inner); il.setContentsMargins(32, 24, 32, 26); il.setSpacing(14)
        lay.addWidget(inner, 1)

        il.addStretch(1)

        # Eyebrow (tag ekranu)
        self.lbl_tag = QLabel()
        self.lbl_tag.setFont(QFont("Segoe UI", 9, QFont.Weight.Bold))
        self.lbl_tag.setStyleSheet("color:rgba(150,170,225,190);background:transparent;letter-spacing:2px;")
        self.lbl_tag.setAlignment(Qt.AlignmentFlag.AlignCenter)
        il.addWidget(self.lbl_tag)

        # Tytuł
        self.lbl_title = QLabel()
        self.lbl_title.setFont(QFont("Segoe UI", 18, QFont.Weight.Bold))
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

        il.addStretch(2)

        # Dots
        dots_w = QWidget(); dots_w.setStyleSheet("background:transparent;")
        dots_l = QHBoxLayout(dots_w); dots_l.setContentsMargins(0, 0, 0, 0); dots_l.setSpacing(8)
        dots_l.addStretch()
        self._dots = []
        for _ in range(len(self.SLIDES)):
            d = QLabel("●")
            d.setFont(QFont("Segoe UI", 8))
            d.setStyleSheet("background:transparent;")
            dots_l.addWidget(d)
            self._dots.append(d)
        dots_l.addStretch()
        il.addWidget(dots_w)

        # Nawigacja: Wstecz (subtelny) + Dalej
        nav = QWidget(); nav.setStyleSheet("background:transparent;")
        nl = QHBoxLayout(nav); nl.setContentsMargins(0, 0, 0, 0); nl.setSpacing(10)
        self.btn_back = QPushButton("Wstecz")
        self.btn_back.setStyleSheet(
            "QPushButton{background:transparent;color:rgba(170,180,215,160);"
            "border:none;font-size:11px;} QPushButton:hover{color:rgba(220,228,255,220);}")
        self.btn_back.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_back.clicked.connect(self._prev)
        self.btn_next = QPushButton("Dalej →")
        self.btn_next.setStyleSheet(BTN_PRIMARY)
        self.btn_next.setMinimumHeight(40)
        self.btn_next.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_next.clicked.connect(self._next)
        nl.addWidget(self.btn_back)
        nl.addWidget(self.btn_next, 1)
        il.addWidget(nav)

        self._update_slide()

    def _update_slide(self):
        s = self.SLIDES[self._slide]
        self.lbl_tag.setText(s["tag"])
        self.lbl_title.setText(s["title"])
        self.lbl_body.setText(s["body"])
        is_last = self._slide == len(self.SLIDES) - 1
        self.btn_next.setText("Rozpocznij →" if is_last else "Dalej →")
        self.btn_back.setVisible(self._slide > 0)
        for k, d in enumerate(self._dots):
            on = k == self._slide
            d.setStyleSheet("color:%s;background:transparent;" % (
                "rgba(255,255,255,220)" if on else "rgba(255,255,255,60)"))

    def _prev(self):
        if self._slide > 0:
            self._slide -= 1
            self._update_slide()

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
        self.setFixedSize(360, 500)
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
            Path(_resource_path("logo_transparent_navy.png")),
            Path(_resource_path("logo_navy.png")),
            Path(_resource_path("eyelingomark.png")),
            Path(__file__).parent / "logo_transparent_navy.png",
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
        if self._mode == "register" and len(password) < 8:
            self.lbl_error.setText("Hasło musi mieć co najmniej 8 znaków.")
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
                    # Audyt RLS N1: UPDATE profiles zablokowany dla usera — używamy RPC.
                    supabase.rpc("update_my_profile", {"p_username": self._username}).execute()
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
        self._hover_hidden = False
        self._hover_paused_rotation = False
        self._init_hover_hide()

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
        self.setFixedSize(360, 130)   # ZAWSZE stały rozmiar

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

        self.lbl_info = QLabel("Wybierz język i kategorię")
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
        self.lbl_info.setText(f"{cat}  ·  {level}  ·  {lang_label(lang)}")
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
        if romaji and self.lang in NON_LATIN_LANGS:
            # Pismo nielatyńskie: lbl_word = zapis natywny (styl jak tłumaczenie), lbl_romaji = transliteracja pośrodku
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
        if not (romaji and self.lang in NON_LATIN_LANGS):
            self.lbl_word.setFont(QFont("Segoe UI", self._get_word_font_size(word), QFont.Weight.Bold))
        # Efekt wizualny słówka
        QTimer.singleShot(50, self._play_word_effect)
        # Etykieta SRS / własny zestaw
        if c.get("srs"):
            cat_label = c.get("category", "poprzednia kategoria")
            self.lbl_info.setText(f"Powtórka · {cat_label}")
        elif getattr(self, "_is_custom", False):
            self.lbl_info.setText(f"Własny · {self.cat}")
        else:
            self.lbl_info.setText(f"{self.cat}  ·  {self.level}  ·  {lang_label(self.lang)}")
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
        # Efekt na transliteracji jeśli pismo nielatyńskie, inaczej na słówku
        lbl  = self.lbl_romaji if (self.lang in NON_LATIN_LANGS and self.lbl_romaji.isVisible()) else self.lbl_word
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
            "flash_blue":  "rgba(56,182,120,255)",
            "glow_white":  "rgba(255,255,255,255)",
            "glow_orange": "rgba(255,140,0,255)",
            "glow_purple": "rgba(185,75,255,255)",
            "neon_green":  "rgba(57,255,20,255)",
            "neon_blue":   "rgba(46,170,110,255)",
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

    # ── Hover-hide: chowanie fiszki, gdy kursor jest blisko ──
    def _init_hover_hide(self):
        self._hover_timer = QTimer(self)
        self._hover_timer.timeout.connect(self._check_cursor_proximity)
        self._hover_timer.start(HOVER_POLL_MS)

    def _hover_apply(self, hidden: bool):
        """Chowa/pokazuje fiszkę przez przezroczystość (okno pozostaje click-through).
        Nie używa hide()/show(), by nie kolidować z pauzą/wznowieniem z traya."""
        if hidden == self._hover_hidden:
            return
        self._hover_hidden = hidden
        if hidden:
            # pauza rotacji, by żadna fiszka nie "przeleciała" za kursorem
            self._hover_paused_rotation = self.timer.isActive()
            if self._hover_paused_rotation:
                self.timer.stop()
            self.setWindowOpacity(0.0)
        else:
            self.setWindowOpacity(OPACITY)
            if self._hover_paused_rotation:
                self._hover_paused_rotation = False
                self.timer.start(int(APP_SETTINGS.get("display_time", 8) * 1000))

    def _check_cursor_proximity(self):
        if not HOVER_HIDE_ENABLED:
            return
        # Nie ingeruj, gdy overlay ukryty przez pauzę / użytkownika (hide()).
        # Przy hover-hide okno jest wciąż "visible" (tylko opacity=0), więc tu wchodzimy.
        if not self.isVisible() or not self.cards:
            return
        try:
            from PyQt6.QtGui import QCursor
            cp  = QCursor.pos()
            geo = self.geometry()
        except Exception:
            return
        if not self._hover_hidden:
            m = HOVER_HIDE_MARGIN
            if geo.adjusted(-m, -m, m, m).contains(cp):
                self._hover_apply(True)
        else:
            m = HOVER_SHOW_MARGIN
            if not geo.adjusted(-m, -m, m, m).contains(cp):
                self._hover_apply(False)


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
        self.setFixedSize(440, 600)
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
        self.title = QLabel("Wybierz kategorię")
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
                # Pierwszy label = ikona - zamień na 
                name_lbl = labels[0]
                if not name_lbl.text().startswith("✓"):
                    name_lbl.setText("✓  " + name_lbl.text())
            btn.setStyleSheet("QPushButton { background:rgba(28,38,66,190); border:1px solid rgba(90,190,140,150); border-radius:12px; } QPushButton:hover { background:rgba(38,50,84,220); border-color:rgba(201,106,42,235); }")

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
            QPushButton { background:rgba(30,34,58,190);
                border:1px solid rgba(80,92,130,110); border-radius:12px; }
            QPushButton:hover  { background:rgba(44,52,86,225);
                border:1px solid rgba(201,106,42,235); }
            QPushButton:pressed{ background:rgba(26,30,50,255); }
        """)
        inner = QVBoxLayout(btn)
        inner.setContentsMargins(8, 5, 8, 5)
        inner.setSpacing(1)
        ln = QLabel(cat["label"])
        ln.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
        ln.setStyleSheet("color:rgba(220,235,255,220); background:transparent;")
        ln.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ln.setWordWrap(True)
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
        self.setFixedSize(360, 400)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek drag z tytułem
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        self.title = QLabel("Wybierz poziom")
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
        unlocked = level["free"] or self._is_premium
        if unlocked:
            btn.setStyleSheet("""
                QPushButton { background:rgba(30,40,68,185);
                    border:1px solid rgba(96,110,150,120); border-radius:12px; }
                QPushButton:hover  { background:rgba(42,54,90,220); border-color:rgba(201,106,42,235); }
                QPushButton:pressed{ background:rgba(22,30,54,255); }
            """)
            btn.clicked.connect(lambda _, c=level["code"]: self._pick(c))
        else:
            ll = QLabel("")
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
        self.setFixedSize(360, 620)
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
        t = QLabel("Wybierz język")
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
            QScrollArea { background: rgba(20,20,50,120); border: 1px solid rgba(120,135,190,70); border-radius: 10px; }
            QScrollBar:vertical { background: rgba(255,255,255,0.05); width: 6px; border-radius: 3px; }
            QScrollBar::handle:vertical { background: rgba(255,255,255,0.25); border-radius: 3px; }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }
        """)
        lang_w = QWidget(); lang_w.setStyleSheet("background:transparent;")
        lang_l = QVBoxLayout(lang_w); lang_l.setContentsMargins(8, 8, 8, 8); lang_l.setSpacing(5)

        STY_LANG = """
            QPushButton { background:rgba(30,40,68,185); color:white;
                border:1px solid rgba(96,110,150,120);
                border-radius:10px; padding:10px 16px;
                font-size:14px; text-align:left; }
            QPushButton:hover  { background:rgba(42,54,90,220); border-color:rgba(201,106,42,235); }
            QPushButton:pressed{ background:rgba(30,44,88,255); }
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
                label += "  "
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
        sep.setStyleSheet("background:rgba(210,220,255,22);")
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
                    background: rgba(44,54,90,200);
                    color: white;
                    border-color: rgba(201,106,42,235);
                }}
                QPushButton:pressed {{
                    background: rgba(20,22,50,200);
                }}
            """

        STY_PURPLE = _sty("rgba(120,135,190,150)")
        STY_BLUE   = _sty("rgba(120,135,190,150)")
        STY_GREY   = _sty("rgba(120,135,190,150)")
        STY_GOLD   = _sty("rgba(120,135,190,150)")
        STY_GREEN  = _sty("rgba(120,135,190,150)")

        btn_my = QPushButton("Moje własne zestawy")
        btn_my.setStyleSheet(STY_PURPLE)
        btn_my.setFont(QFont("Segoe UI", 12))
        btn_my.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_my.clicked.connect(lambda: self.on_selected("my_sets"))
        inner_l.addWidget(btn_my)

        btn_custom = QPushButton("Stwórz własne fiszki  ·  Premium")
        btn_custom.setStyleSheet(_sty("rgba(120,135,190,150)"))
        btn_custom.setFont(QFont("Segoe UI", 12))
        btn_custom.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_custom.clicked.connect(lambda: self.on_selected("create"))
        inner_l.addWidget(btn_custom)

        btn_settings = QPushButton("Ustawienia")
        btn_settings.setStyleSheet(STY_GREY)
        btn_settings.setFont(QFont("Segoe UI", 12))
        btn_settings.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_settings.clicked.connect(lambda: self.on_selected("settings"))
        inner_l.addWidget(btn_settings)

        btn_test = QPushButton("Zrób test")
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
        self.setFixedSize(440, 560)
        self._build()
        _right_third_pos(self)

    def set_premium(self, v): self._is_premium = v

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("Zestawy społeczności")
        t.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        t.setStyleSheet("color:white;background:transparent;")
        t.setAlignment(Qt.AlignmentFlag.AlignCenter)
        hl.addWidget(t)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        il = QVBoxLayout(inner); il.setContentsMargins(20, 10, 20, 16); il.setSpacing(8)
        lay.addWidget(inner, 1)

        # Wyszukiwarka
        self.inp_search = QLineEdit()
        self.inp_search.setPlaceholderText("Szukaj zestawów...")
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
        lname = QLabel(f"{s['name']}")
        lname.setFont(QFont("Segoe UI", 11, QFont.Weight.Bold))
        lname.setStyleSheet("color:white;background:transparent;")
        cards = s.get("user_set_cards", [])
        lmeta = QLabel(f"{s.get('likes_count',0)} · {len(cards)} fiszek")
        lmeta.setFont(QFont("Segoe UI", 9))
        lmeta.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        info.addWidget(lname); info.addWidget(lmeta)

        btn = QPushButton("Importuj")
        btn.setFixedWidth(90)
        btn.setStyleSheet("""
            QPushButton{background:rgba(30,32,60,160);color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);border-left:3px solid rgba(120,135,190,150);
                border-radius:8px;padding:6px 10px;font-size:11px;}
            QPushButton:hover{background:rgba(30,50,90,180);color:white;}
            QPushButton:disabled{color:rgba(150,120,230,220);border-left-color:rgba(130,80,220,150);}
        """)
        btn.setCursor(Qt.CursorShape.PointingHandCursor)

        if not self._is_premium:
            btn.setEnabled(False)
            btn.setText("Premium")
        else:
            btn.clicked.connect(lambda _, sid=s["id"], sname=s["name"], sc=cards: self._import(sid, sname, sc, btn))

        rl.addLayout(info, 1)
        rl.addWidget(btn)
        self._list_l.insertWidget(self._list_l.count()-1, row)

    def _import(self, set_id, set_name, cards, btn):
        btn.setEnabled(False); btn.setText("")
        self._import_worker = ImportSetWorker(set_id, set_name, cards)
        self._import_worker.done.connect(lambda n: (btn.__setattr__('_done', True), btn.setText("Dodano"), self.set_imported.emit()))
        self._import_worker.error.connect(lambda e: (btn.setEnabled(True), btn.setText("Importuj")))
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
    def __init__(self, results, card_map=None, lang=""):
        super().__init__()
        self.finished.connect(self.deleteLater)
        self.results  = results          # lista (flashcard_id, quality)
        self.card_map = card_map or {}   # flashcard_id → {word, translation}
        self.lang     = lang

    def run(self):
        for fid, quality in self.results:
            # 1) Legacy word_progress przez RPC — karmi serwerowe get_due_cards_all
            try:
                supabase.rpc("update_word_srs", {
                    "p_flashcard_id": fid,
                    "p_quality": quality
                }).execute()
            except Exception as e:
                print(f"[SRS] {e}")
            # 2) Kanonicznie: srs_progress — dopiero to widzą web i mobile
            c = self.card_map.get(fid)
            if c:
                srs_upsert({
                    "flashcard_id": fid,
                    "word":        c.get("word", ""),
                    "translation": c.get("translation", ""),
                    "lang":        c.get("lang") or self.lang,
                }, quality)

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
        t = QLabel("Stwórz własny zestaw")
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
        self.lbl_limit = QLabel(f"Plan darmowy: do {MAX_CARDS} fiszek w zestawie · Subskrypcja = bez limitu")
        self.lbl_limit.setFont(QFont("Segoe UI", 9))
        self.lbl_limit.setStyleSheet("color:rgba(150,120,230,200);background:transparent;")
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
                border-left:3px solid rgba(120,135,190,150);
                border-radius:10px; padding:8px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(30,50,90,180); color:white; }
        """)
        btn_add.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_add.clicked.connect(self._add_row)
        self.main_lay.addWidget(btn_add)

        self.lbl_error = QLabel("")
        self.lbl_error.setStyleSheet("color:rgba(255,100,100,220);font-size:11px;background:transparent;")
        self.lbl_error.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.main_lay.addWidget(self.lbl_error)

        self.btn_save = QPushButton("Zapisz zestaw")
        self.btn_save.setMinimumHeight(36)
        self.btn_save.setStyleSheet(BTN_PRIMARY)
        self.btn_save.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_save.clicked.connect(self._save)
        self.main_lay.addWidget(self.btn_save)

        self.main_lay.addWidget(_back_btn("← Wróć", self._go_back))
        self.main_lay.addWidget(_close_btn(self))

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
        self.btn_save.setText("Stwórz zestaw")
        self.hide()
        self.set_created.emit(name, cards)

    def _on_error(self, msg):
        self.lbl_error.setText(f"Błąd zapisu: {msg}")
        self.btn_save.setEnabled(True)
        self.btn_save.setText("Stwórz zestaw")

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
        self.setFixedSize(360, 460)
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
        t = QLabel("Moje zestawy")
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
        sep.setStyleSheet("background:rgba(210,220,255,18);")
        self.lay.addWidget(sep)

        self.lbl_status = QLabel("Ładowanie...")
        self.lbl_status.setFont(QFont("Segoe UI", 9))
        self.lbl_status.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_status.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lay.addWidget(self.lbl_status)

        _sa = QScrollArea(); _sa.setWidgetResizable(True)
        _sa.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        _sa.setStyleSheet(
            "QScrollArea { background: rgba(20,20,50,120); border: 1px solid rgba(120,135,190,70); border-radius: 10px; }"
            "QScrollBar:vertical { background: rgba(255,255,255,0.05); width: 6px; border-radius: 3px; }"
            "QScrollBar::handle:vertical { background: rgba(255,255,255,0.25); border-radius: 3px; }"
            "QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical { height: 0; }")
        _sets_w = QWidget(); _sets_w.setStyleSheet("background:transparent;")
        self.sets_lay = QVBoxLayout(_sets_w)
        self.sets_lay.setContentsMargins(8, 8, 8, 8)
        self.sets_lay.setSpacing(6)
        self.sets_lay.setAlignment(Qt.AlignmentFlag.AlignTop)
        _sa.setWidget(_sets_w)
        self.lay.addWidget(_sa, 1)

        # Przycisk nowego zestawu
        self.btn_new = QPushButton("Stwórz nowy zestaw")
        self.btn_new.setStyleSheet("""
            QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);
                border-left:3px solid rgba(120,135,190,150);
                border-radius:10px; padding:9px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(30,50,90,180); color:white; }
            QPushButton:disabled { color:rgba(120,125,145,120);
                border-left:3px solid rgba(80,80,100,60); }
        """)
        self.btn_new.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_new.clicked.connect(self._on_create_clicked)
        self.lay.addWidget(self.btn_new)

        # Premium info (ukryty domyślnie)
        self.lbl_premium = QLabel("Subskrypcja odblokuje nieograniczone zestawy")
        self.lbl_premium.setFont(QFont("Segoe UI", 9))
        self.lbl_premium.setStyleSheet("color:rgba(150,120,230,200);background:transparent;")
        self.lbl_premium.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_premium.setWordWrap(True)
        self.lbl_premium.hide()
        self.lay.addWidget(self.lbl_premium)

        # Przycisk lokalnego przeglądania zestawów w programie
        btn_browse_local = QPushButton("Przeglądaj zestawy w programie")
        btn_browse_local.setStyleSheet("""
            QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);
                border-left:3px solid rgba(120,135,190,150);
                border-radius:10px; padding:8px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(30,50,90,180); color:white; }
        """)
        btn_browse_local.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_browse_local.clicked.connect(self._on_browse_community)
        self.lay.addWidget(btn_browse_local)

        # Przycisk przeglądania na stronie www
        btn_browse_www = QPushButton("Materiały na stronie eyelingo")
        btn_browse_www.setStyleSheet("""
            QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                border:1px solid rgba(80,85,120,80);
                border-left:3px solid rgba(90,100,140,180);
                border-radius:10px; padding:8px 16px; font-size:12px; text-align:left; }
            QPushButton:hover { background:rgba(40,44,72,180); color:white; }
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
                self.lbl_limit.setText("Nieograniczone zestawy ")
        else:
            self.lbl_status.setText(f"Twoje zestawy ({count}):")
            if not self._is_premium:
                self.lbl_limit.setText(f"Plan darmowy: {count}/{self.FREE_SET_LIMIT} zestaw")
            else:
                self.lbl_limit.setText(f"Plan Premium: {count} zestaw(ów) ")

        for s in sets:
            row = QWidget(); row.setStyleSheet("background:transparent;")
            rl = QHBoxLayout(row); rl.setContentsMargins(0,0,0,0); rl.setSpacing(6)

            btn = QPushButton(f"{s['name']}")
            btn.setStyleSheet("""
                QPushButton { background:rgba(30,32,60,160); color:rgba(220,225,255,210);
                    border:1px solid rgba(80,85,120,80);
                    border-left:3px solid rgba(120,135,190,150);
                    border-radius:10px; padding:9px 16px; font-size:12px; text-align:left; }
                QPushButton:hover { background:rgba(30,50,90,180); color:white; }
            """)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, sid=s["id"], sname=s.get("name","Zestaw"): self._pick_set(sid, sname))

            # Przełącznik publiczny/prywatny
            is_public = s.get("is_public", False)
            btn_pub = QPushButton("Publiczny" if is_public else "Prywatny")
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
            self.btn_new.setText("Stwórz nowy zestaw  ·  limit osiągnięty")
            self.lbl_premium.show()
        else:
            self.btn_new.setEnabled(True)
            self.btn_new.setText("Stwórz nowy zestaw")
            self.lbl_premium.setVisible(not self._is_premium)

    def _toggle_public(self, set_id, currently_public, btn):
        new_public = not currently_public
        try:
            supabase.from_("user_sets").update({"is_public": new_public}).eq("id", set_id).execute()
            btn.setText("Publiczny" if new_public else "Prywatny")
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
            btn = QPushButton(f"{s['name']}")
            btn.setStyleSheet("""
                QPushButton { background:rgba(30,40,68,190); color:white;
                    border:1px solid rgba(96,110,150,120);
                    border-radius:10px; padding:9px; font-size:12px;
                    text-align:left; }
                QPushButton:hover { background:rgba(42,54,90,220); border-color:rgba(201,106,42,235); }
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
            uid = current_uid()   # waliduje sesję + synchronizuje token postgrest PRZED zapytaniami
            resp = supabase.rpc("get_player_profile").execute()
            data = dict(resp.data or {})
            # Premium autorytatywnie wprost z profiles — RPC bywa niekompletny
            try:
                prof = supabase.from_("profiles").select(
                    "is_premium,premium_until,levels_bought"
                ).eq("user_id", uid).single().execute()
                if prof.data:
                    for k in ("is_premium", "premium_until", "levels_bought"):
                        data[k] = prof.data.get(k)
            except Exception as e2:
                print(f"[PROFILE] premium fallback: {e2}")
            self.done.emit(data)
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
        self.setFixedSize(360, 520)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("Twoje statystyki")
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
        txt = QVBoxLayout(); txt.setSpacing(1)
        ll = QLabel(label); ll.setFont(QFont("Segoe UI", 9))
        ll.setStyleSheet("color:rgba(160,175,210,180);background:transparent;")
        lv = QLabel(str(value)); lv.setFont(QFont("Segoe UI", 13, QFont.Weight.Bold))
        lv.setStyleSheet(f"color:{color};background:transparent;")
        txt.addWidget(ll); txt.addWidget(lv)
        if icon:
            li = QLabel(icon); li.setFont(QFont("Segoe UI Emoji", 18))
            li.setStyleSheet("background:transparent;"); li.setFixedWidth(28)
            li.setAlignment(Qt.AlignmentFlag.AlignCenter)
            rl.addWidget(li)
        rl.addLayout(txt, 1)
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
        is_premium = _premium_active(data)
        premium_until = data.get("premium_until")
        username = data.get("username", "—")

        # Username
        un_row = QWidget(); un_row.setStyleSheet("background:rgba(201,106,42,30);border:1px solid rgba(201,106,42,100);border-radius:10px;")
        unl = QHBoxLayout(un_row); unl.setContentsMargins(14,10,14,10)
        unl_lbl = QLabel(f"{username}")
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
                prem_text = f"Premium · {days_left} dni"
                prem_color = "rgba(100,220,150,220)"
            except Exception:
                prem_text = "Premium"
                prem_color = "rgba(100,220,150,220)"
        else:
            prem_text = "Plan darmowy"
            prem_color = "rgba(160,175,210,180)"
        self.stats_lay.addWidget(self._stat_row("", "Status konta", prem_text, prem_color))

        # Statystyki
        self.stats_lay.addWidget(self._stat_row("", "Poznane słowa", f"{cards:,}".replace(",", " ")))

        hours = minutes // 60
        mins = minutes % 60
        time_str = f"{hours}h {mins}min" if hours else f"{mins} min"
        self.stats_lay.addWidget(self._stat_row("", "Czas nauki", time_str))
        self.stats_lay.addWidget(self._stat_row("", "Twoje zestawy", f"{sets_count}"))
        self.stats_lay.addWidget(self._stat_row("", "Łączne lajki", f"{total_likes}", "rgba(255,100,120,220)"))

        self.stats_lay.addStretch()
        self.stats_widget.show()

    def paintEvent(self, e):
        _paint_bg(self, e)


# (usunięto martwą, zacienioną klasę SettingsWindow — była błędnie nazwanym workerem złota/premium; aktywna klasa jest niżej)


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
        self.setFixedSize(360, 280)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(28, 28, 28, 28)
        lay.setSpacing(12)

        title = QLabel("Aktywuj Premium")
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
            self.lbl_msg.setText("" + message)
            QTimer.singleShot(1500, self.hide)
            self.activated.emit()
        else:
            self.lbl_msg.setStyleSheet("color: rgba(255,100,100,220); font-size:9px;")
            self.lbl_msg.setText("" + message)
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
    """Okno wyboru metody zakupu: jednorazowo / subskrypcja."""
    purchased = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(360, 620)
        self._price_key  = ""
        self._user_email = ""
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Nagłówek
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(16, 0, 16, 0)
        t = QLabel("Odblokuj poziom")
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
        sep.setStyleSheet("background:rgba(210,220,255,18);")
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

        # ── Zgody wymagane przy zakupie (kit 0.2 §B — dwa OSOBNE oświadczenia, domyślnie odznaczone) ──
        _cb_style = (
            "QCheckBox { color: rgba(205,212,240,220); background: transparent;"
            " font-size: 10px; spacing: 8px; }"
            " QCheckBox::indicator { width: 15px; height: 15px; }"
        )
        self.cb_docs = QCheckBox("Akceptuję Regulamin oraz Politykę Prywatności.")
        self.cb_docs.setStyleSheet(_cb_style)
        self.cb_docs.setFont(QFont("Segoe UI", 9))
        self.cb_docs.stateChanged.connect(self._consents_changed)
        il.addWidget(self.cb_docs)

        _legal = QLabel(
            f'<a href="{BASE}regulamin.html" style="color:rgba(201,106,42,235);">Regulamin</a>'
            f' &nbsp;·&nbsp; '
            f'<a href="{BASE}prywatnosc.html" style="color:rgba(201,106,42,235);">Polityka Prywatności</a>'
        )
        _legal.setOpenExternalLinks(True)
        _legal.setStyleSheet("background:transparent; font-size:10px;")
        _legal.setAlignment(Qt.AlignmentFlag.AlignCenter)
        il.addWidget(_legal)

        self.cb_now = QCheckBox(
            "Żądam rozpoczęcia świadczenia usługi PRO natychmiast,\n"
            "przed upływem 14-dniowego terminu na odstąpienie od\n"
            "umowy. Przyjmuję do wiadomości, że po pełnym wykonaniu\n"
            "usługi utracę prawo odstąpienia, a w razie odstąpienia\n"
            "przed pełnym wykonaniem zapłacę proporcjonalnie za\n"
            "okres, z którego skorzystałem."
        )
        self.cb_now.setStyleSheet(_cb_style)
        self.cb_now.setFont(QFont("Segoe UI", 9))
        self.cb_now.stateChanged.connect(self._consents_changed)
        il.addWidget(self.cb_now)

        self.lbl_renew = QLabel(
            "Subskrypcja odnawia się automatycznie co miesiąc (39 zł) lub co rok (329 zł), "
            "dopóki jej nie anulujesz. Anulować możesz w każdej chwili — napisz na "
            "eyelingo.app@gmail.com lub użyj panelu płatności."
        )
        self.lbl_renew.setWordWrap(True)
        self.lbl_renew.setFont(QFont("Segoe UI", 9))
        self.lbl_renew.setStyleSheet("color:rgba(170,180,215,190); background:transparent;")
        il.addWidget(self.lbl_renew)
        il.addSpacing(4)

        self.btn_once = QPushButton("Subskrypcja roczna  ·  329 zł/rok")
        self.btn_once.setStyleSheet(_sty("rgba(201,106,42,235)", "rgba(150,78,30,200)"))
        self.btn_once.setFont(QFont("Segoe UI", 12))
        self.btn_once.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_once.clicked.connect(self._pay_once)
        self.btn_once.setEnabled(False)
        il.addWidget(self.btn_once)

        self.btn_sub = QPushButton("Subskrypcja miesięczna  ·  39 zł/mies")
        self.btn_sub.setStyleSheet(_sty("rgba(120,135,190,210)", "rgba(60,70,120,190)"))
        self.btn_sub.setFont(QFont("Segoe UI", 12))
        self.btn_sub.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_sub.clicked.connect(self._pay_sub)
        self.btn_sub.setEnabled(False)
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

    def show_for(self, price_key, level_label, lang_label, user_email):
        self._price_key  = price_key
        self._user_email = user_email
        parts = price_key.split("_")
        self._lang_code  = parts[0] if len(parts) >= 2 else ""
        self._lvl_code   = parts[1] if len(parts) >= 2 else ""
        _is_prem = str(price_key).startswith("premium")
        self.btn_once.setVisible(True)
        if _is_prem:
            self.lbl_info.setText("PRO odblokowuje wszystkie poziomy i funkcje")
        else:
            self.lbl_info.setText(f"{lang_label}  ·  Poziom {level_label}")
        self.lbl_msg.setText("")
        self.lbl_msg.setStyleSheet("color:rgba(255,100,100,220);background:transparent;")
        # zgody sa jednorazowe — przy kazdym otwarciu od nowa (brak pre-zaznaczenia)
        self.cb_docs.setChecked(False)
        self.cb_now.setChecked(False)
        self._consents_changed()
        self.show(); self.raise_(); self.activateWindow()

    def _consents_changed(self, _state=None):
        ok = self.cb_docs.isChecked() and self.cb_now.isChecked()
        self.btn_once.setEnabled(ok)
        self.btn_sub.setEnabled(ok)
        if ok:
            self.lbl_msg.setText("")

    def _pay_once(self):
        self._start_checkout("premium_yearly")

    def _pay_sub(self):
        self._start_checkout("premium_monthly")

    def _start_checkout(self, price_key):
        if not (self.cb_docs.isChecked() and self.cb_now.isChecked()):
            self.lbl_msg.setText("Zaznacz obie zgody, aby kontynuować.")
            return
        try:
            ph_capture("checkout_consents", {
                "price_key": price_key,
                "consent_docs": True,
                "consent_immediate_access": True,
            })
        except Exception:
            pass
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


class SettingsWindow(_DraggableWindow):
    settings_changed = pyqtSignal(dict)
    go_back          = pyqtSignal()

    def __init__(self):
        super().__init__()
        _styled_window(self)
        self.setFixedSize(440, 560)
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
        hdr = QLabel("Ustawienia")
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
        sec("Wygląd")
        self.sl_op,  _ = self._mk_slider(lay,"Przezroczystość:", 30,100, int(APP_SETTINGS["opacity"]*100), "%")
        self.sl_txt, _ = self._mk_slider(lay,"Jasność tekstu:",  30,100, int(APP_SETTINGS["text_alpha"]/255*100), "%")

        # Czas
        sec("Czas wyświetlania fiszki")
        self.sl_time,_ = self._mk_slider(lay,"Sekund:", 5,15, max(5,min(15,APP_SETTINGS.get("display_time",8))), "s")

        # Efekty
        sec("Efekt wizualny")
        FX = [
            ("none",       "Brak"),
            ("glow_white", "Delikatne wyróżnienie nowego słowa"),
        ]
        self._fx_ids = [f[0] for f in FX]
        self._fx_cb  = QComboBox()
        self._fx_cb.setFont(QFont("Segoe UI",11))
        self._fx_cb.setFixedHeight(30)
        self._fx_cb.setStyleSheet("""
            QComboBox{background:rgba(26,36,54,190);color:white;
                border:1px solid rgba(70,130,105,150);border-radius:7px;padding:3px 10px;}
            QComboBox:hover{background:rgba(40,52,70,220);}
            QComboBox::drop-down{border:none;width:22px;}
            QComboBox::down-arrow{width:0;height:0;
                border-left:5px solid transparent;border-right:5px solid transparent;
                border-top:6px solid rgba(200,210,255,200);}
            QComboBox QAbstractItemView{background:rgba(20,28,44,245);color:white;
                selection-background-color:rgba(120,140,215,205);
                border:1px solid rgba(96,110,150,140);border-radius:6px;
                padding:2px;outline:none;}
        """)
        cur = APP_SETTINGS.get("card_effect","none")
        for fid,flbl in FX:
            self._fx_cb.addItem(flbl, fid)
        if cur in self._fx_ids:
            self._fx_cb.setCurrentIndex(self._fx_ids.index(cur))
        else:
            APP_SETTINGS["card_effect"] = "none"
        self._fx_cb.currentIndexChanged.connect(
            lambda i: self._on_fx(i))
        lay.addWidget(self._fx_cb)

        # Audio
        sec("Audio (TTS)")
        self.chk_audio = QCheckBox("Czytaj słówka głosem  (ALT+R)")
        self.chk_audio.setFont(QFont("Segoe UI",11))
        self.chk_audio.setStyleSheet("""
            QCheckBox{color:white;background:transparent;spacing:8px;}
            QCheckBox::indicator{width:18px;height:18px;border-radius:9px;
                border:2px solid rgba(96,110,150,190);background:rgba(26,36,54,190);}
            QCheckBox::indicator:checked{
                background:rgba(120,140,215,235);
                border-color:rgba(150,168,240,255);
                image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMiAxMiI+PHBhdGggZD0iTTIgNkw1IDlMMTAgMyIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4=);}
        """)
        self.chk_audio.setChecked(APP_SETTINGS.get("audio_enabled",False))
        if not _tts_available:
            self.chk_audio.setEnabled(False)
            self.chk_audio.setText("Audio niedostępne w tej wersji")
        lay.addWidget(self.chk_audio)

        # Skróty
        sec("Skróty klawiszowe")
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
                          "border-top:1px solid rgba(210,220,255,20);")
        bl = QHBoxLayout(bar); bl.setContentsMargins(14,8,14,8); bl.setSpacing(6)

        def mkb(text, bg, hover, slot, bold=False, border="rgba(255,255,255,30)"):
            b = QPushButton(text)
            b.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold if bold else QFont.Weight.Normal))
            b.setFixedHeight(34)
            b.setStyleSheet(f"QPushButton{{background:{bg};color:white;"
                            f"border:1px solid {border};border-radius:8px;padding:4px 8px;}}"
                            f"QPushButton:hover{{background:{hover};border-color:rgba(201,106,42,235);}}")
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.clicked.connect(slot)
            return b

        # Wróć=granat, Zapis=zielony, Zamknij=szary, Domyślne=tekst
        btn_back  = mkb("\u2190 Wr\u00F3\u0107", "rgba(60,66,92,210)", "rgba(82,90,120,235)", self._revert)
        btn_save  = mkb("Zapisz",  "rgba(28,38,66,205)", "rgba(38,50,84,225)", self._save, True, "rgba(201,106,42,235)")
        btn_close = mkb("Zamknij", "rgba(60,66,92,210)",   "rgba(82,90,120,235)",  self.hide)
        btn_def   = QPushButton("Przywróć domyślne")
        btn_def.setFont(QFont("Segoe UI", 9))
        btn_def.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_def.setStyleSheet("QPushButton{background:transparent;color:rgba(160,175,210,160);border:none;}"
                              "QPushButton:hover{color:rgba(170,190,235,225);}")
        btn_def.clicked.connect(self._reset)

        bl.addWidget(btn_back)
        bl.addWidget(btn_save)
        bl.addWidget(btn_close)
        bl.addStretch()
        _legal_row = QLabel(
            '<a href="https://fabianadrianw.github.io/eyelingo/regulamin.html" style="color:rgba(150,160,200,200);">Regulamin</a>'
            ' &nbsp;&middot;&nbsp; '
            '<a href="https://fabianadrianw.github.io/eyelingo/prywatnosc.html" style="color:rgba(150,160,200,200);">Prywatno&#347;&#263;</a>'
        )
        _legal_row.setOpenExternalLinks(True)
        _legal_row.setStyleSheet("background:transparent; font-size:9px;")
        bl.addWidget(_legal_row)
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
            QSlider::groove:horizontal{height:4px;background:rgba(70,80,120,120);border-radius:2px;}
            QSlider::handle:horizontal{width:13px;height:13px;margin:-5px 0;
                background:rgb(120,140,215);border-radius:6px;}
            QSlider::sub-page:horizontal{background:rgba(120,140,215,205);border-radius:2px;}
        """)
        vl = QLabel(f"{val}{suffix}")
        vl.setFont(QFont("Segoe UI",11,QFont.Weight.Bold))
        vl.setStyleSheet("color:rgba(150,168,240,235);"); vl.setFixedWidth(34)
        sl.valueChanged.connect(lambda v,l=vl,s=suffix: l.setText(f"{v}{s}"))
        row.addWidget(lb); row.addWidget(sl); row.addWidget(vl)
        lay.addLayout(row)
        return sl, vl

    def _hk_style(self, active):
        if active:
            return ("QPushButton{background:rgba(52,66,120,185);color:white;"
                    "border:1px solid rgba(120,140,215,150);border-radius:7px;padding:3px;font-size:10px;}"
                    "QPushButton:hover{background:rgba(66,82,150,220);}")
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
        btn.setStyleSheet("QPushButton{background:rgba(66,82,150,205);color:white;"
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
        APP_SETTINGS["card_effect"]   = self._fx_ids[self._fx_cb.currentIndex()]
        save_settings(APP_SETTINGS)
        self.settings_changed.emit(APP_SETTINGS)
        # NIE zamyka okna

    def _revert(self):
        """Wróć do panelu (hub) bez zapisywania zmian UI sesji."""
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


class SegmentBar(QWidget):
    """D5 — segmentowy pasek postępu: zaliczone / bieżące / pozostałe."""
    def __init__(self):
        super().__init__()
        self.total = 1
        self.current = 0
        self.setFixedHeight(6)

    def set_state(self, total, current):
        self.total = max(int(total), 1)
        self.current = max(0, min(int(current), self.total))
        self.update()

    def paintEvent(self, e):
        from PyQt6.QtCore import QRectF
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setPen(Qt.PenStyle.NoPen)
        n = self.total
        gap = 3.0
        w = (self.width() - gap * (n - 1)) / n if n > 0 else self.width()
        if w < 1:
            w = 1
        for idx in range(n):
            if idx < self.current:
                c = QColor(90, 210, 140, 220)     # zaliczone
            elif idx == self.current:
                c = QColor(235, 175, 90, 235)      # bieżące
            else:
                c = QColor(120, 128, 160, 90)       # pozostałe
            p.setBrush(c)
            p.drawRoundedRect(QRectF(idx * (w + gap), 0.0, w, float(self.height())), 2, 2)


class TestWindow(_DraggableWindow):
    test_done = pyqtSignal(list)

    def __init__(self):
        super().__init__()
        self.cards    = []
        self.index    = 0
        self.results  = []
        self.answered = False
        self.progress_key = ""
        self.save_progress = None
        _styled_window(self)
        self.setFixedSize(440, 452)
        self._build()
        sc = QApplication.primaryScreen().availableGeometry()
        self.move(sc.center().x() - 220, sc.center().y() - 226)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # Pasek: tytuł + „X z Y"
        hdr_w = QWidget(); hdr_w.setFixedHeight(32); hdr_w.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr_w); hl.setContentsMargins(16, 0, 16, 0)
        self.lbl_title = QLabel("Tryb nauki")
        self.lbl_title.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        self.lbl_title.setStyleSheet("color:white;background:transparent;")
        self.lbl_progress = QLabel("")
        self.lbl_progress.setFont(QFont("Segoe UI", 10))
        self.lbl_progress.setStyleSheet("color:rgba(200,210,255,180);background:transparent;")
        self.lbl_progress.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
        hl.addWidget(self.lbl_title); hl.addWidget(self.lbl_progress)
        lay.addWidget(hdr_w)

        # Segmentowy pasek postępu
        seg_wrap = QWidget(); seg_wrap.setStyleSheet("background:transparent;")
        sw = QVBoxLayout(seg_wrap); sw.setContentsMargins(16, 0, 16, 6)
        self.seg_bar = SegmentBar()
        sw.addWidget(self.seg_bar)
        lay.addWidget(seg_wrap)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        inner_lay = QVBoxLayout(inner)
        inner_lay.setContentsMargins(28, 12, 28, 20)
        inner_lay.setSpacing(12)
        lay.addWidget(inner, 1)

        self.lbl_prompt = QLabel("PRZET\u0141UMACZ")
        self.lbl_prompt.setFont(QFont("Segoe UI", 8, QFont.Weight.Bold))
        self.lbl_prompt.setStyleSheet("color:rgba(150,165,205,170);background:transparent;letter-spacing:1px;")
        self.lbl_prompt.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner_lay.addWidget(self.lbl_prompt)

        self.lbl_question = QLabel("")
        self.lbl_question.setFont(QFont("Segoe UI", 22, QFont.Weight.Bold))
        self.lbl_question.setStyleSheet("color:white;background:transparent;")
        self.lbl_question.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_question.setWordWrap(True)
        inner_lay.addWidget(self.lbl_question)

        self.lbl_hint = QLabel("Najpierw przypomnij sobie \u2014 potem wpisz:")
        self.lbl_hint.setFont(QFont("Segoe UI", 9))
        self.lbl_hint.setStyleSheet("color:rgba(200,210,255,160);background:transparent;")
        self.lbl_hint.setAlignment(Qt.AlignmentFlag.AlignCenter)
        inner_lay.addWidget(self.lbl_hint)

        self.inp = QLineEdit()
        self.inp.setPlaceholderText("wpisz s\u0142\u00F3wko...")
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

        self.lbl_sched = QLabel("")
        self.lbl_sched.setFont(QFont("Segoe UI", 9))
        self.lbl_sched.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.lbl_sched.setWordWrap(True)
        self.lbl_sched.setStyleSheet("color:rgba(170,185,225,180);background:transparent;")
        inner_lay.addWidget(self.lbl_sched)

        inner_lay.addStretch(1)

        self.btn_check = QPushButton("Sprawd\u017A \u2192")
        self.btn_check.setStyleSheet(BTN_PRIMARY)
        self.btn_check.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_check.clicked.connect(self._check)
        inner_lay.addWidget(self.btn_check)

        self.btn_end = QPushButton("Zako\u0144cz sesj\u0119")
        self.btn_end.setStyleSheet(
            "QPushButton{background:transparent;color:rgba(170,180,215,170);"
            "border:none;font-size:10px;} QPushButton:hover{color:rgba(220,228,255,220);}")
        self.btn_end.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_end.clicked.connect(self._end_session)
        inner_lay.addWidget(self.btn_end)

    def _set_prompt(self):
        lng = ""
        try:
            if self.cards:
                lng = lang_label(self.cards[self.index].get("lang", "") or "")
        except Exception:
            lng = ""
        self.lbl_prompt.setText("PRZET\u0141UMACZ" + (" NA: " + lng.upper() if lng else ""))

    def start_test(self, cards, n_review_from_other=0):
        seen = set(); unique = []
        for c in cards:
            key = c.get("word", "")
            if key not in seen:
                seen.add(key); unique.append(c)
        self.cards = unique
        self.index = 0
        self.results = []
        self.progress_key = ""
        self.save_progress = None
        self.inp.show(); self.lbl_hint.show(); self.btn_check.show(); self.btn_end.show()
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self._check)
        self._show_question()
        if n_review_from_other > 0:
            self.lbl_feedback.setStyleSheet("color:rgba(255,200,80,220);")
            self.lbl_feedback.setText("Test zawiera %d s\u0142\u00F3w z wcze\u015Bniejszych kategorii." % n_review_from_other)
            QTimer.singleShot(7000, lambda: self.lbl_feedback.setText("") if "wcze\u015Bniejszych" in self.lbl_feedback.text() else None)
        self.show(); self.raise_(); self.activateWindow()

    def resume_test(self, saved):
        self.index = saved.get("index", 0)
        self.results = saved.get("results", [])
        self.inp.show(); self.lbl_hint.show(); self.btn_check.show(); self.btn_end.show()
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self._check)
        self.lbl_feedback.setStyleSheet("color:rgba(100,200,255,220);")
        self.lbl_feedback.setText("Wznawiasz poprzedni test...")
        QTimer.singleShot(2000, lambda: self.lbl_feedback.setText(""))
        self._show_question()
        self.show(); self.raise_(); self.activateWindow()

    def show_all_known(self):
        self.lbl_title.setText("Wszystko powt\u00F3rzone")
        self.lbl_progress.setText("")
        self.seg_bar.set_state(1, 1)
        self.lbl_prompt.setText("")
        self.lbl_question.setText("Brak s\u0142\u00F3w do powt\u00F3rki")
        self.lbl_hint.setText("SRS nie znalaz\u0142 teraz s\u0142\u00F3w wymagaj\u0105cych powt\u00F3rki.")
        self.lbl_feedback.setText(""); self.lbl_sched.setText("")
        self.inp.hide(); self.btn_end.hide()
        self.btn_check.setText("Zamknij")
        try: self.btn_check.clicked.disconnect()
        except: pass
        self.btn_check.clicked.connect(self.hide)
        self.show(); self.raise_(); self.activateWindow()

    def _show_question(self):
        self.answered = False
        self.inp.clear(); self.inp.setEnabled(True)
        self.lbl_feedback.setText(""); self.lbl_sched.setText("")
        self.btn_check.show(); self.btn_check.setText("Sprawd\u017A \u2192")
        self.btn_end.show()
        card = self.cards[self.index]
        self.lbl_title.setText("Tryb nauki")
        self._set_prompt()
        self.lbl_question.setText(card["translation"])
        self.lbl_progress.setText("%d z %d" % (self.index + 1, len(self.cards)))
        self.seg_bar.set_state(len(self.cards), self.index)
        self.inp.setFocus()

    def _check(self):
        if self.answered: return
        answer = self.inp.text().strip()
        if not answer: return
        self.answered = True
        self.inp.setEnabled(False)
        card = self.cards[self.index]
        correct = card["word"]
        import re as _re
        variants = [v.strip() for v in _re.split(r'[/|]', correct)]
        variants += [_re.sub(r'[().]', '', v).strip() for v in variants]
        variants = [v for v in variants if v]
        sim = max(_similarity(answer, v) for v in variants)
        if sim >= 0.85:
            self.lbl_feedback.setStyleSheet("color:rgba(100,255,150,230);")
            self.lbl_feedback.setText("Zaliczone   (%s)" % correct)
            self.lbl_sched.setText("Odtworzone z pami\u0119ci \u2014 interwa\u0142 si\u0119 wyd\u0142u\u017Ca.")
            self._auto_rate(4); QTimer.singleShot(700, self._next); return
        elif sim >= 0.6:
            self.lbl_feedback.setStyleSheet("color:rgba(255,200,50,230);")
            self.lbl_feedback.setText("Prawie   Poprawnie: %s" % correct)
            self.lbl_sched.setText("Blisko \u2014 wr\u00F3ci szybciej, \u017Ceby si\u0119 utrwali\u0142o.")
            self._auto_rate(3); QTimer.singleShot(1400, self._next)
        else:
            self.lbl_feedback.setStyleSheet("color:rgba(255,100,100,230);")
            self.lbl_feedback.setText("Do powt\u00F3rki   Poprawnie: %s" % correct)
            self.lbl_sched.setText("Wr\u00F3ci nied\u0142ugo \u2014 bez presji, tak dzia\u0142a nauka.")
            self._auto_rate(1); QTimer.singleShot(1700, self._next)

    def _auto_rate(self, quality):
        self.results.append((self.cards[self.index].get("flashcard_id", 0), quality))
        self.btn_check.setText("Dalej \u2192")
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

    def _end_session(self):
        # Zako\u0144cz w ka\u017Cdej chwili \u2014 bez presji. Zapisujemy to, co zaliczone.
        if self.results:
            self._show_results()
        else:
            self.hide()

    def _show_results(self):
        correct = sum(1 for _, q in self.results if q >= 3)
        total   = len(self.results)
        pct     = int(correct / total * 100) if total else 0
        self.lbl_title.setText("Podsumowanie")
        self.lbl_progress.setText("")
        self.seg_bar.set_state(1, 1)
        self.lbl_prompt.setText("")
        self.lbl_question.setText("%d z %d" % (correct, total))
        self.lbl_hint.setText("%d%% odtworzone z pami\u0119ci" % pct)
        self.lbl_feedback.setStyleSheet("color:rgba(200,210,255,180);")
        self.lbl_feedback.setText("Trudniejsze s\u0142owa wr\u00F3c\u0105 cz\u0119\u015Bciej \u2014 SRS to rozplanuje.")
        self.lbl_sched.setText("")
        self.inp.hide(); self.btn_end.hide()
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
        self.setFixedSize(360, 210)
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

        title = QLabel("Czas na test!")
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
        btn_tak = QPushButton("Tak!")
        btn_tak.setStyleSheet(BTN_PRIMARY)
        btn_tak.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_tak.clicked.connect(lambda: (self.hide(), self.accepted.emit()))

        btn_nie = QPushButton("Może później")
        btn_nie.setStyleSheet("QPushButton { background:rgba(60,60,100,160); color:rgba(200,210,255,200); border:1px solid rgba(96,110,150,120); border-radius:10px; padding:8px; } QPushButton:hover { background:rgba(72,82,128,200); border-color:rgba(201,106,42,235); }")
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
        self.setFixedSize(360, 290)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 24, 24, 24)
        lay.setSpacing(10)
        title = QLabel("Wskazówka SRS")
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
        btn_test = QPushButton("Zrób test teraz")
        btn_test.setStyleSheet(BTN_PRIMARY)
        btn_test.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        btn_test.setFixedHeight(44)
        btn_test.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_test.clicked.connect(lambda: (self.hide(), self.accepted.emit()))
        lay.addWidget(btn_test)
        btn_known = QPushButton("Znam wszystkie słowa")
        btn_known.setFont(QFont("Segoe UI", 11))
        btn_known.setStyleSheet("QPushButton { background: rgba(28,38,66,200); color: white; border: 1px solid rgba(90,190,140,150); border-radius: 10px; padding: 8px; } QPushButton:hover { background: rgba(38,50,84,220); }")
        btn_known.setFixedHeight(40)
        btn_known.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_known.clicked.connect(lambda: (self.hide(), self.all_known.emit()))
        lay.addWidget(btn_known)
        btn_skip = QPushButton("Zmień bez testu")
        btn_skip.setFont(QFont("Segoe UI", 11))
        btn_skip.setStyleSheet("QPushButton { background: rgba(40,40,80,160); color: rgba(200,210,255,160); border: 1px solid rgba(96,110,150,90); border-radius: 10px; padding: 6px; } QPushButton:hover { background: rgba(58,66,104,200); }")
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
        self.setFixedSize(360, 280)
        self._build()
        _right_third_pos(self)

    def _build(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 24, 24, 24)
        lay.setSpacing(12)
        title = QLabel("Niedokończony test")
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
        btn_resume = QPushButton("Dokończ test")
        btn_resume.setStyleSheet(BTN_PRIMARY)
        btn_resume.setFont(QFont("Segoe UI", 12, QFont.Weight.Bold))
        btn_resume.setFixedHeight(44)
        btn_resume.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_resume.clicked.connect(lambda: (self.hide(), self.resume.emit()))
        lay.addWidget(btn_resume)
        btn_known = QPushButton("Znam wszystkie słowa")
        btn_known.setFont(QFont("Segoe UI", 11))
        btn_known.setStyleSheet("QPushButton { background: rgba(28,38,66,200); color: white; border: 1px solid rgba(90,190,140,150); border-radius: 10px; padding: 8px; } QPushButton:hover { background: rgba(38,50,84,220); }")
        btn_known.setFixedHeight(40)
        btn_known.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_known.clicked.connect(lambda: (self.hide(), self.all_known.emit()))
        lay.addWidget(btn_known)
        btn_skip = QPushButton("Pomiń")
        btn_skip.setFont(QFont("Segoe UI", 11))
        btn_skip.setStyleSheet("QPushButton { background: rgba(40,40,80,160); color: rgba(200,210,255,160); border: 1px solid rgba(96,110,150,90); border-radius: 10px; padding: 6px; } QPushButton:hover { background: rgba(58,66,104,200); }")
        btn_skip.setFixedHeight(36)
        btn_skip.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_skip.clicked.connect(lambda: (self.hide(), self.skip.emit()))
        lay.addWidget(btn_skip)

    def keyPressEvent(self, e):
        if e.key() == Qt.Key.Key_Escape:
            self.hide(); self.skip.emit()

    def paintEvent(self, e):
        _paint_bg(self, e)


_TRAY_ICON_B64 = (
    "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"
)


def make_tray_icon() -> QIcon:
    """Ikona tray = logo Eyelingo (ludzik), wbudowane base64.
    Fallback: rysowana litera F, gdyby dekodowanie zawiodło."""
    try:
        import base64 as _b64
        px = QPixmap()
        if px.loadFromData(_b64.b64decode(_TRAY_ICON_B64), "PNG") and not px.isNull():
            return QIcon(px)
    except Exception:
        pass
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


# ──────────────────────────────────────────────────────
# D3 — TRAY WINDOW (HUB)
# ──────────────────────────────────────────────────────
class DueCountWorker(QThread):
    """Zlicza karty dojrzałe do powtórki (PULL) — realna liczba, nie streak."""
    done = pyqtSignal(int)
    def __init__(self, lang):
        super().__init__()
        self.lang = lang
        self.finished.connect(self.deleteLater)
    def run(self):
        try:
            resp = supabase.rpc("get_due_cards_all",
                                {"p_lang": self.lang, "p_limit": 500}).execute()
            self.done.emit(len(resp.data or []))
        except Exception as e:
            print(f"[DUE] {e}"); self.done.emit(0)


_HUB_OUTLINE = """
    QPushButton { background:rgba(60,65,110,90); color:rgba(210,222,255,220);
        border:1px solid rgba(120,135,190,150); border-radius:10px;
        padding:9px; font-size:12px; }
    QPushButton:hover { background:rgba(80,90,150,150); border-color:rgba(201,106,42,235); }
"""


class HubWindow(_DraggableWindow):
    """D3 — trwałe okno traya. Lewy klik na ikonę traya otwiera/zamyka je.
    Menu kontekstowe (prawy klik) zostaje jako szybki dostęp."""

    _PRESET_ON = ("QPushButton{background:rgba(120,140,215,215);color:white;border:none;"
                  "border-radius:8px;padding:7px;font-size:11px;}")
    _PRESET_OFF = ("QPushButton{background:rgba(55,60,100,140);color:rgba(200,212,245,200);"
                   "border:1px solid rgba(90,100,160,90);border-radius:8px;padding:7px;font-size:11px;}"
                   "QPushButton:hover{background:rgba(70,80,140,180);border-color:rgba(201,106,42,235);}")

    def __init__(self, app_ref):
        super().__init__()
        self.app_ref = app_ref
        _styled_window(self)
        self.setFixedSize(360, 520)
        self._build()
        self._mirror_timer = QTimer(self)
        self._mirror_timer.timeout.connect(self._tick)

    # ── pozycja: dolny-prawy róg (flyout traya) ──
    def _position(self):
        sc = QApplication.primaryScreen().availableGeometry()
        x = sc.right() - self.width() - 16
        y = sc.bottom() - self.height() - 16
        self.move(max(sc.left() + 8, x), max(sc.top() + 8, y))

    # ── budowa ──
    def _build(self):
        lay = QVBoxLayout(self); lay.setContentsMargins(0, 0, 0, 0); lay.setSpacing(0)

        # 1. PASEK STATUSU (strefa drag)
        hdr = QWidget(); hdr.setFixedHeight(32); hdr.setStyleSheet("background:transparent;")
        hl = QHBoxLayout(hdr); hl.setContentsMargins(14, 0, 10, 0); hl.setSpacing(6)
        self.lbl_status = QLabel("\u25CF  Aktywne")
        self.lbl_status.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
        self.lbl_status.setStyleSheet("color:rgba(120,225,160,230);background:transparent;")
        hl.addWidget(self.lbl_status); hl.addStretch(1)
        self.btn_audio = self._icon_btn("\u266A", "D\u017Awi\u0119k"); self.btn_audio.clicked.connect(self._toggle_audio)
        self.btn_pause = self._icon_btn("\u23F8", "Wstrzymaj");       self.btn_pause.clicked.connect(self._toggle_pause)
        self.btn_x     = self._icon_btn("\u2715", "Zamknij");         self.btn_x.clicked.connect(self.hide)
        for b in (self.btn_audio, self.btn_pause, self.btn_x): hl.addWidget(b)
        lay.addWidget(hdr)

        inner = QWidget(); inner.setStyleSheet("background:transparent;")
        il = QVBoxLayout(inner); il.setContentsMargins(16, 8, 16, 16); il.setSpacing(12)
        lay.addWidget(inner, 1)

        # 2. UCZYSZ SIĘ
        il.addWidget(self._eyebrow("UCZYSZ SI\u0118"))
        self.lbl_learn = QLabel("\u2014")
        self.lbl_learn.setFont(QFont("Segoe UI", 11))
        self.lbl_learn.setStyleSheet("color:rgba(225,235,255,220);background:transparent;")
        self.lbl_learn.setWordWrap(True)
        il.addWidget(self.lbl_learn)
        self.btn_change = QPushButton("Zmie\u0144 nauk\u0119 \u2192")
        self.btn_change.setStyleSheet(_HUB_OUTLINE); self.btn_change.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_change.clicked.connect(lambda: (self.hide(), self.app_ref._show_lang()))
        il.addWidget(self.btn_change)

        # 3. TERAZ NA EKRANIE (mirror — bez ocen, świadomie)
        il.addWidget(self._eyebrow("TERAZ NA EKRANIE"))
        mir = QWidget(); mir.setStyleSheet(
            "QWidget{background:rgba(30,32,60,140);border:1px solid rgba(80,85,120,80);border-radius:10px;}")
        ml = QVBoxLayout(mir); ml.setContentsMargins(14, 12, 14, 12); ml.setSpacing(2)
        self.mir_word = QLabel("\u2014"); self.mir_word.setFont(QFont("Segoe UI", 15, QFont.Weight.Bold))
        self.mir_word.setStyleSheet("color:rgba(255,255,255,240);background:transparent;")
        self.mir_word.setAlignment(Qt.AlignmentFlag.AlignCenter); self.mir_word.setWordWrap(True)
        self.mir_tr = QLabel(""); self.mir_tr.setFont(QFont("Segoe UI", 10))
        self.mir_tr.setStyleSheet("color:rgba(200,220,255,200);background:transparent;")
        self.mir_tr.setAlignment(Qt.AlignmentFlag.AlignCenter); self.mir_tr.setWordWrap(True)
        self.mir_note = QLabel("Podgl\u0105d \u2014 oceniasz w trybie testu")
        self.mir_note.setFont(QFont("Segoe UI", 8))
        self.mir_note.setStyleSheet("color:rgba(150,160,200,150);background:transparent;")
        self.mir_note.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ml.addWidget(self.mir_word); ml.addWidget(self.mir_tr); ml.addWidget(self.mir_note)
        il.addWidget(mir)

        # 4. STATYSTYKI (3 komórki — realne liczby, zero streaka)
        stats = QWidget(); stats.setStyleSheet("background:transparent;")
        sl = QHBoxLayout(stats); sl.setContentsMargins(0, 0, 0, 0); sl.setSpacing(8)
        self.cell_known, w1 = self._stat_cell("Poznane")
        self.cell_due,   w2 = self._stat_cell("Dojrza\u0142o do powt\u00F3rki")
        self.cell_sess,  w3 = self._stat_cell("W tej sesji")
        for w in (w1, w2, w3): sl.addWidget(w, 1)
        il.addWidget(stats)

        il.addStretch(1)

        # 5. AKCJE
        self.btn_test = QPushButton("Zr\u00F3b test"); self.btn_test.setStyleSheet(BTN_PRIMARY)
        self.btn_test.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_test.clicked.connect(lambda: (self.hide(), self.app_ref._start_test()))
        il.addWidget(self.btn_test)
        row = QWidget(); row.setStyleSheet("background:transparent;")
        rl = QHBoxLayout(row); rl.setContentsMargins(0, 0, 0, 0); rl.setSpacing(8)
        self.btn_lib = QPushButton("Biblioteka fiszek"); self.btn_lib.setStyleSheet(_HUB_OUTLINE)
        self.btn_lib.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_lib.clicked.connect(lambda: (self.hide(), self.app_ref._show_my_sets()))
        self.btn_set = QPushButton("Ustawienia"); self.btn_set.setStyleSheet(_HUB_OUTLINE)
        self.btn_set.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_set.clicked.connect(lambda: (self.hide(), self.app_ref.win_settings.show(), self.app_ref.win_settings.raise_()))
        rl.addWidget(self.btn_lib, 1); rl.addWidget(self.btn_set, 1)
        il.addWidget(row)

        # 6. FOOTER
        self.lbl_footer = QPushButton("")
        self.lbl_footer.setFont(QFont("Segoe UI", 9))
        self.lbl_footer.setCursor(Qt.CursorShape.PointingHandCursor)
        self.lbl_footer.setStyleSheet(
            "QPushButton{background:transparent;color:rgba(160,175,210,180);border:none;}"
            "QPushButton:hover{color:rgba(170,190,235,235);}")
        self.lbl_footer.clicked.connect(self._footer_click)
        il.addWidget(self.lbl_footer)

        # ── D4: PANEL PAUZY (nakładka na treść aktywną) ──
        self._active_content = inner
        self.pause_panel = QWidget(); self.pause_panel.setStyleSheet("background:transparent;")
        pl = QVBoxLayout(self.pause_panel); pl.setContentsMargins(24, 20, 24, 20); pl.setSpacing(8)
        pl.addStretch(1)
        gl = QLabel("\u23F8"); gl.setFont(QFont("Segoe UI", 40))
        gl.setStyleSheet("color:rgba(235,190,110,220);background:transparent;")
        gl.setAlignment(Qt.AlignmentFlag.AlignCenter); pl.addWidget(gl)
        tt = QLabel("Fiszki wstrzymane"); tt.setFont(QFont("Segoe UI", 15, QFont.Weight.Bold))
        tt.setStyleSheet("color:rgba(255,255,255,235);background:transparent;")
        tt.setAlignment(Qt.AlignmentFlag.AlignCenter); pl.addWidget(tt)
        self.lbl_countdown = QLabel(""); self.lbl_countdown.setFont(QFont("Segoe UI", 10))
        self.lbl_countdown.setStyleSheet("color:rgba(200,215,255,190);background:transparent;")
        self.lbl_countdown.setAlignment(Qt.AlignmentFlag.AlignCenter); pl.addWidget(self.lbl_countdown)
        pl.addSpacing(6)
        btn_resume = QPushButton("Wzn\u00F3w teraz"); btn_resume.setStyleSheet(BTN_PRIMARY)
        btn_resume.setCursor(Qt.CursorShape.PointingHandCursor)
        btn_resume.clicked.connect(self._resume); pl.addWidget(btn_resume)
        prc = QLabel("Wr\u00F3ci automatycznie za:"); prc.setFont(QFont("Segoe UI", 8))
        prc.setStyleSheet("color:rgba(150,165,205,170);background:transparent;")
        prc.setAlignment(Qt.AlignmentFlag.AlignCenter); pl.addSpacing(4); pl.addWidget(prc)
        prow = QWidget(); prow.setStyleSheet("background:transparent;")
        prl = QHBoxLayout(prow); prl.setContentsMargins(0, 0, 0, 0); prl.setSpacing(6)
        self._preset_btns = {}
        for key, label, mins in (("5", "5 min", 5), ("30", "30 min", 30),
                                 ("60", "1 godz", 60), ("d", "Do jutra", None)):
            b = QPushButton(label); b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setStyleSheet(self._PRESET_OFF)
            b.clicked.connect(lambda _, m=mins, k=key: self._set_preset(k, m))
            self._preset_btns[key] = b; prl.addWidget(b, 1)
        pl.addWidget(prow)
        hint = QLabel("Snooze, nie zamykaj \u2014 wr\u00F3c\u0105 same."); hint.setFont(QFont("Segoe UI", 8))
        hint.setStyleSheet("color:rgba(140,150,190,150);background:transparent;")
        hint.setAlignment(Qt.AlignmentFlag.AlignCenter); pl.addSpacing(4); pl.addWidget(hint)
        pl.addStretch(1)
        self.pause_panel.hide(); lay.addWidget(self.pause_panel, 1)

    # ── helpery UI ──
    def _eyebrow(self, text):
        l = QLabel(text); l.setFont(QFont("Segoe UI", 8, QFont.Weight.Bold))
        l.setStyleSheet("color:rgba(140,155,200,170);background:transparent;letter-spacing:1px;")
        return l

    def _icon_btn(self, glyph, tip):
        b = QPushButton(glyph); b.setToolTip(tip); b.setFixedSize(26, 22)
        b.setCursor(Qt.CursorShape.PointingHandCursor)
        b.setStyleSheet(
            "QPushButton{background:rgba(60,65,110,120);color:rgba(220,230,255,210);"
            "border:1px solid rgba(120,135,190,120);border-radius:6px;font-size:12px;}"
            "QPushButton:hover{background:rgba(80,90,150,180);border-color:rgba(201,106,42,235);}")
        return b

    def _stat_cell(self, label):
        w = QWidget(); w.setStyleSheet(
            "QWidget{background:rgba(30,32,60,140);border:1px solid rgba(80,85,120,80);border-radius:10px;}")
        cl = QVBoxLayout(w); cl.setContentsMargins(8, 10, 8, 10); cl.setSpacing(2)
        val = QLabel("\u2013"); val.setFont(QFont("Segoe UI", 17, QFont.Weight.Bold))
        val.setStyleSheet("color:rgba(220,235,255,235);background:transparent;")
        val.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lab = QLabel(label); lab.setFont(QFont("Segoe UI", 8)); lab.setWordWrap(True)
        lab.setStyleSheet("color:rgba(160,175,210,180);background:transparent;")
        lab.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cl.addWidget(val); cl.addWidget(lab)
        return val, w

    # ── otwarcie / odświeżanie ──
    def open(self):
        self._position()
        self._refresh_all()
        if getattr(self.app_ref, "_pause_until", None):
            self._active_content.hide(); self.pause_panel.show()
        else:
            self.pause_panel.hide(); self._active_content.show()
        self.show(); self.raise_(); self.activateWindow()
        self._mirror_timer.start(1000)

    def hideEvent(self, e):
        self._mirror_timer.stop()
        super().hideEvent(e)

    def _refresh_all(self):
        self._refresh_status()
        self._refresh_learn()
        self._refresh_live()
        self._refresh_footer()
        self._refresh_stats()

    def _refresh_status(self):
        active = getattr(self.app_ref, "visible", True)
        if active:
            self.lbl_status.setText("\u25CF  Aktywne")
            self.lbl_status.setStyleSheet("color:rgba(120,225,160,230);background:transparent;")
            self.btn_pause.setText("\u23F8"); self.btn_pause.setToolTip("Wstrzymaj")
        else:
            self.lbl_status.setText("\u25CF  Wstrzymane")
            self.lbl_status.setStyleSheet("color:rgba(235,190,110,230);background:transparent;")
            self.btn_pause.setText("\u25B6"); self.btn_pause.setToolTip("Wzn\u00F3w")
        aud = bool(APP_SETTINGS.get("audio_enabled", False))
        col = "rgba(220,230,255,210)" if aud else "rgba(120,128,160,150)"
        self.btn_audio.setStyleSheet(
            "QPushButton{background:rgba(60,65,110,120);color:%s;"
            "border:none;border-radius:6px;font-size:12px;}"
            "QPushButton:hover{background:rgba(80,90,150,180);}" % col)
        self.btn_audio.setToolTip("D\u017Awi\u0119k: " + ("w\u0142." if aud else "wy\u0142."))

    def _refresh_learn(self):
        ov = self.app_ref.overlay
        if getattr(ov, "_is_custom", False):
            self.lbl_learn.setText("W\u0142asny zestaw \u00B7 " + (ov.cat or "\u2014"))
        elif ov.cat:
            self.lbl_learn.setText("%s \u00B7 %s \u00B7 %s" % (lang_label(ov.lang), ov.level, ov.cat))
        else:
            self.lbl_learn.setText("Nie wybrano \u2014 kliknij \u201EZmie\u0144 nauk\u0119\u201D")

    def _refresh_live(self):
        ov = self.app_ref.overlay
        if ov.cards and 0 <= ov.index < len(ov.cards):
            c = ov.cards[ov.index]
            self.mir_word.setText(c.get("word", ""))
            self.mir_tr.setText(c.get("translation", ""))
        else:
            self.mir_word.setText("\u2014"); self.mir_tr.setText("")

    def _refresh_footer(self):
        if getattr(self.app_ref, "_is_premium", False):
            self.lbl_footer.setText("Plan: PRO")
            self.lbl_footer.setCursor(Qt.CursorShape.ArrowCursor)
            self._footer_upgradable = False
        else:
            self.lbl_footer.setText("Plan: FREE  \u00B7  Ulepsz do PRO")
            self.lbl_footer.setCursor(Qt.CursorShape.PointingHandCursor)
            self._footer_upgradable = True

    def _footer_click(self):
        if getattr(self, "_footer_upgradable", False):
            self.hide()
            self.app_ref._show_premium()

    def _refresh_stats(self):
        ov = self.app_ref.overlay
        self.cell_sess.setText(str(getattr(ov, "_cards_shown", 0)))
        if ov.lang and ov.cat and not getattr(ov, "_is_custom", False):
            self._kw = KnownWordsWorker(ov.lang, ov.level, ov.cat)
            self._kw.done.connect(lambda n: self.cell_known.setText(str(n)))
            self._kw.start()
        else:
            self.cell_known.setText("\u2013")
        if ov.lang:
            self._dw = DueCountWorker(ov.lang)
            self._dw.done.connect(lambda n: self.cell_due.setText(str(n)))
            self._dw.start()
        else:
            self.cell_due.setText("\u2013")

    # ── akcje paska statusu ──
    def _toggle_pause(self):
        paused = getattr(self.app_ref, "_pause_until", None) is not None
        hidden = not getattr(self.app_ref, "visible", True)
        if paused or hidden:
            self.app_ref.resume_now()
        else:
            self._enter_pause()

    def _toggle_audio(self):
        APP_SETTINGS["audio_enabled"] = not bool(APP_SETTINGS.get("audio_enabled", False))
        try: save_settings(APP_SETTINGS)
        except Exception: pass
        self._refresh_status()

    def _tick(self):
        if self.pause_panel.isVisible():
            self._update_countdown()
        else:
            self._refresh_live()

    def _enter_pause(self):
        self._set_preset("30", 30)   # domyślnie 30 min

    def _set_preset(self, key, mins):
        self.app_ref.pause_for(mins)
        self._active_content.hide(); self.pause_panel.show()
        for k, b in self._preset_btns.items():
            b.setStyleSheet(self._PRESET_ON if k == key else self._PRESET_OFF)
        self._refresh_status(); self._update_countdown()

    def exit_pause_view(self):
        self.pause_panel.hide(); self._active_content.show()
        if self.isVisible():
            self._refresh_status(); self._refresh_stats()

    def _resume(self):
        self.app_ref.resume_now()   # wywoła exit_pause_view()

    def _update_countdown(self):
        until = getattr(self.app_ref, "_pause_until", None)
        if not until:
            self.lbl_countdown.setText(""); return
        import time as _t
        rem = int(until - _t.time())
        if rem <= 0:
            self.exit_pause_view(); return
        from datetime import datetime, timedelta
        back = (datetime.now() + timedelta(seconds=rem)).strftime("%H:%M")
        mins = rem // 60
        if mins >= 60:
            txt = "Wr\u00F3c\u0105 o %s \u00B7 za %dh %dmin" % (back, mins // 60, mins % 60)
        elif mins >= 1:
            txt = "Wr\u00F3c\u0105 o %s \u00B7 za %d min" % (back, mins)
        else:
            txt = "Wr\u00F3c\u0105 o %s \u00B7 za %d s" % (back, rem % 60)
        self.lbl_countdown.setText(txt)

    def paintEvent(self, e):
        _paint_bg(self, e)


class TrayApp:
    def __init__(self, app, overlay, login_window):
        self.app          = app
        self.overlay      = overlay
        self.login_window = login_window
        self.visible      = True
        self._pause_until = None
        self._lang        = "en"
        self._lvl         = "A1"

        self.win_premium = PremiumCodeWindow()
        self.win_premium.activated.connect(self._on_premium_activated)
        self.win_settings = SettingsWindow()
        self.win_settings.settings_changed.connect(self._on_settings_changed)
        self.win_settings.go_back.connect(self._settings_back_to_hub)
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

        self.win_hub = HubWindow(self)

        self.tray = QSystemTrayIcon(make_tray_icon())
        self.tray.setToolTip("Fiszki w tle")

        menu = QMenu()
        self.act_toggle = menu.addAction("⏸  Ukryj fiszki")
        self.act_toggle.triggered.connect(self._toggle)
        menu.addAction("Otwórz panel").triggered.connect(self._toggle_hub)  # awaryjne wejście
        menu.addSeparator()
        menu.addAction("Wyloguj").triggered.connect(self._logout)
        menu.addAction("✖  Zamknij").triggered.connect(self._quit)

        self.tray.setContextMenu(menu)
        self.tray.activated.connect(
            lambda r: self._toggle_hub() if r == QSystemTrayIcon.ActivationReason.Trigger else None
        )
        self.tray.show()

    def _toggle_hub(self):
        if self.win_hub.isVisible():
            self.win_hub.hide()
        else:
            self.win_hub.open()

    def _show_lang(self):
        self.win_cat.hide(); self.win_lvl.hide()
        self.win_lang.show(); self.win_lang.raise_(); self.win_lang.activateWindow()

    def _show_subscription_required(self):
        """Pokaż okno informujące o wymogu subskrypcji."""
        msg = QMessageBox()
        msg.setWindowTitle("Funkcja Premium")
        msg.setText("Własne zestawy fiszek\n\nTa funkcja dostępna jest tylko w subskrypcji Premium.\n\n39 zł/mies lub 329 zł/rok · wszystkie poziomy + własne fiszki")
        msg.setIcon(QMessageBox.Icon.Information)
        btn_sub = msg.addButton("Kup subskrypcję", QMessageBox.ButtonRole.AcceptRole)
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
        self.win_purchase.show_for("premium_monthly", "Premium", "Subskrypcja", user_email)

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
            self._show_purchase_subscription()
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
            # card_key w srs_progress buduje się z treści (word|translation),
            # więc samo flashcard_id nie wystarczy — dokładamy mapę kart z testu.
            card_map = {}
            try:
                for c in (self.win_test.cards or []):
                    _fid = c.get("flashcard_id", 0)
                    if _fid:
                        card_map[_fid] = c
            except Exception:
                card_map = {}
            self._srs_worker = SRSUpdateWorker(results, card_map, self.overlay.lang)
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
        self._show_purchase_subscription()

    def _show_stats(self):
        self.win_stats.load()
        self.win_stats.show()
        self.win_stats.raise_()
        self.win_stats.activateWindow()

    def _on_premium_activated(self):
        """Po aktywacji kodu — odśwież pełny profil z bazy."""
        self._load_profile()


    def _settings_back_to_hub(self):
        """Powrót z Ustawień do panelu (hub)."""
        self.win_settings.hide()
        try:
            self.win_hub.open()
        except Exception:
            self._toggle_hub()

    def load_user_stats(self):
        """Wczytaj pełny profil gracza."""
        self._profile_worker = ProfileWorker()
        self._profile_worker.done.connect(self._on_profile_loaded)
        self._profile_worker.start()

    def _on_profile_loaded(self, profile):
        is_premium    = _premium_active(profile)
        levels_bought = profile.get("levels_bought", []) or []
        # Upewnij się że to lista
        if isinstance(levels_bought, str):
            try:
                levels_bought = json.loads(levels_bought)
            except Exception:
                levels_bought = []
        if not isinstance(levels_bought, list):
            levels_bought = []
        self._is_premium    = is_premium
        self._levels_bought = levels_bought
        # DIAGNOSTYKA: dokładnie co dociera do bramy dostępu
        _dbg(f"[PREMIUM] is_premium={is_premium!r}  raw={profile.get('is_premium')!r}  "
              f"premium_until={profile.get('premium_until')!r}  levels_bought={levels_bought}")
        # Premium ustawiamy PIERWSZE — żeby nic (workery/wyjątki) go nie wyprzedziło
        try:
            self.win_lvl.set_premium(is_premium)
            self.win_lvl.set_bought_levels(levels_bought)
            self.win_cat.set_premium(is_premium, levels_bought)
        except Exception as e:
            print(f"[PREMIUM] propagacja: {e}")
        lang  = self.overlay.lang or "en"
        level = self.overlay.level or "A1"
        cat   = self.overlay.cat or None
        self._known_worker = KnownWordsWorker(lang, level, cat)
        self._known_worker.done.connect(self.overlay.set_known_words)
        self._known_worker.start()
        self._load_completed_cats(self.overlay.lang or "en")

    def _load_profile(self):
        """Odśwież profil użytkownika po zakupie."""
        self._profile_worker = ProfileWorker()
        self._profile_worker.done.connect(self._on_profile_loaded)
        self._profile_worker.start()

    def _show_shop_from_cat(self):
        """Zablokowana kategoria → oferta subskrypcji Premium."""
        self.win_cat.hide()
        self._show_purchase_subscription()

    def _show_purchase(self, price_key: str):
        """Zablokowany poziom → oferta subskrypcji Premium (odblokowuje wszystko)."""
        self._show_purchase_subscription()

    def _on_purchase_done(self):
        """Po zakupie — odśwież profil i poziomy."""
        def _refresh_after_load(profile):
            is_premium    = _premium_active(profile)
            levels_bought = profile.get("levels_bought", []) or []
            self._is_premium    = is_premium
            self._levels_bought = levels_bought
            self.win_lvl.set_premium(is_premium)
            self.win_lvl.set_bought_levels(levels_bought)

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
        if _keyboard_available:
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
            self._pause_until = None
            if hasattr(self, "_pause_timer"): self._pause_timer.stop()
            self.overlay.show()
            self.act_toggle.setText("⏸  Ukryj fiszki")
            if self.overlay.cat:
                _session.slides_started(self.overlay.lang, self.overlay.level, self.overlay.cat)
            _session.track("slides_shown")
        self.visible = not self.visible

    def pause_for(self, minutes):
        """D4 — czasowe wstrzymanie fiszek z auto-wznowieniem.
        minutes=None → do jutra (09:00)."""
        import time as _t
        if minutes is None:
            from datetime import datetime, timedelta
            now = datetime.now()
            target = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
            secs = max(60, int((target - now).total_seconds()))
        else:
            secs = int(minutes) * 60
        self._pause_until = _t.time() + secs
        if self.visible:
            self.overlay.hide()
            self.visible = False
            self.act_toggle.setText("▶  Pokaż fiszki")
            _session.slides_stopped()
            _session.track("slides_paused", {"minutes": minutes if minutes else "till_tomorrow"})
        if not hasattr(self, "_pause_timer"):
            self._pause_timer = QTimer()
            self._pause_timer.setSingleShot(True)
            self._pause_timer.timeout.connect(self.resume_now)
        self._pause_timer.stop()
        self._pause_timer.start(int(secs * 1000))

    def resume_now(self):
        """D4 — wznów fiszki (auto lub „Wznów teraz”)."""
        self._pause_until = None
        if hasattr(self, "_pause_timer"):
            self._pause_timer.stop()
        if not self.visible:
            self.overlay.show()
            self.visible = True
            self.act_toggle.setText("⏸  Ukryj fiszki")
            if self.overlay.cat:
                _session.slides_started(self.overlay.lang, self.overlay.level, self.overlay.cat)
            _session.track("slides_resumed")
        if hasattr(self, "win_hub"):
            self.win_hub.exit_pause_view()

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
            self.overlay.lbl_info.setText("Audio włączone")
            if self.overlay.cards:
                card = self.overlay.cards[self.overlay.index]
                word = card.get("word", "")
                lang = self.overlay.lang or "en"
                if lang == "jp" and "(" in word:
                    word = word.split("(")[0].strip()
                speak_word(word, lang)
        else:
            self.overlay.lbl_info.setText("Audio wyłączone")
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
                  self.win_settings, self.win_custom]:
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
try:
    import platform as _pf_kb
    if _pf_kb.system() == "Darwin":
        # macOS: biblioteka `keyboard` wymaga uprawnień roota i potrafi wywalić start.
        # Skróty globalne są tam wyłączone świadomie — aplikacja działa z tray/menu.
        raise ImportError("macOS: globalne skróty wymagają roota — wyłączone")
    import keyboard
    _keyboard_available = True
except Exception as _kb_err:
    keyboard = None
    _keyboard_available = False
    print(f"[HOTKEY] Globalne skróty niedostępne (biblioteka 'keyboard': {_kb_err}). "
          f"Na macOS/Linux mogą wymagać uprawnień administratora, a Wayland je blokuje. "
          f"Aplikacja działa dalej.")
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
    if not _keyboard_available:
        return
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
def _apply_macos_accessory():
    """macOS: aplikacja żyje w pasku menu (tray), bez ikony w Docku — polityka accessory."""
    import platform as _pf
    if _pf.system() != "Darwin":
        return
    try:
        from AppKit import NSApp
        # NSApplicationActivationPolicyAccessory = 1 (bez ikony w Docku, bez wymuszania aktywacji)
        NSApp().setActivationPolicy_(1)
    except Exception as e:
        print(f"[macOS] Nie ustawiono polityki 'accessory' (brak pyobjc?): {e}")


def _warn_if_no_tray():
    """Linux/GNOME często nie ma natywnego zasobnika (wymaga rozszerzenia AppIndicator/StatusNotifier)."""
    try:
        if QSystemTrayIcon.isSystemTrayAvailable():
            return
    except Exception:
        return
    try:
        QMessageBox.information(
            None, "Eyelingo — brak zasobnika systemowego",
            "Nie wykryto zasobnika systemowego (tray).\n\n"
            "Na GNOME/Wayland wymaga on rozszerzenia typu AppIndicator / StatusNotifier.\n\n"
            "Aplikacja działa dalej, ale ikona i menu w zasobniku mogą być niewidoczne."
        )
    except Exception:
        print("[TRAY] Brak zasobnika — na GNOME wymagane rozszerzenie AppIndicator/StatusNotifier.")


def _apply_font_substitutions():
    """UI był pisany pod 'Segoe UI' (Windows). Na macOS tej rodziny nie ma — Qt
    zjeżdża wtedy na siermiężny fallback. Podstawienie rodziny to jedna linia
    i naprawia typografię na całym UI, bez ruszania setek QFont(...)."""
    import platform as _pf_f
    try:
        if _pf_f.system() == "Darwin":
            QFont.insertSubstitutions("Segoe UI", ["Inter", "SF Pro Text", "Helvetica Neue"])
    except Exception:
        pass


def main():
    _dbg_reset()
    _dbg("=== APP START ===")
    _dbg(f"[SESSION] plik sesji: {SESSION_FILE}")
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    _apply_font_substitutions()
    _apply_macos_accessory()

    overlay      = FlashcardOverlay()
    overlay.hide()
    login_window = LoginWindow()

    def on_logged_in(_session):
        try:
            _tok = None
            try:
                _cur = supabase.auth.get_session()
                _tok = getattr(_cur, "access_token", None) or \
                       getattr(getattr(_cur, "session", None), "access_token", None)
            except Exception:
                pass
            _sync_postgrest_token(_tok)
            _dbg(f"[SESSION] on_logged_in: token={'OK' if _tok else 'BRAK'}")
        except Exception:
            pass
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
    _warn_if_no_tray()
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

    