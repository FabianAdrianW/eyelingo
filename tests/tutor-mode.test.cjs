// Test trybu nauczyciela (jsdom): cd /tmp && npm i jsdom@24 && NODE_PATH=/tmp/node_modules node <repo>/tests/tutor-mode.test.cjs
const { JSDOM } = require('jsdom');
const fs = require('fs');
const R = __dirname + '/../';
const html = `<!doctype html><body>
<div id="page-community"><div id="mat-main-content">
  <div class="page-head page-head-row"><div><h2 id="mat-main-title">Ucz się z fiszek</h2><p id="mat-main-sub">x</p></div>
  <div><input id="mat-search"><button id="mat-create-ai-btn">Z AI</button><button id="mat-create-btn">Nowy zestaw</button></div></div>
  <div id="mat-continue-wrap"></div><div id="mat-grid"></div>
</div></div></body>`;
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://eyelingo.app/', pretendToBeVisual: true });
const w = dom.window;
let fails = 0;
const t = (name, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : ' :: ' + extra)); if (!ok) fails++; };

// ── atrapa bazy ──
const calls = { upserts: 0, rpc: [], ins: {}, del: [], created: [] };
const state = { pro: true, noDb: false, owner: 'T1', students: [{ link_id: 'L1', student_id: 'S1', label: null, student_name: 'Kasia' }], linkSets: [{ link_id: 'L1', set_id: 7 }], tutors: [] };
function builder(table) {
  const b = {
    _t: table,
    select() { return b; }, eq() { return b; }, in() { return b; }, order() { return b; }, limit() { return b; }, maybeSingle() { return b; }, single() { return b; },
    upsert() { calls.upserts++; return Promise.resolve({ data: null, error: null }); },
    insert(v) { calls.upserts++; (calls.ins[table] = calls.ins[table] || []).push(v); return Promise.resolve({ data: null, error: null }); },
    update() { return b; }, delete() { calls.del.push(table); return b; },
    then(res, rej) {
      let data = [];
      if (table === 'tutor_link_sets') data = state.linkSets;
      if (table === 'user_sets') { data = [{ id: 7, name: 'Zestaw dla Kasi', lang: 'en', user_id: state.owner, user_set_cards: [{ id: 1, word: 'dog', translation: 'pies' }] }]; if (state.newSet) data.push({ id: 99, name: 'Nowy AI', user_id: state.owner, user_set_cards: [] }); }
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return b;
}
w.db = {
  from: builder,
  auth: { getSession: async () => ({ data: { session: { user: { id: 'T1' } } } }), onAuthStateChange() {} },
  rpc: async (name, args) => {
    calls.rpc.push(name);
    if (state.noDb) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + name } };
    if (name === 'tutor_list_students') return { data: state.students, error: null };
    if (name === 'tutor_my_tutors') return { data: state.tutors, error: null };
    if (name === 'tutor_create_link_code') return { data: 'ABCD2345', error: null };
    if (name === 'tutor_preview_code') return { data: args.p_code === 'ABCD2345' ? { ok: true, tutor_name: 'Pani Ania' } : { ok: false, error: 'invalid_code' }, error: null };
    if (name === 'tutor_redeem_code') return { data: { ok: true, link_id: 'L9', tutor_name: 'Pani Ania' }, error: null };
    return { data: null, error: null };
  },
};
w.eylIsPremium = async () => state.pro;
let srsLocal = 0;
w.usrsRecord = async function () { srsLocal++; };
w._usrsSaveAll = function () { srsLocal++; };
let matRendered = 0; w.matRenderMine = function () { matRendered++; };
w.setCard = function (s) { return '<div class="mat-card"><div class="mat-card-count">' + s.name + '</div></div>'; };
w.loadMySets = async function () { w._matSets = []; };
w.showPage = function (n) { w._page = n; };
w.openCreateSet = function () { calls.created.push('manual'); };
w.openCreateSetAI = function () { calls.created.push('ai'); };
w.eylPreviewSet = function () {};
w.eval(fs.readFileSync(R + 'vendor/qrcode-generator.min.js', 'utf8'));
w.eval(fs.readFileSync(R + 'tutor-mode.js', 'utf8'));
const T = w.EylTutor;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await wait(700);
  // 1. normalizacja kodu
  t('normCode: małe litery, myślnik, link', T.normCode('abcd-2345') === 'ABCD2345' && T.normCode('https://eyelingo.app/?join=abcd2345') === 'ABCD2345');
  t('fmtCode', T.fmtCode('ABCD2345') === 'ABCD-2345');

  // 2. QR
  const q = w.qrcode(0, 'M'); q.addData('https://eyelingo.app/?join=ABCD2345'); q.make();
  t('QR generuje SVG', /<svg/.test(q.createSvgTag({ cellSize: 6, margin: 2, scalable: true })));

  // 3. straż zapisu
  await w.db.from('srs_progress').upsert({});
  t('poza trybem nauczyciela: upsert srs_progress przechodzi', calls.upserts === 1, calls.upserts);
  w.usrsRecord(); t('poza trybem: lokalny zapis działa', srsLocal === 1, srsLocal);
  T.setMode(true); await wait(50);
  const before = calls.upserts;
  await w.db.from('srs_progress').upsert({ a: 1 });
  await w.db.from('word_progress').insert({ a: 1 });
  await w.db.from('grammar_progress').update({ a: 1 }).eq('x', 1);
  t('tryb nauczyciela: zapisy do srs/word/grammar progress zablokowane', calls.upserts === before, calls.upserts - before);
  const read = await w.db.from('srs_progress').select('*').eq('user_id', 'x');
  t('tryb nauczyciela: odczyt srs_progress działa', read && Array.isArray(read.data));
  const sl = srsLocal; await w.usrsRecord(); w._usrsSaveAll();
  t('tryb nauczyciela: lokalny cache nie jest zapisywany', srsLocal === sl, srsLocal - sl);
  await w.db.from('user_sets').insert({ name: 'x' });
  t('tryb nauczyciela: inne tabele (user_sets) piszą normalnie', calls.upserts === before + 1, calls.upserts - before);

  // 4. panel nauczyciela
  await wait(100);
  const panel = w.document.getElementById('tutor-panel');
  t('panel istnieje, klasa tutor-on, pill widoczny', !!panel && w.document.getElementById('mat-main-content').classList.contains('tutor-on') && w.document.getElementById('tutor-pill').style.display === 'flex');
  t('lista uczniów renderuje Kasię, inicjał i liczbę zestawów', /Kasia/.test(panel.innerHTML) && /1 zestaw/.test(panel.innerHTML) && /sr-av">K</.test(panel.innerHTML), panel.innerHTML.slice(0, 300));
  t('tytuł strony zmieniony', w.document.getElementById('mat-main-title').textContent === 'Tryb nauczyciela');
  panel.querySelector('.sr').click(); await wait(150);
  t('widok ucznia: zestaw + przyciski bez nakładania (własna stopka „Odepnij”)', /Zestaw dla Kasi/.test(panel.innerHTML) && /Przypisz istniejący/.test(panel.innerHTML) && /Z AI/.test(panel.innerHTML) && !!panel.querySelector('.tc-ft .tc-un'));
  t('zestaw ucznia trafił do _matSets (żeby openSet działał)', (w._matSets || []).some(s => s.id === 7));
  const sw = w.document.getElementById('tutor-toggle-btn');
  t('przełącznik: role=switch, aria-checked=true, klasa on', !!sw && sw.getAttribute('role') === 'switch' && sw.getAttribute('aria-checked') === 'true' && sw.classList.contains('on'));
  t('w trybie nauczyciela ukryte przyciski tworzenia z nagłówka', w.getComputedStyle(w.document.getElementById('mat-create-btn')).display === 'none' && w.getComputedStyle(w.document.getElementById('mat-create-ai-btn')).display === 'none');
  // nowy zestaw z panelu → po zapisie sam trafia do ucznia
  panel.querySelector('[data-a="ai"]').click(); await wait(100);
  t('„Z AI” otwiera kreator AI', calls.created.indexOf('ai') >= 0, calls.created);
  state.newSet = true; await w.loadMySets(); await wait(300);
  const li = (calls.ins.tutor_link_sets || []).reduce((a, x) => a.concat(x), []);
  t('nowy zestaw sam przypisany do ucznia (set 99, link L1)', li.some(r => r.set_id === 99 && r.link_id === 'L1'), JSON.stringify(calls.ins));
  state.newSet = false;
  panel.querySelector('[data-a="unpin"]').click(); await wait(80);
  w.document.querySelector('.tmd [data-x="1"]').click(); await wait(150);
  t('odepnij: potwierdzenie → delete na tutor_link_sets', calls.del.indexOf('tutor_link_sets') >= 0, calls.del);
  // zakres: poza „Moje fiszki" tryb się wyłącza, nauka z panelu go zachowuje
  panel.querySelector('[data-a="srs"]') && panel.querySelector('[data-a="srs"]').click();
  w.showPage('tryb'); t('nauka uruchomiona z panelu: tryb zostaje', T.on());
  w.showPage('community'); await wait(80); t('powrót do Moje fiszki: tryb zostaje', T.on());
  T._test.forgetStudy(); w.showPage('dash'); t('wyjście do innej sekcji wyłącza tryb', !T.on() && !w.document.getElementById('mat-main-content').classList.contains('tutor-on'));
  T.setMode(true); await wait(150);

  // 5. kod zaproszenia
  panel.querySelector('[data-a="add"]').click(); await wait(150);
  const code = w.document.getElementById('tmd-code');
  t('modal kodu: pokazuje ABCD-2345 i QR', !!code && code.textContent === 'ABCD-2345' && !!w.document.querySelector('.tmd-qr svg'));
  w.document.getElementById('tmd-ok').click(); await wait(100);

  // 6. wyłączenie trybu przywraca zapis
  T.setMode(false); await wait(50);
  const b2 = calls.upserts; await w.db.from('srs_progress').upsert({ z: 1 });
  t('po wyłączeniu trybu zapis wraca', calls.upserts === b2 + 1);
  t('pill ukryty, klasa zdjęta', w.document.getElementById('tutor-pill').style.display === 'none' && !w.document.getElementById('mat-main-content').classList.contains('tutor-on'));

  // 7. FREE nie włączy
  state.pro = false; await T.toggle(); await wait(100);
  t('FREE: toggle nie włącza trybu i pokazuje info', !T.on() && /jest w PRO/.test(w.document.body.innerHTML));
  w.document.querySelectorAll('.tmd-ov').forEach(e => e.remove()); state.pro = true;

  // 8. uczeń: dołączanie
  T.join('abcd-2345'); await wait(50);
  const inp = w.document.getElementById('tmd-c');
  t('join: pole wstępnie wypełnione', inp && inp.value === 'ABCD-2345');
  w.document.getElementById('tmd-go').click(); await wait(200);
  t('join: ekran potwierdzenia z imieniem nauczyciela', /Pani Ania/.test(w.document.querySelector('.tmd').innerHTML) && /nie widzi/.test(w.document.querySelector('.tmd').innerHTML));
  w.document.getElementById('tmd-ok2').click(); await wait(200);
  t('join: redeem wywołany, modal zamknięty', calls.rpc.indexOf('tutor_redeem_code') >= 0 && !w.document.querySelector('.tmd-ov'));
  T.join('ZZZZ9999'); w.document.getElementById('tmd-go').click(); await wait(200);
  t('join: zły kod → komunikat', /Nieprawidłowy lub wygasły/.test(w.document.getElementById('tmd-e').textContent));
  w.document.querySelectorAll('.tmd-ov').forEach(e => e.remove());

  // 9. zestawy nauczyciela doklejone uczniowi
  state.owner = 'T1x'; state.tutors = [{ link_id: 'L1', tutor_id: 'T1x', tutor_name: 'Pani Ania' }];
  state.linkSets = [{ link_id: 'L1', set_id: 7 }];
  w.document.getElementById('mat-continue-wrap').parentNode; // istnieje
  await w.loadMySets(); await wait(300);
  const s7 = (w._matSets || []).filter(s => s.id === 7)[0];
  t('uczeń: zestaw nauczyciela dołączony z _tutor', !!s7 && s7._tutor === 'Pani Ania', JSON.stringify(s7));
  t('uczeń: karta ma plakietkę „od nauczyciela”', /od nauczyciela: Pani Ania/.test(w.setCard(s7)));
  t('uczeń: pasek z nauczycielem', /Nauczyciel: Pani Ania/.test(w.document.getElementById('tutor-student-bar').innerHTML) && /Mam kod od nauczyciela/.test(w.document.getElementById('tutor-student-bar').innerHTML));

  // 10. brak migracji → funkcja niewidoczna
  state.noDb = true; w.__tutorNoDb = false;
  await w.loadMySets(); await wait(300);
  t('bez migracji: pasek, przycisk i panel usunięte', !w.document.getElementById('tutor-student-bar') && !w.document.getElementById('tutor-toggle-btn') && !w.document.getElementById('tutor-panel'));
  t('bez migracji: tryb nauczyciela wyłączony (zapis działa)', !T.on());

  console.log(fails ? "\n"+fails+" FAIL" : "\nWEB OK");
  if(fails) process.exit(1);
})().catch(e => { console.error('BŁĄD TESTU', e); process.exit(2); });

