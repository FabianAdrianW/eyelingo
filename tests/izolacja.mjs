#!/usr/bin/env node
// Eyelingo – test izolacji danych. Node 18+, zero zależności.
//
//   node tests/izolacja.mjs                 → testy „z ulicy” (tylko klucz publiczny, nic nie zapisuje)
//   A_EMAIL=… A_PASS=… B_EMAIL=… B_PASS=… node tests/izolacja.mjs
//                                           → pełny test: konto B próbuje dobrać się do danych konta A
//   …z dopiskiem REPORT=1                   → przy błędach dopisuje wpis do Zgłoszeń (bug_reports) jako konto A
//
// Konta A i B to zwykłe konta testowe założone w aplikacji. Test sprząta po sobie.
// Kod wyjścia: 0 = szczelne, 1 = znaleziono dziurę.

const URL_ = process.env.SUPABASE_URL || 'https://sntlgkhktscezxpxrchl.supabase.co';
const KEY = process.env.SUPABASE_KEY || 'sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8'; // publiczny, ten sam co w index.html
const { A_EMAIL, A_PASS, B_EMAIL, B_PASS, REPORT } = process.env;

const results = [];
const ok = (name) => { results.push({ name, pass: true }); console.log('  ✅', name); };
const bad = (name, why) => { results.push({ name, pass: false, why }); console.log('  ❌', name, '—', why); };
const skip = (name, why) => console.log('  ⏭️ ', name, '—', why);

const hdr = (token) => ({ apikey: KEY, Authorization: `Bearer ${token || KEY}`, 'Content-Type': 'application/json' });
async function api(path, { token, method = 'GET', body, prefer } = {}) {
  const r = await fetch(URL_ + path, {
    method, headers: { ...hdr(token), ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* nie-JSON */ }
  return { status: r.status, json, text };
}
async function login(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!r.json?.access_token) throw new Error(`logowanie ${email} nieudane (${r.status})`);
  return { token: r.json.access_token, id: r.json.user.id, email };
}
const rows = (r) => (Array.isArray(r.json) ? r.json.length : 0);

// ── 1. Niezalogowany (sam klucz publiczny) ──────────────────────────────────
const PRIVATE_TABLES = [
  'srs_progress', 'word_progress', 'user_set_cards?set_id=not.is.null&select=id,user_sets!inner(is_public)&user_sets.is_public=eq.false',
  'user_sets?is_public=eq.false', 'user_collections', 'profiles', 'learning_stats', 'lex_lessons', 'lex_profiles',
  'lesson_state', 'word_knowledge', 'gap_catalog', 'notebook', 'chat_usage', 'ai_usage_daily', 'user_state',
  'user_preferences', 'user_purchases', 'bug_reports', 'tutor_messages', 'tutor_contacts', 'notifications',
  'analytics_events', 'telemetry_events', 'exposure_events', 'desktop_daily_stats', 'premium_codes', 'analytics_admins',
];
async function anonTests() {
  console.log('\n1. Niezalogowany – prywatne tabele mają być puste');
  for (const t of PRIVATE_TABLES) {
    const name = t.split('?')[0];
    const r = await api(`/rest/v1/${t}${t.includes('?') ? '&' : '?'}limit=1`);
    if (r.status >= 500) skip(name, `HTTP ${r.status}`);
    else if (rows(r) > 0) bad(`anon nie czyta ${name}`, 'zwrócono wiersze');
    else ok(`anon nie czyta ${name}`);
  }

  console.log('\n2. Niezalogowany – funkcje, które nie powinny być dostępne');
  const zero = '00000000-0000-0000-0000-000000000000';
  const RPCS = [
    ['boost_word_priority', { p_user_id: zero, p_flashcard_id: zero, p_days: 0 }],
    ['get_ranking', { p_period: 'all' }],
    ['admin_overview', { p_days: 1 }],
    ['admin_qual', { p_limit: 1 }],
  ];
  for (const [fn, args] of RPCS) {
    const r = await api(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args });
    if (r.status >= 200 && r.status < 300) bad(`anon nie wywoła ${fn}`, `HTTP ${r.status}`);
    else ok(`anon nie wywoła ${fn}`);
  }

  console.log('\n3. Niezalogowany – funkcje Edge');
  let r = await api('/functions/v1/get-openrouter-key', { method: 'POST', body: {} });
  if (r.json?.key) bad('get-openrouter-key nie oddaje klucza (anon)', 'ODDAŁA KLUCZ'); else ok('get-openrouter-key nie oddaje klucza (anon)');
  r = await api('/functions/v1/super-endpoint', { method: 'POST', body: { messages: [], max_tokens: 1 } });
  if (r.status === 429 || r.status === 401) ok('super-endpoint odrzuca anon'); else bad('super-endpoint odrzuca anon', `HTTP ${r.status}`);
  r = await api('/functions/v1/desktop-sync', { method: 'POST', body: {} });
  if (r.status === 401) ok('desktop-sync odrzuca anon'); else bad('desktop-sync odrzuca anon', `HTTP ${r.status}`);
  r = await api('/functions/v1/delete-account', { method: 'POST', body: {} });
  if (r.status === 401) ok('delete-account odrzuca anon'); else bad('delete-account odrzuca anon', `HTTP ${r.status}`);
  r = await api('/functions/v1/lesson-start', { method: 'POST', body: {} });
  if (r.status === 401) ok('lesson-start (Ailex) odrzuca anon'); else bad('lesson-start (Ailex) odrzuca anon', `HTTP ${r.status}`);
}

