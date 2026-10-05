# Jak wprowadzam zmiany w Eyelingo

Każda zmiana to jeden commit z opisem **co i dlaczego** – bez „Add files via upload”.

## Codzienna praca (GitHub Desktop)

1. **Fetch origin** – pobierz aktualny stan.
2. Podmień albo edytuj pliki w folderze repo.
3. W polu **Summary** wpisz `<obszar>: <co>`, w **Description** – dlaczego.
4. **Commit to main** → **Push origin**.

Jedna sprawa = jeden commit. Dwie niezwiązane poprawki to dwa commity (odznacz pliki drugiej przy pierwszym).

## Format opisu

```
www: demo bez konta zapisuje postęp po rejestracji

Gość tracił 10 przerobionych fiszek po założeniu konta.
eylDemoMigrate przenosi je teraz do Powtórek.
```

Obszary: `www` (index.html), `pwa` (app.html), `desktop` (fiszki_app.py), `gramatyka`, `baza` (migracje SQL), `seo` (nauka/, sitemap, llms.txt), `ci` (.github/workflows), `docs`.

## Wiersz poleceń (opcjonalnie)

```
git config commit.template .gitmessage
git add -p && git commit
```

Zmiany w bazie trafiają do repo jako pliki migracji SQL, nigdy tylko do panelu Supabase.