// ───────── PWA (app.html): lista „Moje zestawy" ucznia ─────────
(async () => {
  await new Promise(r => setTimeout(r, 3000));   // po teście web
  const d2 = new JSDOM('<body><div id="mine-list"></div></body>', { runScripts: 'outside-only', url: 'https://eyelingo.app/app.html', pretendToBeVisual: true });
  const v = d2.window; let f2 = 0;
  const tt = (n, ok, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + 'PWA: ' + n + (ok ? '' : ' :: ' + x)); if (!ok) f2++; };
  const mk = (table) => { const b = { select() { return b; }, eq() { return b; }, in() { return b; }, then(res, rej) {
    let data = []; if (table === 'tutor_link_sets') data = [{ link_id: 'L1', set_id: 7 }];
    if (table === 'user_sets') data = [{ id: 7, name: "Zestaw d'Ani", lang: 'en', user_id: 'T9', user_set_cards: [{ count: 12 }] }];
    return Promise.resolve({ data, error: null }).then(res, rej); } }; return b; };
  v.db = { from: mk, auth: { getSession: async () => ({ data: { session: { user: { id: 'S1' } } } }), onAuthStateChange() {} },
    rpc: async (n) => n === 'tutor_my_tutors' ? { data: [{ link_id: 'L1', tutor_id: 'T9', tutor_name: 'Pani Ania' }], error: null } : { data: null, error: null } };
  v.loadMine = async function () { v.document.getElementById('mine-list').innerHTML = '<div class="empty">Brak zestawów</div>'; };
  v.eval(fs.readFileSync(R + 'vendor/qrcode-generator.min.js', 'utf8'));
  v.eval(fs.readFileSync(R + 'tutor-mode.js', 'utf8'));
  await new Promise(r => setTimeout(r, 600));
  await v.loadMine(); await new Promise(r => setTimeout(r, 300));
  const L = v.document.getElementById('mine-list');
  tt('wiersz zestawu nauczyciela z liczbą fiszek', /od nauczyciela: Pani Ania/.test(L.innerHTML) && /12 /.test(L.innerHTML), L.innerHTML.slice(0, 200));
  tt('stan pusty usunięty', !L.querySelector('.empty'));
  tt('pasek „Mam kod od nauczyciela” nad listą', /Mam kod od nauczyciela/.test((v.document.getElementById('tutor-student-bar') || {}).innerHTML || ''));
  tt('apostrof w nazwie nie psuje onclick', /openSet\('7','Zestaw d\\'Ani'/.test(L.innerHTML), L.innerHTML.slice(0, 260));

  // ── PWA: tryb nauczyciela (przełącznik, katalogi, tworzenie, zakres) ──
  const d3 = new JSDOM('<body><section id="s-mine"><div class="scroll"><div class="h1 mb16">Moje zestawy</div><div id="ns-entry"></div><div id="mine-list"></div></div></section><section id="s-set"></section></body>', { runScripts: 'outside-only', url: 'https://eyelingo.app/app.html', pretendToBeVisual: true });
  const x = d3.window; const log = { ai: 0, man: 0, go: [], topic: 0, ins: [] };
  const mk3 = (table) => { const b = { select() { return b; }, eq() { return b; }, in() { return b; }, order() { return b; }, limit() { return b; },
    insert(v) { log.ins.push([table, v]); return Promise.resolve({ data: null, error: null }); }, delete() { return b; },
    then(res, rej) { let data = []; if (table === 'tutor_link_sets') data = [{ link_id: 'L1', set_id: 7 }]; if (table === 'user_sets') data = [{ id: 7, name: 'Zestaw dla Kasi', lang: 'en', user_set_cards: [{ count: 12 }] }]; return Promise.resolve({ data, error: null }).then(res, rej); } }; return b; };
  x.db = { from: mk3, auth: { getSession: async () => ({ data: { session: { user: { id: 'T1' } } } }), onAuthStateChange() {} },
    rpc: async (n) => n === 'tutor_list_students' ? { data: [{ link_id: 'L1', student_id: 'S1', label: null, student_name: 'Kasia' }], error: null } : n === 'tutor_my_tutors' ? { data: [], error: null } : { data: null, error: null } };
  x.eylIsPremium = async () => true;
  x.loadMine = async function () { x.document.getElementById('mine-list').innerHTML = '<div class="row">Mój</div>'; };
  x.go = function (n) { log.go.push(n); };
  x.eylNewSetOpen = async function () { log.man++; }; x._nsGo = function (v) { if (v === 'topic') log.topic++; };
  x.openSet = function () { log.opened = true; };
  x.eval(fs.readFileSync(R + 'vendor/qrcode-generator.min.js', 'utf8'));
  x.eval(fs.readFileSync(R + 'tutor-mode.js', 'utf8'));
  await new Promise(r => setTimeout(r, 600));
  await x.loadMine(); await new Promise(r => setTimeout(r, 300));
  const seg = x.document.getElementById('tutor-seg');
  tt('segment „Moje zestawy / Tryb nauczyciela” pod tytułem', !!seg && seg.previousElementSibling.classList.contains('h1') && seg.querySelectorAll('button').length === 2);
  seg.querySelector('[data-m="1"]').click(); await new Promise(r => setTimeout(r, 400));
  const sm = x.document.getElementById('s-mine'), P = x.document.getElementById('tutor-panel');
  tt('przełączenie: tutor-on, tytuł, segment on', sm.classList.contains('tutor-on') && x.document.querySelector('#s-mine .h1').textContent === 'Tryb nauczyciela' && seg.classList.contains('on'));
  tt('lista własnych zestawów i kafel „Nowy zestaw” ukryte w trybie', x.getComputedStyle(x.document.getElementById('mine-list')).display === 'none' && x.getComputedStyle(x.document.getElementById('ns-entry')).display === 'none');
  tt('panel pokazuje uczennicę', /Kasia/.test(P.innerHTML));
  P.querySelector('.sr').click(); await new Promise(r => setTimeout(r, 200));
  tt('katalog ucznia: wiersz zestawu, podgląd, odepnij, 3 akcje', /Zestaw dla Kasi/.test(P.innerHTML) && /12 fiszek/.test(P.innerHTML) && !!P.querySelector('.trow [data-a="eye"]') && !!P.querySelector('.trow [data-a="unpin"]') && !!P.querySelector('[data-a="new"]') && !!P.querySelector('[data-a="ai"]') && !!P.querySelector('[data-a="assign"]'));
  P.querySelector('[data-a="ai"]').click(); await new Promise(r => setTimeout(r, 200));
  tt('„Z AI” otwiera kreator nowego zestawu od razu na temacie', log.man === 1 && log.topic === 1, JSON.stringify(log));
  P.querySelector('[data-a="new"]').click(); await new Promise(r => setTimeout(r, 200));
  tt('„Nowy zestaw” otwiera kreator (widok wyboru)', log.man === 2 && log.topic === 1);
  P.querySelector('.trow').click();
  tt('klik w wiersz otwiera zestaw (openSet)', !!log.opened);
  x.go('set'); tt('ekran zestawu: tryb zostaje', x.EylTutor.on());
  x.go('ucz'); tt('wyjście z Moich zestawów wyłącza tryb', !x.EylTutor.on() && !sm.classList.contains('tutor-on') && x.document.querySelector('#s-mine .h1').textContent === 'Moje zestawy');
  seg.querySelector('[data-m="1"]').click(); await new Promise(r => setTimeout(r, 300));
  seg.querySelector('[data-m="0"]').click(); await new Promise(r => setTimeout(r, 100));
  tt('segment „Moje zestawy” wyłącza tryb', !x.EylTutor.on() && !seg.classList.contains('on'));
  process.exit(f2 ? 1 : 0);
})();
