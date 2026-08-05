/* ═══ EYELINGO — GRAMMAR ENGINE v1.0 (GRAM-0..GRAM-4) ═══
   Bank pusty/niezaładowany => wszystkie funkcje neutralne, aplikacja działa jak wcześniej. */
(function(){
  'use strict';
  var LEVELS=['A1','A2','B1','B2','C1','C2'];
  var BANK={}, LOADING={};
  var BANK_BASE='data/grammar/grammar-bank.';

  function lang(){ try{ return window._lexLang||'en'; }catch(e){ return 'en'; } }
  function level(){
    try{ if(window._gramLevel) return window._gramLevel; }catch(e){}
    try{ if(typeof lexLevel!=='undefined'&&lexLevel) return lexLevel; }catch(e){}
    return 'A1';
  }
  function lvlIdx(l){ var i=LEVELS.indexOf(String(l||'A1')); return i<0?0:i; }
  function skey(){ try{ return uk('lex_gram_state_'+lang()); }catch(e){ return 'lex_gram_state_'+lang(); } }
  function now(){ return Date.now(); }
  var DAY=86400000;

  window.gramBankLoad=function(l){
    l=l||lang();
    if(BANK[l]) return Promise.resolve(BANK[l]);
    if(LOADING[l]) return LOADING[l];
    LOADING[l]=fetch(BANK_BASE+l+'.json',{cache:'no-cache'})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(j){
        var list=(j&&j.points)?j.points.slice():[];
        list.sort(function(a,b){ return (a.order||0)-(b.order||0); });
        var byId={}; list.forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
        BANK[l]={byId:byId,list:list}; return BANK[l];
      })
      .catch(function(err){
        try{ console.warn('[gram] nie wczytano banku:', BANK_BASE+l+'.json', '-', (err&&err.message)||err); }catch(e){}
        // Nieudanej proby NIE zapisujemy — inaczej jeden 404 (np. przed wgraniem
        // pliku) blokuje bank do konca sesji. Nastepna porcja sprobuje ponownie.
        delete LOADING[l];
        return {byId:{},list:[]};
      });
    return LOADING[l];
  };
  function bank(){ return BANK[lang()]||{byId:{},list:[]}; }
  /* Wymusza ponowne pobranie banku z pominieciem cache przegladarki. */
  window.gramBankReload=function(l){ l=l||lang(); delete BANK[l]; delete LOADING[l]; return gramBankLoad(l); };
  window.gramPoint=function(id){ return bank().byId[id]||null; };
  window.gramBankReady=function(){ return bank().list.length>0; };

  function loadState(){ try{ return JSON.parse(localStorage.getItem(skey())||'{}'); }catch(e){ return {}; } }
  function saveState(s){ try{ localStorage.setItem(skey(),JSON.stringify(s)); }catch(e){} }
  function rec(id){ return loadState()[id]||null; }
  window.gramState=loadState;

  window.gramStatus=function(id){
    var p=gramPoint(id); if(!p) return 'locked';
    var r=rec(id);
    if(r&&r.status==='unlocked') return (r.due&&r.due<now())?'stale':'unlocked';
    if(lvlIdx(p.level)>lvlIdx(level())) return 'locked';
    var pre=[].concat(p.prereq||[]);
    // Prerekwizyt nieobecny w banku traktujemy jako spelniony — inaczej czesciowy
    // bank (albo literowka w id) blokuje cala galaz. Kompletnosc grafu sprawdza
    // audyt banku (GRAM-2), nie runtime.
    return pre.every(function(q){ return !bank().byId[q] || (rec(q)||{}).status==='unlocked'; })?'teachable':'locked';
  };
  window.gramAllowed=function(){
    var out=[]; bank().list.forEach(function(p){ var s=gramStatus(p.id); if(s==='unlocked'||s==='stale') out.push(p.id); }); return out;
  };
  window.gramTeachableNow=function(){
    var l=bank().list; for(var i=0;i<l.length;i++){ if(gramStatus(l[i].id)==='teachable') return l[i].id; } return null;
  };
  window.gramStalePoint=function(){
    var l=bank().list; for(var i=0;i<l.length;i++){ if(gramStatus(l[i].id)==='stale') return l[i].id; } return null;
  };

  /* Kanoniczna tresc dydaktyczna punktu jako tekst — uzywana w moscie
     Etapu 1-2 (przepisywana przez model do intro) oraz przez Zeszyt.
     W Etapie 3 zastapi ja karta „Nowa struktura" renderowana przez aplikacje:
     wystarczy ustawic window.GRAM_INTRO_BRIDGE=false. */
  window.gramTeachBlock=function(p){
    if(!p||!p.teach) return '';
    var t=p.teach, out=[];
    out.push(p.name_pl);
    if(t.rule_pl) out.push(t.rule_pl);
    if(t.paradigm&&t.paradigm.rows&&t.paradigm.rows.length){
      t.paradigm.rows.forEach(function(r){ out.push([].concat(r).join('  →  ')); });
    }
    if(t.examples&&t.examples.length){
      t.examples.forEach(function(e){ out.push(String(e.target||'')+' — '+String(e.pl||'')); });
    }
    if(t.contrast_pl) out.push('Uwaga: '+t.contrast_pl);
    return out.join('\n');
  };

  /* Diagnostyka — do wklejenia w konsoli gdy bank sie nie laduje. */
  window.gramDiag=async function(){
    var l=lang();
    var url=BANK_BASE+l+'.json';
    var out={ kod_jezyka:l, poziom:level(), sciezka:url, pelny_url:(new URL(url, location.href)).href };
    try{
      var r=await fetch(url,{cache:'no-store'});
      out.status=r.status;
      if(r.ok){ var j=await r.json(); out.punktow=(j&&j.points)?j.points.length:0; out.lang_w_pliku=j&&j.lang; }
    }catch(e){ out.blad=(e&&e.message)||String(e); }
    out.bank_zaladowany=gramBankReady();
    console.table?console.table(out):console.log(out);
    return out;
  };

  window.gramPromptBlock=function(){
    if(!gramBankReady()) return '';
    var allowed=gramAllowed().map(function(id){ var p=gramPoint(id); return p?(p.id+' = '+p.name_pl):id; });
    var tid=gramTeachableNow(), tp=tid?gramPoint(tid):null;
    return 'KONTRAKT GRAMATYCZNY — BEZWZGLĘDNY. '
      +'Struktury, które uczeń ZNA i których wolno używać: '+(allowed.length?allowed.join('; '):'BRAK — trzymaj się absolutnych podstaw')+'. '
      +(tp?('Struktura NOWA, dozwolona wyłącznie w tej porcji: '+tp.id+' = '+tp.name_pl+'. ')
          :'NIE wprowadzaj żadnej nowej struktury gramatycznej w tej porcji. ')
      +'Nie wolno użyć ŻADNEJ innej struktury — ani w zdaniach, ani w poleceniach, ani we wzorcowych odpowiedziach, ani w podpowiedziach. '
      +'W KAŻDYM ćwiczeniu wypełnij pole "uses_grammar": tablicę id struktur wymaganych do poprawnego wykonania zadania (pusta tablica, jeśli zadanie jest czysto leksykalne). '
      +(tp?(window.GRAM_INTRO_BRIDGE===false
            ? 'NIE tłumacz nowej struktury w polu "intro" — regułę i odmianę pokaże aplikacja z własnych danych. Twoim zadaniem są wyłącznie ćwiczenia. '
            : ('NOWĄ strukturę wprowadź na POCZĄTKU pola "intro", przepisując PONIŻSZY model DOSŁOWNIE, bez skracania i bez własnych wyjaśnień, a dopiero potem przejdź do ćwiczeń:\n'
               + gramTeachBlock(tp) + '\n')):'')
      +'Nie używaj notacji podręcznikowej: tyldy (~ ani ～), nawiasów kwadratowych, gwiazdek poza **wyróżnieniem słowa-celu**. ';
  };

  var PRODUCTIVE=['produce','sculpt','transform','translate','scenario'];
  function exText(ex){
    var p=[];
    ['prompt','instruction','intent','answer','source','sentence','skeleton','situation','hint','key','explain','question','context']
      .forEach(function(k){ if(ex&&ex[k]) p.push(String(ex[k])); });
    if(ex&&Array.isArray(ex.options)) p.push(ex.options.join(' '));
    if(ex&&Array.isArray(ex.tiles)) p.push(ex.tiles.join(' '));
    if(ex&&Array.isArray(ex.answers)) p.push(ex.answers.join(' '));
    if(ex&&Array.isArray(ex.must_use)) p.push(ex.must_use.join(' '));
    return p.join(' \n ').toLowerCase();
  }
  /* Sito bierze tylko wykładniki >=4 znaków albo wielowyrazowe — krótkie
     partykuły (wa, no, de, ni) dawałyby masowe fałszywe trafienia. */
  function sieveHit(ex,point){
    var exps=[].concat(point.exponents||[]).filter(function(e){ e=String(e||'').trim(); return e.length>=4||e.indexOf(' ')>0; });
    if(!exps.length) return false;
    var t=exText(ex);
    return exps.some(function(e){ return t.indexOf(String(e).toLowerCase().trim())>=0; });
  }
  window.gramValidatePortion=function(data,teachableId){
    if(!gramBankReady()||!data) return {bad:[],reasons:[]};
    var ok={}; gramAllowed().forEach(function(id){ ok[id]=1; }); if(teachableId) ok[teachableId]=1;
    var locked=bank().list.filter(function(p){ return !ok[p.id]&&lvlIdx(p.level)<=lvlIdx(level())+1; });
    var bad=[], reasons={};
    (data.exercises||[]).forEach(function(ex,i){
      if(!ex) return;
      var used=[].concat(ex.uses_grammar||[]).filter(Boolean);
      var illegal=used.filter(function(id){ return !ok[id]; });
      if(illegal.length){ bad.push(i); illegal.forEach(function(id){ var p=gramPoint(id); reasons[p?p.name_pl:id]=1; }); return; }
      if(PRODUCTIVE.indexOf(ex.type)>=0&&!used.length){ bad.push(i); return; }
      for(var k=0;k<locked.length;k++){ if(sieveHit(ex,locked[k])){ bad.push(i); reasons[locked[k].name_pl]=1; return; } }
    });
    return {bad:bad,reasons:Object.keys(reasons)};
  };

  window.gramCleanNotation=function(s){
    return String(s==null?'':s).replace(/[~～〜]/g,'').replace(/\[([^\]]{1,30})\]/g,'$1').replace(/\s{2,}/g,' ').trim();
  };

  window.gramMarkTaught=function(id){
    var p=gramPoint(id); if(!p) return;
    var s=loadState(); if(s[id]&&s[id].status==='unlocked') return;
    s[id]={status:'unlocked',taught_at:now(),exposures:0,errors:0,ease:(p.srs&&p.srs.initial_ease)||2.5,interval:1,due:now()+DAY};
    saveState(s);
    try{ if(typeof lexGrammarSavePoint==='function') lexGrammarSavePoint(p); }catch(e){}
  };
  window.gramGrade=function(id,quality){
    var s=loadState(), r=s[id]; if(!r) return;
    r.exposures=(r.exposures||0)+1;
    if(quality<3){ r.errors=(r.errors||0)+1; r.interval=1; r.ease=Math.max(1.3,(r.ease||2.5)-0.2); }
    else { r.interval=(r.interval||1)<=1?3:Math.round(r.interval*(r.ease||2.5)); r.ease=Math.min(2.8,(r.ease||2.5)+(quality===5?0.06:0)); }
    r.due=now()+r.interval*DAY; s[id]=r; saveState(s);
  };
  window.gramScaffoldMode=function(id){
    var r=rec(id); if(!r) return 'full';
    if(gramStatus(id)==='stale') return 'full';
    var e=r.exposures||0;
    if(e<2) return 'full';
    if(e<6||(r.errors||0)>0) return 'chip';
    return 'hidden';
  };
  window.gramFindByGap=function(text){
    if(!gramBankReady()) return null;
    var t=String(text||'').toLowerCase(); if(!t) return null;
    var hit=null;
    bank().list.forEach(function(p){
      if(hit) return;
      if(p.name_pl&&t.indexOf(String(p.name_pl).toLowerCase())>=0){ hit=p.id; return; }
      [].concat(p.exponents||[]).forEach(function(e){
        if(hit) return; e=String(e||'').trim();
        if(e.length>=4&&t.indexOf(e.toLowerCase())>=0) hit=p.id;
      });
    });
    return hit;
  };
  window.gramProgress=function(lvl){
    lvl=lvl||level(); var total=0,done=0;
    bank().list.forEach(function(p){ if(p.level!==lvl) return; total++; if((rec(p.id)||{}).status==='unlocked') done++; });
    return {level:lvl,done:done,total:total};
  };
})();
