<div align="center">

# Eyelingo

**An AI-powered language-learning platform — built and shipped to production by one person.**

Web · installable mobile PWA · desktop app &nbsp;•&nbsp; 14 languages &nbsp;•&nbsp; ~56,000 learning items &nbsp;•&nbsp; A1–C2

[eyelingo.app](https://eyelingo.app)

</div>

---

## What this is

Eyelingo helps adults actually *use* a language they already half-know, instead of collecting points. It runs an AI lesson engine, spaced-repetition review over tens of thousands of items, a grammar engine across 14 languages, and a conversation partner — all on a serverless backend, with subscriptions and EU-hosted data.

I designed it, built it, and shipped it on my own, from the first idea to paying users. This repository is that product.

## How I work — and what this repo is evidence of

I treat a language model as an **executor, not an oracle**. My job is to decide what has to exist and how to tell whether it came out right; the model does the producing. Concretely, that means:

- **Specification first.** Before anything gets built, I write down what should happen, in what order, what the exceptions are, and what to do when it fails. The product is governed by a set of versioned design documents, and every change is designed against them.
- **Predictable AI output.** The model answers in an enforced format, the output is validated on return, and there is a fallback path when it doesn't match. A model that "says whatever" is useless in production — so it never gets to.
- **Decomposition and order.** A big goal is cut into pieces each finishable in one pass, sequenced so they don't block each other. "Done" means: I walked the whole path myself, as a user, and it works.
- **One source of truth.** Progress lives in one place; three clients read from it. New versions ship behind a switch so they can be turned off in seconds. Nothing is deleted that could still be needed.

That discipline — not raw coding speed — is why one person could ship this across three platforms in a few months.

## Architecture at a glance

| Layer | What it does | Built with |
|---|---|---|
| **AI lesson engine** | Multi-step, state-machine lesson flow: start → generate → evaluate answer → complete/resume, with server-side state | Serverless edge functions (Deno / TypeScript), Anthropic Claude via OpenRouter |
| **Adaptive review** | SM-2 spaced repetition over ~56,000 items, per-item memory model from response-latency and exposure signals, CEFR-keyed difficulty | PostgreSQL |
| **Grammar engine** | Rule banks A1–C2 across 14 languages, prerequisite graph, progress tracking | JSON grammar banks + `grammar-engine.js` |
| **Data** | Normalised schema, Row-Level Security on every table, RPC functions, single source of truth shared by 3 clients | Supabase / PostgreSQL (EU region) |
| **Clients** | Vanilla-JS single-page web app, installable offline-first PWA, PyQt6 desktop companion | JS / HTML / CSS, Python |
| **Integrations** | Subscriptions, text-to-speech behind a proxy with a Web Speech fallback, first-party event analytics | Stripe, ElevenLabs |
| **Delivery** | CI build matrix for Windows/macOS, packaged installers, auto-update over the GitHub Releases API | GitHub Actions, PyInstaller, Inno Setup |

## Repository map

| Path | What's inside |
|---|---|
| `index.html` | The web application (single-page, vanilla JS) |
| `app.html` / `eyelingo-app.html` | Mobile PWA surface |
| `fiszki_app.py` | Desktop companion app (PyQt6) |
| `grammar-engine.js`, `data/grammar/`, `grammar-bank.*.json` | Grammar engine and per-language rule banks |
| `.github/workflows/` | CI: cross-platform build and release automation |
| `installer/`, `eyelingo.spec` | Desktop packaging |
| `service-worker.js`, `manifest.json` | PWA / offline support |
| `nauka/` | SEO content hub |
| `freak/` | A small interactive piece I built as a job application — a recruitment puzzle, not part of the product |
| `sitemap.xml`, `robots.txt` | SEO plumbing |

## A note on scope

This is a real, running commercial product, not a demo — so this public repository is the front-end, client, and engine layer. Secrets, API keys, and paid infrastructure live in server-side environment variables and Supabase Edge Functions, never in the code here.

## About

Built by **Adrian Wojtasik** — English teacher turned AI product builder, now studying Psychology & Computer Science.
I turn fuzzy ideas into working, reliable systems by pairing clear specifications with AI as the executor.

📧 eyeamadrian@gmail.com &nbsp;•&nbsp; 🌐 [eyelingo.app](https://eyelingo.app)