// ── 2. Dwa konta: B atakuje A ───────────────────────────────────────────────
async function crossTests() {
  if (!(A_EMAIL && A_PASS && B_EMAIL && B_PASS)) {
    console.log('\n4–6. Test dwóch kont pominięty (ustaw A_EMAIL, A_PASS, B_EMAIL, B_PASS).');
    return null;
  }
  const A = await login(A_EMAIL, A_PASS), B = await login(B_EMAIL, B_PASS);
  const tag = 'izolacja-test-' + Date.now();
  let setId = null, srsMade = false;
  try {
    console.log('\n4. Moje zestawy – B nie widzi prywatnego zestawu A');
    let r = await api('/rest/v1/user_sets', { token: A.token, method: 'POST', prefer: 'return=representation',
      body: { user_id: A.id, name: tag, is_public: false } });
    setId = r.json?.[0]?.id ?? null;
    if (!setId) skip('zestaw testowy', `nie udało się utworzyć (HTTP ${r.status})`);
    else {
      await api('/rest/v1/user_set_cards', { token: A.token, method: 'POST', body: { set_id: setId, word: tag, translation: 'x' } });
      r = await api(`/rest/v1/user_sets?id=eq.${setId}`, { token: B.token });
      rows(r) ? bad('B nie czyta zestawu A', 'zwrócono wiersz') : ok('B nie czyta zestawu A');
      r = await api(`/rest/v1/user_set_cards?set_id=eq.${setId}`, { token: B.token });
      rows(r) ? bad('B nie czyta kart A', 'zwrócono wiersze') : ok('B nie czyta kart A');
      r = await api(`/rest/v1/user_sets?id=eq.${setId}`, { token: B.token, method: 'PATCH', prefer: 'return=representation', body: { name: 'hacked' } });
      rows(r) ? bad('B nie zmienia zestawu A', 'zmieniono') : ok('B nie zmienia zestawu A');
      r = await api('/rest/v1/user_set_cards', { token: B.token, method: 'POST', prefer: 'return=representation', body: { set_id: setId, word: 'intruz', translation: 'x' } });
      rows(r) ? bad('B nie dopisuje kart do zestawu A', 'dopisano') : ok('B nie dopisuje kart do zestawu A');
      r = await api(`/rest/v1/user_sets?id=eq.${setId}`, { token: B.token, method: 'DELETE', prefer: 'return=representation' });
      rows(r) ? bad('B nie usuwa zestawu A', 'usunięto') : ok('B nie usuwa zestawu A');
    }

    console.log('\n5. Powtórki (srs_progress) i dane konta');
    r = await api('/rest/v1/srs_progress', { token: A.token, method: 'POST', prefer: 'return=representation',
      body: { user_id: A.id, card_key: tag, word: tag, translation: 'x', lang: 'en', source: 'test' } });
    srsMade = rows(r) > 0;
    if (!srsMade) skip('wiersz Powtórek', `nie udało się utworzyć (HTTP ${r.status})`);
    else {
      r = await api(`/rest/v1/srs_progress?card_key=eq.${tag}`, { token: B.token });
      rows(r) ? bad('B nie czyta Powtórek A', 'zwrócono wiersz') : ok('B nie czyta Powtórek A');
      r = await api(`/rest/v1/srs_progress?card_key=eq.${tag}`, { token: B.token, method: 'PATCH', prefer: 'return=representation', body: { repetitions: 99 } });
      rows(r) ? bad('B nie zmienia Powtórek A', 'zmieniono') : ok('B nie zmienia Powtórek A');
    }
    r = await api('/rest/v1/srs_progress', { token: B.token, method: 'POST', prefer: 'return=representation',
      body: { user_id: A.id, card_key: tag + '-b', word: 'intruz', translation: 'x', lang: 'en', source: 'test' } });
    rows(r) ? bad('B nie zapisuje Powtórek jako A', 'zapisano') : ok('B nie zapisuje Powtórek jako A');
    for (const t of ['profiles', 'learning_stats', 'lex_lessons', 'lex_profiles', 'word_knowledge', 'chat_usage', 'bug_reports', 'user_state']) {
      r = await api(`/rest/v1/${t}?user_id=eq.${A.id}&limit=1`, { token: B.token });
      rows(r) ? bad(`B nie czyta ${t} konta A`, 'zwrócono wiersz') : ok(`B nie czyta ${t} konta A`);
    }
    r = await api(`/rest/v1/profiles?user_id=eq.${B.id}`, { token: B.token, method: 'PATCH', prefer: 'return=representation', body: { is_premium: true, premium_until: '2099-01-01' } });
    rows(r) ? bad('B nie nadaje sobie PRO', 'zmieniono profil') : ok('B nie nadaje sobie PRO');
    r = await api('/rest/v1/rpc/increment_gold', { token: B.token, method: 'POST', body: { p_user_id: A.id, p_amount: 0 } });
    r.status < 300 ? bad('B nie wywoła increment_gold na koncie A', `HTTP ${r.status}`) : ok('B nie wywoła increment_gold na koncie A');

    console.log('\n6. Funkcje Edge – tożsamość tylko z tokenu');
    r = await api('/functions/v1/get-openrouter-key', { token: B.token, method: 'POST', body: {} });
    r.json?.key ? bad('get-openrouter-key nie oddaje klucza zalogowanemu', 'ODDAŁA KLUCZ – zrotuj go') : ok('get-openrouter-key nie oddaje klucza zalogowanemu');
    r = await api('/functions/v1/desktop-sync', { token: B.token, method: 'POST', body: { user_id: A.id, limit: 1 } });
    if (r.status !== 200) skip('desktop-sync', `HTTP ${r.status}`);
    else r.json?.user_id === B.id ? ok('desktop-sync ignoruje user_id z body') : bad('desktop-sync ignoruje user_id z body', 'zwrócił dane innego konta');
  } finally {
    if (srsMade) await api(`/rest/v1/srs_progress?card_key=like.${tag}*`, { token: A.token, method: 'DELETE' });
    if (setId) {
      await api(`/rest/v1/user_set_cards?set_id=eq.${setId}`, { token: A.token, method: 'DELETE' });
      await api(`/rest/v1/user_sets?id=eq.${setId}`, { token: A.token, method: 'DELETE' });
    }
  }
  return A;
}

