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
  var KEY='eyl_native', V='5';
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

  var NATIVE=(function(){
    try{ var q=new URLSearchParams(location.search).get('lang'); if(q==='en'||q==='pl'){ lsSet(KEY,q); return q; } }catch(e){}
    var s=lsGet(KEY); return (s==='en'||s==='pl')?s:'pl';
  })();
  var EN = NATIVE==='en';
  window.eylNative=function(){ return NATIVE; };
  window.eylIsEnNative=function(){ return EN; };
  function setMode(v){
    NATIVE=v; EN=v==='en';
    try{ var h=document.documentElement; h.lang=NATIVE; h.classList.toggle('eyl-en',EN); if(EN) h.classList.add('eyl-i18n-ready'); }catch(e){}
  }
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
    /* RPC katalogu/fiszek przyjmują p_native — goście bez profilu też dostają angielski. */
    var NATIVE_RPC={catalog_categories:1,catalog_level_keys:1,get_flashcards:1,get_due_cards_all:1,get_categories_for_lang_level:1};
    if(typeof c.rpc==='function'){
      var rpc=c.rpc;
      c.rpc=function(fn,args){
        var a=[].slice.call(arguments);
        if(EN && NATIVE_RPC[fn]){ a[1]=Object.assign({},args||{},{p_native:'en'}); }
        return rpc.apply(c,a);
      };
    }
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
    var p=new Proxy(obj,{
      ownKeys:function(t){ return Reflect.ownKeys(t).filter(function(k){ return k!==NATIVE; }); },
      getOwnPropertyDescriptor:function(t,k){ if(k===NATIVE) return undefined; return Reflect.getOwnPropertyDescriptor(t,k); },
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
        window.LEX_LANG_MAP=hideKey(m);
      }
      if(window.LEX_LANGS && !window.LEX_LANGS.__eylHidden){
        var n=window.LEX_LANGS;
        if(!n.pl) n.pl=PL_PWA;
        window.LEX_LANGS=hideKey(n);
      }
      /* Nazwy języków: oryginał zapamiętany, żeby przełączenie w locie działało w obie strony. */
      [window.LEX_LANG_MAP,window.LEX_LANGS].forEach(function(reg){
        if(!reg) return;
        Object.keys(reg).forEach(function(k){
          var o=reg[k]; if(!o || !EN_NAMES[k]) return;
          if(!o.__eylOrig) Object.defineProperty(o,'__eylOrig',{value:{label:o.label,name:o.name},enumerable:false});
          if(EN){ if('label' in o) o.label=EN_NAMES[k]; o.name=EN_NAMES[k]; }
          else { if(o.__eylOrig.label!==undefined) o.label=o.__eylOrig.label; o.name=o.__eylOrig.name; }
        });
      });
    }catch(e){ console.warn('[i18n] rejestry',e); }
  }

  /* ───────── 3. słownik interfejsu (native=en) ───────── */
  var DICT=null, FRAG=null, RICH={}, MISS=Object.create(null);
  /* Oryginały (po polsku) wszystkiego, co przetłumaczyliśmy — przełączenie EN→PL w locie je przywraca. */
  var OT=new WeakMap(), OA=new WeakMap(), OR=new WeakMap(), REV=Object.create(null), TITLE_O=null;
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
    var out=tr(v); if(out!==v){ n.nodeValue=out; OT.set(n,{o:v,t:out}); }
  }
  function doAttrs(el){
    if(el.isContentEditable || (el.hasAttribute && el.hasAttribute('data-noi18n')) || (el.parentNode && el.parentNode.nodeType===1 && skipEl(el.parentNode))) return;
    for(var i=0;i<ATTRS.length;i++){
      var a=ATTRS[i], v=el.getAttribute && el.getAttribute(a);
      if(v){ var o=tr(v); if(o!==v){ el.setAttribute(a,o); var ra=OA.get(el)||{}; ra[a]={o:v,t:o}; OA.set(el,ra); } }
    }
    if(el.tagName==='INPUT' && (el.type==='button'||el.type==='submit') && el.value){ var o2=tr(el.value); if(o2!==el.value){ var rv=OA.get(el)||{}; rv['\u0000value']={o:el.value,t:o2}; OA.set(el,rv); el.value=o2; } }
    if(el.tagName==='OPTION' && el.label && el.label!==el.textContent){ /* tekst opcji obsługuje doText */ }
  }
  function richNorm(h){ return h.replace(/&nbsp;/g,' ').replace(/[\u00a0\s]+/g,' ').trim(); }
  function doRich(el){
    if(!el.firstElementChild || el.childNodes.length>40) return false;
    var h=richNorm(el.innerHTML); var v=RICH[h];
    if(typeof v==='string' && v){ var o=el.innerHTML; el.innerHTML=v; OR.set(el,{o:o,t:el.innerHTML}); return true; }
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
  /* EN → PL bez przeładowania: przywraca oryginały; teksty z danych (kategorie, nazwy języków) — przez REV. */
  function nb(x){ return typeof x==='string'?x.replace(/[\u00a0\u202f]/g,' '):x; }
  /* Sieroty typograficzne landingu (jak skrypt lp4-typo) — dla tekstu przywróconego w locie. */
  var TYPO=/(^|[\s(\u201e"'\u2013\u2014])([aiouwzAIOUWZ]|[Oo]d|[Dd]o|[Nn]a|[Ww]e|[Zz]e)[ \t]/g;
  function typo(n,v){ try{ if(n.parentNode && n.parentNode.closest && n.parentNode.closest('.lp')) return v.replace(TYPO,'$1$2\u00A0').replace(TYPO,'$1$2\u00A0'); }catch(e){} return v; }
  function unwalk(root){
    if(!root || !root.querySelectorAll) return;
    var els=root.querySelectorAll('*'), i, r;
    var tw=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,null), n, list=[];
    while((n=tw.nextNode())) list.push(n);
    for(i=0;i<list.length;i++){
      n=list[i];
      try{
        if(n.nodeType===3){
          r=OT.get(n);
          if(r && nb(n.nodeValue)===nb(r.t)){ n.nodeValue=typo(n,r.o); OT.delete(n); continue; }
          var v=n.nodeValue, k=v && v.trim(); if(!k) continue;
          var p=REV[k.replace(/[\u00a0\u202f\s]+/g,' ')];
          if(p && !skipEl(n.parentNode)) n.nodeValue=v.match(/^\s*/)[0]+p+v.match(/\s*$/)[0];
        } else {
          var ra=OA.get(n); if(!ra) continue;
          for(var a in ra){
            if(a==='\u0000value'){ if(nb(n.value)===nb(ra[a].t)) n.value=ra[a].o; }
            else if(nb(n.getAttribute(a))===nb(ra[a].t)) n.setAttribute(a,ra[a].o);
          }
          OA.delete(n);
        }
      }catch(e){}
    }
    /* Bloki HTML (rich) — po przywróceniu tekstów w środku wracają dokładnie do stanu po podmianie. */
    for(i=0;i<els.length;i++){ r=OR.get(els[i]); if(r && els[i].isConnected && richNorm(els[i].innerHTML)===richNorm(r.t)){ els[i].innerHTML=r.o; OR.delete(els[i]); } }
    var lp=document.querySelector('.lp');
    if(lp){ var w2=document.createTreeWalker(lp,NodeFilter.SHOW_TEXT,null), t2; while((t2=w2.nextNode())){ if(t2.parentNode && SKIP_TAGS[t2.parentNode.nodeName]) continue; var v2=t2.nodeValue, x2=typo(t2,v2); if(x2!==v2) t2.nodeValue=x2; } }
  }
  var MO=null, busy=false;
  function observe(){
    if(MO || !document.body) return;
    MO=new MutationObserver(function(muts){
      if(busy || !EN || !DICT) return; busy=true;
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
  function translateTitle(){ try{ if(!EN) return; var t=tr(document.title); if(t!==document.title){ TITLE_O=document.title; document.title=t; } }catch(e){} }

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
          (rows||[]).forEach(function(x){ if(x && x.label && x.label_en){ if(!REV[x.label_en]) REV[x.label_en]=x.label; if(!DICT[x.label]){ DICT[x.label]=x.label_en; added++; } } });
          if(added){ buildFrag(); if(EN && document.body) walk(document.body); }
        }).catch(function(){});
    }catch(e){}
  }
  var DICT_P=null;
  function loadDict(){
    if(DICT_P) return DICT_P;
    var url='i18n/en.json?v='+V;
    return DICT_P=fetch(url,{cache:'force-cache'}).then(function(r){ return r.ok?r.json():{}; }).catch(function(){ return {}; })
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
    var start=function(){
      dictP.then(function(){ try{ walk(document.body); }catch(e){ console.warn('[i18n] walk',e); } translateTitle(); observe(); ready(); });
    };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
    new MutationObserver(translateTitle).observe(document.querySelector('title')||document.head,{childList:true,characterData:true,subtree:true});
  }
  // natywne okna (tłumaczone tylko w trybie EN — sprawdzane przy wywołaniu, bo język można zmienić w locie)
  ['alert','confirm','prompt'].forEach(function(k){
    var f=window[k]; if(typeof f!=='function') return;
    window[k]=function(msg){ var a=[].slice.call(arguments); if(EN && DICT){ if(typeof a[0]==='string') a[0]=tr(a[0]); if(k==='prompt'&&typeof a[1]==='string') a[1]=tr(a[1]); } return f.apply(window,a); };
  });
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
  if(typeof window.fetch==='function'){
    var _f=window.fetch;
    window.fetch=function(input,init){
      try{
        var url=(typeof input==='string')?input:(input&&input.url)||'';
        if(EN && url.indexOf('/functions/v1/super-endpoint')>=0 && init && typeof init.body==='string'){
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
    if(!EN){ var old=document.getElementById('eyl-ai-gate'); if(old) old.remove(); return; }
    var wrap=function(name,test){
      var f=window[name]; if(typeof f!=='function' || f.__eylGate) return;
      var g=function(){ if(EN && (!test || test.apply(this,arguments))){ soonBox(); return; } return f.apply(this,arguments); };
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
  /* Zmiana języka:
     - ekrany bez danych użytkownika (landing, logowanie) — w locie, bez przeładowania; układ się nie rusza,
       podmieniają się tylko teksty, w jednej klatce (View Transition, gdy przeglądarka ją ma);
     - pozostałe ekrany — przeładowanie pod zasłoną: zapamiętujemy ekran, zakładkę i przewinięcie,
       a nowa strona odsłania się dopiero gotowa (bez doczytywania elementów na oczach). */
  var IS_PWA=!!document.getElementById('app-root') || /app\.html/.test(location.pathname);
  var STATIC_PAGES={home:1,auth:1}, STALE=false, SW_KEY='eyl_sw';
  function hasSession(){
    try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(/^sb-.+-auth-token$/.test(k) && localStorage.getItem(k)) return true; } }catch(e){}
    return false;
  }
  function curPage(){ var a=document.querySelector('.page.active'); return a?a.id.replace(/^page-/,''):'home'; }
  function pwaScreen(){ var a=document.querySelector('#app-main .screen.active'); return a?a.id.replace(/^s-/,''):''; }
  function pwaLoginVisible(){ var l=document.getElementById('s-login'); return !!(l && l.offsetParent!==null && getComputedStyle(l).display!=='none'); }
  function pwaSheetOpen(){ var sw=document.querySelectorAll('.eyl-native-sw'); for(var i=0;i<sw.length;i++){ if(sw[i].isConnected && !sw[i].closest('#s-login')) return true; } return false; }
  function canLive(){
    if(IS_PWA) return pwaLoginVisible();
    try{ if(typeof window.eylDemoGuest==='function' && window.eylDemoGuest()) return false; }catch(e){}
    return !!STATIC_PAGES[curPage()];
  }

  try{ var cvcss=document.createElement('style'); cvcss.id='eyl-sw-css';
    cvcss.textContent='#eyl-sw-cover{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;background:var(--paper,#f8f7f4);opacity:0;transition:opacity .16s ease;pointer-events:none}'
      +'#eyl-sw-cover.on{opacity:1;pointer-events:auto}'
      +'#eyl-sw-cover i{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;border:2.5px solid rgba(26,35,64,.12);border-top-color:#c96a2a;animation:eylsw .8s linear infinite;opacity:0;transition:opacity .25s ease .6s}'
      +'#eyl-sw-cover.on i{opacity:1}@keyframes eylsw{to{transform:rotate(360deg)}}'
      +'::view-transition-old(root),::view-transition-new(root){animation-duration:.18s}';
    (document.head||document.documentElement).appendChild(cvcss); }catch(e){}
  function cover(bg,instant){
    var c=document.getElementById('eyl-sw-cover');
    if(!c){ c=document.createElement('div'); c.id='eyl-sw-cover'; c.innerHTML='<i></i>'; c.setAttribute('aria-hidden','true'); document.documentElement.appendChild(c); }
    if(bg) c.style.background=bg;
    if(instant){ c.style.transition='none'; c.classList.add('on'); void c.offsetWidth; c.style.transition=''; }
    else c.classList.add('on');
    return c;
  }
  function pageBg(){
    try{ var b=getComputedStyle(document.body).backgroundColor; if(b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; }catch(e){}
    return '';
  }
  function smoothReload(st){
    st=st||{};
    try{
      st.t=Date.now(); st.bg=pageBg();
      if(IS_PWA){ st.scr=pwaScreen(); st.sheet=pwaSheetOpen(); }
      else {
        var cp=curPage();
        if(!('page' in st)) st.page=cp;
        /* Sesja nauki nie przeżyje przeładowania: gość wraca do dema, zalogowany do Fiszek. */
        if(st.page==='tryb'){
          var guest=false; try{ guest=typeof window.eylDemoGuest==='function' && window.eylDemoGuest(); }catch(e){}
          if(guest){ st.page='home'; if(!st.call){ st.call='eylDemoStart'; st.args=['lang']; } } else st.page='community';
        }
        st.mat=window._matTab||null;
        st.y=(st.page===cp)?(window.scrollY||0):0;
        var ap=document.querySelector('.page.active'); st.ps=(st.page===cp && ap)?ap.scrollTop:0;
      }
      sessionStorage.setItem(SW_KEY,JSON.stringify(st));
    }catch(e){}
    cover(st.bg);
    try{ var url=new URL(location.href); if(url.searchParams.has('lang')){ url.searchParams.delete('lang'); history.replaceState(null,'',url.toString()); } }catch(e){}
    setTimeout(function(){ location.reload(); },170);
  }
  window.eylSmoothReload=smoothReload;

  /* Po przełączeniu w locie zalogowany użytkownik ma w pamięci dane w starym języku —
     pierwsze wejście w część z danymi idzie przez płynne przeładowanie (i od razu tam, dokąd kliknął). */
  var GATEWAYS=['showPage','navPowtorki','powtorkiEnter','startSrsSession','eylDemoStart','startTrybMode','showTrybSetPicker','showTrybModePicker','openSet','openCreateSet','handleCreateSet','eylGoNauka','eylGoTrener'];
  function armStale(){
    STALE=true;
    GATEWAYS.forEach(function(n){
      var f=window[n]; if(typeof f!=='function' || f.__eylStale) return;
      var g=function(){
        var a=[].slice.call(arguments);
        if(STALE && !(n==='showPage' && STATIC_PAGES[a[0]])){
          if(n==='showPage') smoothReload({page:a[0]});
          else smoothReload({call:n,args:a.map(function(x){ return (x==null||typeof x!=='object')?x:null; })});
          return;
        }
        return f.apply(this,arguments);
      };
      g.__eylStale=true; window[n]=g;
    });
  }

  function remountSwitches(){
    var sw=document.querySelectorAll('.eyl-native-sw');
    for(var i=0;i<sw.length;i++){ var t=document.createElement('span'); t.innerHTML=window.eylNativeSwitchHTML(); sw[i].replaceWith(t.firstChild); }
  }
  function langRev(){
    [window.LEX_LANG_MAP,window.LEX_LANGS].forEach(function(reg){
      if(!reg) return;
      for(var k in EN_NAMES){ try{ var o=reg[k]; if(o && o.__eylOrig){ var pl=o.__eylOrig.label||o.__eylOrig.name; if(pl && !REV[EN_NAMES[k]]) REV[EN_NAMES[k]]=pl.charAt(0).toUpperCase()+pl.slice(1); } }catch(e){} }
    });
  }
  async function liveSwitch(v){
    if(v==='en'){ await loadDict(); }
    langRev();
    var apply=function(){
      busy=true;
      try{
        setMode(v);
        patchAll();
        if(EN){ walk(document.body); translateTitle(); observe(); }
        else { unwalk(document.body); if(TITLE_O){ document.title=TITLE_O; TITLE_O=null; } }
        gate(); remountSwitches();
      }catch(e){ console.warn('[i18n] live',e); }
      finally{ busy=false; }
    };
    if(typeof document.startViewTransition==='function'){ try{ document.startViewTransition(apply); return; }catch(e){} }
    apply();
  }
  function saveProfile(v){
    try{
      var c=client(); if(!c || !c.auth) return Promise.resolve();
      return c.auth.getUser().then(function(r){ var u=r && r.data && r.data.user; if(u) return c.rpc('set_native_lang',{p_lang:v}); }).catch(function(){});
    }catch(e){ return Promise.resolve(); }
  }
  window.eylSetNative=async function(v){
    if(v!=='pl' && v!=='en') return;
    if(v===NATIVE){ return; }
    lsSet(KEY,v);
    if(canLive()){
      var logged=hasSession();
      saveProfile(v);
      await liveSwitch(v);
      if(logged && !IS_PWA) armStale();
      return;
    }
    cover(pageBg());
    /* Profil zapisany przed przeładowaniem — inaczej synchronizacja po starcie mogłaby cofnąć wybór. */
    await Promise.race([saveProfile(v), new Promise(function(r){ setTimeout(r,2500); })]);
    smoothReload();
  };

  /* Start po płynnym przeładowaniu: zasłona od pierwszej klatki, odtworzenie ekranu, odsłonięcie gotowej strony. */
  (function restoreAfterSwitch(){
    var st=null;
    try{ st=JSON.parse(sessionStorage.getItem(SW_KEY)||'null'); sessionStorage.removeItem(SW_KEY); }catch(e){}
    if(!st || !st.t || Date.now()-st.t>20000) return;
    cover(st.bg,true);
    var t0=Date.now(), stage=0, lastMut=Date.now(), tR=Date.now();
    var mo=new MutationObserver(function(){ lastMut=Date.now(); });
    try{ mo.observe(document.documentElement,{childList:true,subtree:true,characterData:true}); }catch(e){}
    function booted(){
      if(IS_PWA){ var m=document.getElementById('app-main'); return (m && !m.classList.contains('hide')) || (Date.now()-t0>2500 && pwaLoginVisible()); }
      return document.readyState!=='loading' && !document.getElementById('eyl-boot-gate');
    }
    function restore(){
      try{
        if(IS_PWA){
          if(st.scr && st.scr!==pwaScreen() && typeof window.go==='function' && document.getElementById('s-'+st.scr)) window.go(st.scr);
          if(st.sheet && typeof window.askLogout==='function') window.askLogout();
        } else {
          var pg=st.page||'home';
          if((pg==='teacher'||pg==='chat') && EN) pg='dash';
          if(pg==='strefa') pg='community';
          if(st.mat) window._matTab=st.mat;
          if(pg!==curPage() && document.getElementById('page-'+pg) && typeof window.showPage==='function') window.showPage(pg);
          if(pg==='community' && st.mat && typeof window.switchMatTab==='function') window.switchMatTab(st.mat);
        }
        if(st.call && typeof window[st.call]==='function') window[st.call].apply(window,st.args||[]);
      }catch(e){ console.warn('[i18n] restore',e); }
    }
    function reveal(){
      try{ mo.disconnect(); }catch(e){}
      try{ if(st.y) window.scrollTo(0,st.y); }catch(e){}
      try{ var ap=document.querySelector('.page.active'); if(st.ps && ap) ap.scrollTop=st.ps; }catch(e){}
      var c=document.getElementById('eyl-sw-cover'); if(!c) return;
      c.style.transition='opacity .22s ease'; c.classList.remove('on');
      setTimeout(function(){ if(c.parentNode) c.parentNode.removeChild(c); },300);
    }
    (function tick(){
      var el=Date.now()-t0;
      if(stage===0){
        if(booted() || el>7000){ stage=1; lastMut=Date.now(); setTimeout(function(){ restore(); lastMut=tR=Date.now(); tick(); },30); return; }
      } else {
        var navGate=document.getElementById('eyl-nav-gate');
        var ready=(!EN || document.documentElement.classList.contains('eyl-i18n-ready'))
          && !(navGate && navGate.classList.contains('on'))
          && (Date.now()-lastMut>250 || Date.now()-tR>1200);
        if(ready || el>8000){ reveal(); return; }
      }
      setTimeout(tick,50);
    })();
  })();

  /* Po zalogowaniu: profil ma pierwszeństwo, gdy użytkownik nie wybrał nic na tym urządzeniu.
     Gdy wybrał (localStorage), a profil ma domyślne pl — zapisujemy wybór do profilu. */
  async function syncProfile(){
    var c=client(); if(!c || !c.auth) return false;
    try{
      var u=(await c.auth.getUser()).data.user; if(!u) return true;
      var r=await c.from('profiles').select('native_lang').eq('user_id',u.id).maybeSingle();
      var p=r && r.data && r.data.native_lang;
      var local=lsGet(KEY);
      if(!local && p && p!==NATIVE){ lsSet(KEY,p); smoothReload(); return true; }
      if(local && p && p!==local){
        if(local==='en' && p==='pl'){ await c.rpc('set_native_lang',{p_lang:'en'}); }
        else { lsSet(KEY,p); smoothReload(); }
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
  try{ var swcss=document.createElement('style'); swcss.textContent='@media (max-width:640px){nav [data-eyl-native-switch]{display:none!important}}'; (document.head||document.documentElement).appendChild(swcss); }catch(e){}
  function mountSwitches(){
    var els=document.querySelectorAll('[data-eyl-native-switch]:not([data-mounted])');
    for(var i=0;i<els.length;i++){ els[i].innerHTML=window.eylNativeSwitchHTML(); els[i].setAttribute('data-mounted','1'); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mountSwitches); else mountSwitches();
  setInterval(mountSwitches,1500);
})();
