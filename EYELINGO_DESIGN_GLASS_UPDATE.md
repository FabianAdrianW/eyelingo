# EYELINGO — Design: spójność strona / mobile / desktop (Glass update)

Cel nadrzędny: **jeden wizerunek Eyelingo** na stronie (`index.html`), w aplikacji mobilnej (`app.html`) i w programie (`fiszki_app.py`).

## 1. Tokeny wspólne

| Token | Wartość | Uwaga |
|---|---|---|
| navy | `#1a2340` / `#0f1729` | tło ciemne, tekst główny |
| akcent (jasne tło) | `#A94C13` (hover `#8F3D0C`) | biel na nim 5,63:1 / 7,39:1 (AA) |
| akcent (ciemne tło) | `#E4823C`; gradient CTA `#f0924d → #d8742e`, tekst `#1b1205` | desktop używa `#e0803a` |
| papier | `#f8f7f4` / `#FAF8F3` | tło jasne |
| promienie | pola 12–14, przyciski 14–16 (web: pigułka 999), karty 22–26 | |
| ease | `cubic-bezier(.3,1.4,.5,1)` (sprężyna), wyjście `cubic-bezier(.4,0,.2,1)` | |
| czasy | wejście ~250 ms, wyjście ~150 ms | |

## 2. Zasady
- **Jeden pomarańczowy CTA na ekran.** Reszta: secondary (obrys) i ghost.
- **Nacisk:** `scale(.97)`; **uniesienie** 1–2 px wyłącznie w `@media(hover:hover)`.
- **Focus-visible:** pierścień akcentu 2 px + halo 3 px (na ciemnym tle jasny akcent).
- **Pola formularzy:** promień 12, focus = obrys akcentu + halo.
- **Glass** (półprzezroczystość + cienka ramka + delikatny highlight u góry) tylko na ciemnych tłach; na jasnych karty glass-jasne.
- **Wejście sekcji:** sama przezroczystość (bez przesunięć → brak layout shift).
- **`prefers-reduced-motion`:** wyłącza animacje, uniesienia i skalowanie.
- Typografia bez zmian (Inter / DM Sans); **logo i wordmark nietykalne**.

## 3. Antywzorce
- ❌ Kolorowe plamy / poświaty (blob, glow) w tle — nigdzie.
- ❌ Zaznaczenie (wybrany kafel/poziom), w którym tekst robi się biały na jasnym tle. Zaznaczenie = ciemny/akcentowy tekst na jasnym tle albo biały na pełnym akcencie AA.
- ❌ Biały tekst na `#c96a2a` (3,76:1) — używać `#A94C13` lub `#b85c20`.
- ❌ Więcej niż jeden pomarańczowy CTA na ekranie.
- ❌ Zmiana fontu/logo „dla spójności”.

## 4. Implementacja na stronie
Jeden addytywny blok `<style id="eyl-brand-consistency">` na końcu `index.html`. Usunięcie bloku = pełny powrót do poprzedniego wyglądu.

## 5. Otwarta decyzja
Kształt przycisków: web = pigułka (999), mobile = ~10 px, desktop = 14–16 px. Na razie niezmienione (pigułki na landingu to świadoma decyzja v3).