// Kontrola połączenia: publiczny katalog musi odpowiadać, inaczej wyniki byłyby fałszywie „zielone”.
{
  const r = await api('/rest/v1/languages?select=code&limit=1').catch((e) => ({ status: 0, json: null, text: String(e) }));
  if (r.status !== 200 || rows(r) === 0) {
    console.error(`Brak połączenia z Supabase (HTTP ${r.status}) – test przerwany, to NIE jest wynik.`);
    process.exit(2);
  }
}
await anonTests();
const A = await crossTests().catch((e) => { bad('test dwóch kont', String(e.message || e)); return null; });

const fails = results.filter((x) => !x.pass);
console.log(`\nWynik: ${results.length - fails.length}/${results.length} OK` + (fails.length ? ` — DZIURY: ${fails.length}` : ' — szczelne'));
if (fails.length && REPORT && A) {
  const description = `[test izolacji ${new Date().toISOString().slice(0, 10)}] ` + fails.map((f) => `${f.name}: ${f.why}`).join(' | ');
  const r = await api('/rest/v1/bug_reports', { token: A.token, method: 'POST', body: { user_id: A.id, email: A.email, category: 'bezpieczenstwo', description } });
  console.log(r.status < 300 ? 'Zapisano w Zgłoszeniach.' : `Nie udało się zapisać w Zgłoszeniach (HTTP ${r.status}).`);
}
process.exit(fails.length ? 1 : 0);
