/* Eyelingo — język ojczysty (pl | en).
   Ładowany zaraz po supabase-js, PRZED skryptami aplikacji (index.html, app.html).

   1. Wybór języka: ?lang=en|pl → localStorage eyl_native → profiles.native_lang (po zalogowaniu).
   2. Dane: każdy klient Supabase dostaje warstwę, która
        - ukrywa język ojczysty w katalogu (tabela languages: pl dla Polaków, en dla anglojęzycznych),
        - dla native=en podmienia translation → translation_en (flashcards, także osadzone flashcards(...)),
          label → label_en (categories/languages/levels).
   3. Interfejs (tylko native=en): słownik i18n/en.json nakładany na DOM (tekst + atrybuty),
      MutationObserver dla treści renderowanych dynamicznie, alert/confirm/prompt.
   4. Ailex i Rozmowa są na razie zablokowane dla native=en.
   Słowa z fiszek (pole word) nigdy nie są tłumaczone przez słownik. */
(function(){
  'use strict';
  var KEY='eyl_native', V='2';
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

  var NATIVE=(function(){
    try{ var q=new URLSearchParams(location.search).get('lang'); if(q==='en'||q==='pl'){ lsSet(KEY,q); return q; } }catch(e){}
    var s=lsGet(KEY); return (s==='en'||s==='pl')?s:'pl';
  })();
  var EN = NATIVE==='en';
  window.eylNative=function(){ return NATIVE; };
  window.eylIsEnNative=function(){ return EN; };
  try{ document.documentElement.lang=NATIVE; if(EN) document.documentElement.classList.add('eyl-en'); }catch(e){}

  /* Języki do nauki: bez języka ojczystego. */
  window.eylLangAllowed=function(code){ return code!==NATIVE; };

  /* ───────── 2. warstwa danych Supabase ───────── */
  var CARD_WORDS=Object.create(null);           // słowa z fiszek — słownik ich nie dotyka
  function noteWord(w){ if(typeof w==='string' && w.length<80) CARD_WORDS[w.trim().toLowerCase()]=1; }

  function augmentFlash(cols){ return cols.replace(/(^|[,(\s])translation(?![_\w])/g,'$1translation,translation_en').replace(/(^|[,(\s])ex_pl(?![_\w])/g,'$1ex_pl,ex_en'); }
  function augmentLabel(cols){ return cols.replace(/(^|[,(\s])label(?![_\w])/g,'$1label,label_en').replace(/(^|[,(\s])description(?![_\w])/g,'$1description,description_en'); }
  function augmentNested(cols,name,fn){
    var out='', i=0, re=new RegExp('(^|[,\\s(!:])'+name+'(?:![\\w]+)?\\(','g'), m;
    while((m=re.exec(cols))){
      var start=m.index+m[0].length, d=1, j=start;
      while(j<cols.length && d){ if(cols[j]==='(') d++; else if(cols[j]===')') d--; j++; }
      out+=cols.slice(i,start)+fn(cols.slice(start,j-1))+')'; i=j; re.lastIndex=j;
    }
    return out+cols.slice(i);
  }
  function augment(table,cols){
    if(!EN || typeof cols!=='string' || cols.indexOf('*')>=0 && table==='flashcards') return cols;
    var c=cols;
    if(table==='flashcards') c=topLevel(c,augmentFlash);
    else if(table==='categories'||table==='languages'||table==='levels') c=topLevel(c,augmentLabel);
    c=augmentNested(c,'flashcards',augmentFlash);
    c=augmentNested(c,'categories',augmentLabel);
    c=augmentNested(c,'languages',augmentLabel);
    c=augmentNested(c,'levels',augmentLabel);
    return c;
  }
  /* Funkcja na poziomie głównym (poza nawiasami) — tu po prostu całość; augment* są idempotentne
     dzięki (?![_\w]), a zagnieżdżenia i tak przechodzą przez augmentNested. */
  function topLevel(c,fn){
    var depth=0, out='', seg='';
    for(var k=0;k<c.length;k++){
      var ch=c[k];
      if(ch==='('){ if(depth===0){ out+=fn(seg); seg=''; } depth++; out+=ch; continue; }
      if(ch===')'){ depth--; out+=ch; continue; }
      if(depth===0) seg+=ch; else out+=ch;
    }
    return out+fn(seg);
  }

  function mapRow(o,table){
    if(!o || typeof o!=='object') return;
    if(Array.isArray(o)){ for(var i=0;i<o.length;i++) mapRow(o[i]); return; }
    if('word' in o) noteWord(o.word);
    if(EN){
      if('translation_en' in o){ if(o.translation_en) o.translation=o.translation_en; delete o.translation_en; }
      if('ex_en' in o){ if(o.ex_en) o.ex_pl=o.ex_en; delete o.ex_en; }
      if('label_en' in o){ if(o.label_en) o.label=o.label_en; delete o.label_en; }
      if('description_en' in o){ if(o.description_en) o.description=o.description_en; delete o.description_en; }
    }
    for(var k in o){ var v=o[k]; if(v && typeof v==='object') mapRow(v); }
  }
  function transform(table,res){
    if(!res || !res.data) return res;
    if(table==='languages' && Array.isArray(res.data)){
      res.data=res.data.filter(function(r){ return !r || !r.code || r.code!==NATIVE; });
    }
    mapRow(res.data,table);
    return res;
  }
  function wrapBuilder(b,table){
    if(!b || typeof b.then!=='function' || b.__eylI18n) return b;
    var t=b.then;
    b.then=function(f,r){ return t.call(b,function(res){ try{ transform(table,res); }catch(e){} return res; }).then(f,r); };
    b.__eylI18n=true;
    return b;
  }
  function patchClient(c){
    if(!c || typeof c.from!=='function' || c.__eylI18n) return c;
    var from=c.from;
    c.from=function(table){
      var qb=from.apply(c,arguments);
      try{
        var sel=qb.select;
        if(typeof sel==='function'){
          qb.select=function(cols){
            var a=[].slice.call(arguments); if(typeof a[0]==='string') a[0]=augment(table,a[0]);
            return wrapBuilder(sel.apply(qb,a),table);
          };
        }
      }catch(e){}
      return qb;
    };
    c.__eylI18n=true;
    if(!window.__eylDb) window.__eylDb=c;
    return c;
  }
  (function hookSupabase(){
    var s=window.supabase; if(!s) return;
    ['createClient'].forEach(function(k){
      var holder=(typeof s[k]==='function')?s:(s.default&&typeof s.default[k]==='function'?s.default:null);
      if(!holder) return;
      var orig=holder[k];
      holder[k]=function(){ return patchClient(orig.apply(this,arguments)); };
    });
  })();
  window.eylPatchClient=patchClient;

  /* ───────── rejestry języków (LEX_LANG_MAP web, LEX_LANGS PWA) ───────── */
  var PL_WEB={name:'polski',label:'Polski',gen:'polskiego',loc:'polskim',native:'Polski',en:'Polish',flag:'🇵🇱',bcp47:'pl-PL',tts:'web',translit:false};
  var PL_PWA={name:'polski',gen:'polskiego',loc:'polskim',adv:'polsku',flag:'🇵🇱',tts:'pl-PL'};
  var EN_NAMES={en:'English',es:'Spanish',de:'German',fr:'French',it:'Italian',nl:'Dutch',pt:'Portuguese',no:'Norwegian',ru:'Russian',uk:'Ukrainian',ar:'Arabic',jp:'Japanese',zh:'Chinese',ko:'Korean',pl:'Polish'};
  function hideKey(obj){
    if(!obj || obj.__eylHidden) return obj;
    var hide=NATIVE;
    var p=new Proxy(obj,{
      ownKeys:function(t){ return Reflect.ownKeys(t).filter(function(k){ return k!==hide; }); },
      getOwnPropertyDescriptor:function(t,k){ if(k===hide) return undefined; return Reflect.getOwnPropertyDescriptor(t,k); },
      has:function(t,k){ return k==='__eylHidden' || Reflect.has(t,k); },
      get:function(t,k){ if(k==='__eylHidden') return true; return Reflect.get(t,k); }
    });
    return p;
  }
  function patchRegistries(){
    try{
      if(window.LEX_LANG_MAP && !window.LEX_LANG_MAP.__eylHidden){
        var m=window.LEX_LANG_MAP;
        if(!m.pl) m.pl=PL_WEB;
        if(EN){ for(var k in m){ if(EN_NAMES[k]){ m[k].label=EN_NAMES[k]; m[k].name=EN_NAMES[k]; } } }
        window.LEX_LANG_MAP=hideKey(m);
      }
      if(window.LEX_LANGS && !window.LEX_LANGS.__eylHidden){
        var n=window.LEX_LANGS;
        if(!n.pl) n.pl=PL_PWA;
        if(EN){ for(var j in n){ if(EN_NAMES[j]) n[j].name=EN_NAMES[j]; } }
        window.LEX_LANGS=hideKey(n);
      }
    }catch(e){ console.warn('[i18n] rejestry',e); }
  }

  /* ───────── 3. słownik interfejsu (native=en) ───────── */
  var DICT=null, FRAG=null, RICH={}, MISS=Object.create(null);
  window.__eylMiss=MISS;
  var SKIP_TAGS={SCRIPT:1,STYLE:1,TEXTAREA:1,CODE:1,PRE:1,NOSCRIPT:1,SVG:1,svg:1,path:1};
  var ATTRS=['placeholder','title','aria-label','alt','data-tip'];
  var PLRX=/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(i|w|z|na|do|nie|się|jest|Twoje?|Twój|Twoich|dla|od|po|już|jak|co|lub|oraz|albo|Zestaw\w*|fiszk\w*|Ucz\w*|Wybierz|Dalej|Zapisz|Zamknij|Anuluj|Powr\w*|Język\w*|słow\w*|Kont\w*)\b/;

  function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  function buildFrag(){
    var keys=Object.keys(DICT).filter(function(k){ return k.length>=3 && /[A-Za-zĄ-ż]/.test(k) && DICT[k]; });
    keys.sort(function(a,b){ return b.length-a.length; });
    var parts=keys.slice(0,4000).map(function(k){
      var a=/^[\p{L}\d]/u.test(k)?'(?<![\\p{L}\\d])':'', z=/[\p{L}\d]$/u.test(k)?'(?![\\p{L}\\d])':'';
      return a+esc(k)+z;
    });
    try{ FRAG=parts.length?new RegExp(parts.join('|'),'gu'):null; }catch(e){ FRAG=null; console.warn('[i18n] regex',e); }
  }
  function sing(x){ return x.replace(/(^|[^\d.,])1 (cards|sets|words|days|minutes|categories|reviews|students|lessons)\b/g,function(m,a,w){ return a+'1 '+w.replace(/ies$/,'y').replace(/s$/,''); }); }
  function tr(s){
    if(!DICT || typeof s!=='string') return s;
    var t=s.trim(); if(!t || t.length>4000) return s;
    var n=t.replace(/[\u00a0\u202f\s]+/g,' ');
    if(CARD_WORDS[n.toLowerCase()]) return s;
    var lead=s.match(/^\s*/)[0], trail=s.match(/\s*$/)[0];
    var hit=DICT[n];
    if(typeof hit==='string' && hit){ return lead+hit+trail; }
    /* Szablony z liczbami: „14 fiszek · 0 opanowanych” ↔ klucz „# fiszek · # opanowanych”. */
    if(/\d/.test(n)){
      var nums=n.match(/\d+(?:[.,]\d+)?/g)||[], tk=n.replace(/\d+(?:[.,]\d+)?/g,'#'), tv=DICT[tk];
      if(typeof tv==='string' && tv){ var k=0; return lead+sing(tv.replace(/#/g,function(){ return nums[k++]||''; }))+trail; }
    }
    if(!FRAG || (n.length>400 && !PLRX.test(n))) return s;
    var norm=s.replace(/[\u00a0\u202f]/g,' ');
    FRAG.lastIndex=0;
    var out=norm.replace(FRAG,function(m){ var v=DICT[m]; return (typeof v==='string'&&v)?v:m; });
    /* Pół-polskie zdanie wygląda gorzej niż polskie — wtedy zostawiamy oryginał i notujemy brak. */
    if(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(out)){ MISS[n]=1; return s; }
    return out===norm?s:sing(out);
  }
  window.eylT=function(s){ return EN?tr(s):s; };
  window.__eylWalk=function(){ walk(document.body); };

  function skipEl(el){
    for(var e=el; e && e.nodeType===1; e=e.parentNode){
      if(SKIP_TAGS[e.tagName]) return true;
      if(e.isContentEditable) return true;
      if(e.hasAttribute && (e.hasAttribute('data-noi18n') || e.getAttribute('translate')==='no')) return true;
    }
    return false;
  }
  function doText(n){
    var v=n.nodeValue; if(!v || !/[A-Za-zĄ-ż]/.test(v)) return;
    var p=n.parentNode; if(!p || skipEl(p)) return;
    var out=tr(v); if(out!==v) n.nodeValue=out;
  }
  function doAttrs(el){
    if(el.isContentEditable || (el.hasAttribute && el.hasAttribute('data-noi18n')) || (el.parentNode && el.parentNode.nodeType===1 && skipEl(el.parentNode))) return;
    for(var i=0;i<ATTRS.length;i++){
      var a=ATTRS[i], v=el.getAttribute && el.getAttribute(a);
      if(v){ var o=tr(v); if(o!==v) el.setAttribute(a,o); }
    }
    if(el.tagName==='INPUT' && (el.type==='button'||el.type==='submit') && el.value){ var o2=tr(el.value); if(o2!==el.value) el.value=o2; }
    if(el.tagName==='OPTION' && el.label && el.label!==el.textContent){ /* tekst opcji obsługuje doText */ }
  }
  function richNorm(h){ return h.replace(/&nbsp;/g,' ').replace(/[\u00a0\s]+/g,' ').trim(); }
  function doRich(el){
    if(!el.firstElementChild || el.childNodes.length>40) return false;
    var h=richNorm(el.innerHTML); var v=RICH[h];
    if(typeof v==='string' && v){ el.innerHTML=v; return true; }
    return false;
  }
  function walk(root){
    if(!root) return;
    if(root.nodeType===3){ doText(root); return; }
    if(root.nodeType!==1 && root.nodeType!==9 && root.nodeType!==11) return;
    if(root.nodeType===1){ if(SKIP_TAGS[root.tagName] || skipEl(root)) return; doAttrs(root); if(doRich(root)) return; }
    if(root.querySelectorAll){ var els=root.querySelectorAll('*'); for(var q=0;q<els.length;q++){ try{ if(!skipEl(els[q])) doRich(els[q]); }catch(e){} } }
    var tw=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,null);
    var n, list=[];
    while((n=tw.nextNode())) list.push(n);
    for(var i=0;i<list.length;i++){ try{ if(list[i].nodeType===3) doText(list[i]); else doAttrs(list[i]); }catch(e){ if(!walk._err){ walk._err=1; console.warn('[i18n] walk',e); } } }
  }
  var MO=null, busy=false;
  function observe(){
    if(MO || !document.body) return;
    MO=new MutationObserver(function(muts){
      if(busy) return; busy=true;
      try{
        for(var i=0;i<muts.length;i++){
          var m=muts[i];
          if(m.type==='childList'){ for(var j=0;j<m.addedNodes.length;j++) walk(m.addedNodes[j]); }
          else if(m.type==='characterData') doText(m.target);
          else if(m.type==='attributes') doAttrs(m.target);
        }
      }finally{ busy=false; }
    });
    MO.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
  }
  function translateTitle(){ try{ var t=tr(document.title); if(t!==document.title) document.title=t; }catch(e){} }

  /* Nazwy kategorii z bazy (label → label_en) trafiają do słownika: działa to także dla nazw
     zapisanych wcześniej po polsku (np. „Kontynuuj” w pasku bocznym, ostatnie zestawy). */
  function loadCategoryNames(){
    var tries=0;
    (function go(){ var c=window.__eylDb; if(!c){ if(tries++<40) setTimeout(go,250); return; } fetchCatPairs(c); })();
  }
  function fetchCatPairs(c){
    try{
      var url=(c.supabaseUrl||c.restUrl||'').replace(/\/$/,'');
      var key=c.supabaseKey||'';
      if(!url||!key){ return; }
      fetch(url+'/rest/v1/categories?select=label,label_en',{headers:{apikey:key,Authorization:'Bearer '+key}})
        .then(function(r){ return r.ok?r.json():[]; })
        .then(function(rows){
          var added=0;
          (rows||[]).forEach(function(x){ if(x && x.label && x.label_en && !DICT[x.label]){ DICT[x.label]=x.label_en; added++; } });
          if(added && document.body){ walk(document.body); }
        }).catch(function(){});
    }catch(e){}
  }
  function loadDict(){
    var base=(document.currentScript&&document.currentScript.src)||'';
    var url='i18n/en.json?v='+V;
    return fetch(url,{cache:'force-cache'}).then(function(r){ return r.ok?r.json():{}; }).catch(function(){ return {}; })
      .then(function(d){ d=d||{}; var r=d.__rich||{}; delete d.__rich; RICH={}; for(var k in r) RICH[richNorm(k)]=r[k]; DICT=d; buildFrag(); loadCategoryNames(); });
  }

  if(EN){
    var st=document.createElement('style');
    st.id='eyl-i18n-hold';
    st.textContent='html.eyl-en body{opacity:0}html.eyl-en.eyl-i18n-ready body{opacity:1;transition:opacity .12s}';
    (document.head||document.documentElement).appendChild(st);
    var ready=function(){ document.documentElement.classList.add('eyl-i18n-ready'); };
    setTimeout(ready,2500);   // nigdy nie zostawiamy pustego ekranu
    var dictP=loadDict();
    // natywne okna
    ['alert','confirm','prompt'].forEach(function(k){
      var f=window[k]; if(typeof f!=='function') return;
      window[k]=function(msg){ var a=[].slice.call(arguments); if(typeof a[0]==='string') a[0]=tr(a[0]); if(k==='prompt'&&typeof a[1]==='string') a[1]=tr(a[1]); return f.apply(window,a); };
    });
    var start=function(){
      dictP.then(function(){ try{ walk(document.body); }catch(e){ console.warn('[i18n] walk',e); } translateTitle(); observe(); ready(); });
    };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
    new MutationObserver(translateTitle).observe(document.querySelector('title')||document.head,{childList:true,characterData:true,subtree:true});
  }
  /* Demo dla gościa: angielski nie jest językiem do nauki dla anglojęzycznych → hiszpański. */
  function patchDemo(){
    try{
      var d=window.EYL_DEMO;
      if(d && d.lang===NATIVE){ d.langId=2; d.lang='es'; d.name=EN?'Spanish · A2 · Basic work':'Hiszpański · A2 · Praca podstawy'; d.ex={}; d.fallback=[]; }
    }catch(e){}
  }
  function patchAll(){ patchRegistries(); patchDemo(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',patchAll); else patchAll();
  setTimeout(patchAll,1500);

  /* ───────── 3b. AI (zestawy z AI, znaczenia, przykłady) — język ojczysty angielski ─────────
     Prompty w aplikacji są pisane pod Polaka. Dla native=en każde wywołanie super-endpoint dostaje
     na początku nadrzędną instrukcję: wszystko, co miało być po polsku, ma być po angielsku.
     Klucze JSON zostają bez zmian (np. translation_pl niesie wtedy tekst angielski). */
  var AI_NOTE='LANGUAGE OVERRIDE (highest priority): the learner\'s native language is ENGLISH, not Polish. '
    +'Wherever the instructions below ask for Polish (translations, meanings, titles, notes, explanations, feedback, "po polsku", "polskie tłumaczenie", "na polski"), write it in natural English instead. '
    +'Words "in the target language" stay in the target language. Never output Polish. Keep every JSON key and format exactly as requested.';
  if(EN && typeof window.fetch==='function'){
    var _f=window.fetch;
    window.fetch=function(input,init){
      try{
        var url=(typeof input==='string')?input:(input&&input.url)||'';
        if(url.indexOf('/functions/v1/super-endpoint')>=0 && init && typeof init.body==='string'){
          var b=JSON.parse(init.body);
          var k=String(b.kind||'');
          if(/^(lex|lesson|portion|chat|alex|alex_chat|rozmowa)$/.test(k) && !b.__eylAllow){ /* Ailex/Rozmowa: zablokowane dla EN */ }
          if(Array.isArray(b.messages)){
            b.messages=[{role:'system',content:AI_NOTE}].concat(b.messages);
            init=Object.assign({},init,{body:JSON.stringify(b)});
          }
        }
      }catch(e){}
      return _f.call(this,input,init);
    };
  }

  /* ───────── 4. blokada Ailex / Rozmowa dla native=en ───────── */
  function soonBox(){
    var msg='AI lessons (Ailex) and AI conversation are coming soon for English speakers. Flashcards, sets and reviews already work in English.';
    try{ if(typeof window.eylNote==='function'){ window.eylNote(msg); return; } }catch(e){}
    try{ if(typeof window.showToast==='function'){ window.showToast(msg); return; } }catch(e){}
    try{ window.alert(msg); }catch(e){}
  }
  window.eylAiBlocked=function(){ return EN; };
  function gate(){
    if(!EN) return;
    var wrap=function(name,test){
      var f=window[name]; if(typeof f!=='function' || f.__eylGate) return;
      var g=function(){ if(!test || test.apply(this,arguments)){ soonBox(); return; } return f.apply(this,arguments); };
      g.__eylGate=true; window[name]=g;
    };
    wrap('showPage',function(n){ return n==='teacher'||n==='chat'; });
    wrap('switchTab',function(n){ return n==='teacher'||n==='chat'; });
    wrap('eylGoTrener'); wrap('openLexSetup'); wrap('lexStart'); wrap('alexOpen'); wrap('lexStartLesson'); wrap('lexStartNewLesson');
    // ukryj wejścia
    var css=document.getElementById('eyl-ai-gate');
    if(!css){
      css=document.createElement('style'); css.id='eyl-ai-gate';
      css.textContent='#ntab-teacher,[onclick*="alexOpen("],[onclick*="openLexSetup("],[onclick*="eylGoTrener("],[onclick*="switchTab(\'teacher\'"]{display:none!important}';
      document.head.appendChild(css);
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',gate); else gate();
  setTimeout(gate,1500); setTimeout(gate,5000);

  /* ───────── 1b. zmiana języka + synchronizacja z profilem ───────── */
  function client(){ return window.__eylDb || window.db || null; }
  window.eylSetNative=async function(v){
    if(v!=='pl' && v!=='en') return;
    lsSet(KEY,v);
    try{
      var c=client(); if(c && c.auth){
        var u=(await c.auth.getUser()).data.user;
        if(u) await Promise.race([c.rpc('set_native_lang',{p_lang:v}), new Promise(function(r){ setTimeout(r,2500); })]);
      }
    }catch(e){}
    /* replace() na ten sam adres z #hash nie przeładowuje strony — stąd jawny reload. */
    try{ var url=new URL(location.href); if(url.searchParams.has('lang')){ url.searchParams.delete('lang'); history.replaceState(null,'',url.toString()); } }catch(e){}
    location.reload();
  };
  /* Po zalogowaniu: profil ma pierwszeństwo, gdy użytkownik nie wybrał nic na tym urządzeniu.
     Gdy wybrał (localStorage), a profil ma domyślne pl — zapisujemy wybór do profilu. */
  async function syncProfile(){
    var c=client(); if(!c || !c.auth) return false;
    try{
      var u=(await c.auth.getUser()).data.user; if(!u) return true;
      var r=await c.from('profiles').select('native_lang').eq('user_id',u.id).maybeSingle();
      var p=r && r.data && r.data.native_lang;
      var local=lsGet(KEY);
      if(!local && p && p!==NATIVE){ lsSet(KEY,p); location.reload(); return true; }
      if(local && p && p!==local){
        if(local==='en' && p==='pl'){ await c.rpc('set_native_lang',{p_lang:'en'}); }
        else { lsSet(KEY,p); location.reload(); }
      }
      if(!local) lsSet(KEY,p||'pl');
      return true;
    }catch(e){ return false; }
  }
  (function waitSync(){ var n=0; (function tick(){ syncProfile().then(function(ok){ if(!ok && n++<20) setTimeout(tick,1000); }); })(); })();
  try{
    window.addEventListener('load',function(){
      var c=client(); if(c && c.auth && c.auth.onAuthStateChange){
        c.auth.onAuthStateChange(function(ev){ if(ev==='SIGNED_IN') setTimeout(syncProfile,300); });
      }
    });
  }catch(e){}

  /* Przełącznik PL | EN — wstawiany w miejsca oznaczone [data-eyl-native-switch]. */
  window.eylNativeSwitchHTML=function(){
    var b=function(v,l){ var on=NATIVE===v; return '<button type="button" data-noi18n onclick="eylSetNative(\''+v+'\')" aria-pressed="'+on+'" style="border:0;padding:5px 10px;border-radius:999px;font:600 12px/1 DM Sans,system-ui,sans-serif;cursor:pointer;background:'+(on?'var(--navy,#1a2340)':'transparent')+';color:'+(on?'#fff':'var(--navy,#1a2340)')+'">'+l+'</button>'; };
    return '<span class="eyl-native-sw" data-noi18n role="group" aria-label="Language" style="display:inline-flex;gap:2px;padding:2px;border:1px solid rgba(26,35,64,.18);border-radius:999px;background:rgba(255,255,255,.6)">'+b('pl','PL')+b('en','EN')+'</span>';
  };
  function mountSwitches(){
    var els=document.querySelectorAll('[data-eyl-native-switch]:not([data-mounted])');
    for(var i=0;i<els.length;i++){ els[i].innerHTML=window.eylNativeSwitchHTML(); els[i].setAttribute('data-mounted','1'); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mountSwitches); else mountSwitches();
  setInterval(mountSwitches,1500);
})();
