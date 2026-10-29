/* Eyelingo — jednolite tempo ładowania (web + PWA).
   Problem: po kliknięciu fragmenty ekranu (lista, liczniki, panel boczny) dochodzą z bazy w różnym czasie,
   więc ekran „składa się” na oczach.
   Zasada: od kliknięcia (lub Entera) do chwili, gdy skończą się zapytania odczytu wywołane tym działaniem,
   każdy fragment, który się zmienia, jest wstrzymany (niewidoczny, układ zostaje), a potem WSZYSTKIE
   pokazują się razem jednym, tym samym przejściem. Zmiany bez sieci (zakładka, przewrócenie fiszki)
   idą od razu — nic nie jest spowalniane.
   MutationObserver działa przed malowaniem klatki, więc wstrzymany fragment nie mignie.
   Bez zmian: sesje nauki (fiszka, odpowiedzi, Ailex), pola tekstowe, toasty, zasłony.
   Ładowany zaraz po i18n.js — przed utworzeniem klienta Supabase (supabase-js zapamiętuje fetch). */
(function(){
  'use strict';
  if(window.__eylSettle) return; window.__eylSettle=true;

  var MAX_MS=3500, QUIET_MS=240, SPIN_AFTER=380;
  var EXCLUDE='nav,.nav,#nav,[id^="tryb-card"],#tryb-answer-input,#tryb-confetti,[id^="srs-"],[id^="lex-"],[id^="lexx"],#page-teacher,#imm-lex,#imm-alex,#imm-powt,'
    +'#eyl-sw-cover,#eyl-nav-gate,#eyl-boot-gate,#eyl-settle-spin,.toast,[role="tooltip"],[data-nosettle]';
  var ROOTS={HTML:1,BODY:1,HEAD:1}, NOHOLD={STYLE:1,SCRIPT:1,LINK:1,META:1,TITLE:1,NOSCRIPT:1,TEMPLATE:1};

  /* ── śledzenie zapytań odczytu ── */
  var win=null;                         // bieżące okno działania użytkownika
  function isRead(url,method){
    if(!/\/rest\/v1\/|\/functions\/v1\//.test(url)) return false;
    if(/\/functions\/v1\//.test(url)) return false;          // AI i inne funkcje — długie, nie wstrzymujemy ekranu
    var m=(method||'GET').toUpperCase();
    if(m==='GET' || m==='HEAD') return true;
    var rpc=url.match(/\/rest\/v1\/rpc\/([a-z0-9_]+)/i);
    if(rpc && m==='POST') return !/^(set|save|upsert|insert|update|delete|del|log|track|rate|mark|add|remove|activate|create|submit|record|bump|touch|claim|redeem|send|join|leave|link|unlink|accept|reject|admin)/i.test(rpc[1]);
    return false;
  }
  if(typeof window.fetch==='function'){
    var _f=window.fetch;
    window.fetch=function(input,init){
      var p=_f.apply(this,arguments);
      try{
        var w=win;
        if(window.__eylSettleTrace && !(w && !w.done)) window.__eylSettleTrace.push(['F-nowin',String(typeof input==='string'?input:(input&&input.url)).slice(-60)]);
        if(w && !w.done){
          var url=(typeof input==='string')?input:(input&&input.url)||'';
          var method=(init&&init.method)||(input&&input.method)||'GET';
          if(isRead(url,method)){
            w.pending++; w.used=true; if(window.__eylSettleTrace) window.__eylSettleTrace.push(['F+',Date.now()-w.t0,url.slice(-60)]);
            var fin=function(){ w.pending=Math.max(0,w.pending-1); w.last=Date.now(); schedule(w); };
            p.then(fin,fin);
          }
        }
      }catch(e){}
      return p;
    };
  }

  /* ── wstrzymywanie zmienianych fragmentów ── */
  var css=document.createElement('style');
  css.id='eyl-settle-css';
  css.textContent='.eyl-hold{opacity:0!important;transition:none!important;animation:none!important}'
    +'.eyl-in{animation:eylSettleIn .2s ease both}'
    +'@keyframes eylSettleIn{from{opacity:0}}'
    +'#eyl-settle-spin{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:140;pointer-events:none;opacity:0;transition:opacity .2s ease}'
    +'#eyl-settle-spin.on{opacity:1}'
    +'@media (prefers-reduced-motion:reduce){.eyl-in{animation:none}}';
  (document.head||document.documentElement).appendChild(css);

  function excluded(el){
    try{ return !!(el.closest && el.closest(EXCLUDE)); }catch(e){ return true; }
  }
  function focusedInside(el){
    var a=document.activeElement;
    return !!(a && a!==document.body && el.contains && el.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName));
  }
  function big(el){
    if(ROOTS[el.tagName]) return true;
    if(el.id==='app-root' || el.id==='app-main' || (el.classList && (el.classList.contains('page') || el.classList.contains('app') || el.classList.contains('phone')))) return true;
    return false;
  }
  function hold(w,el){
    if(!el || el.nodeType!==1 || w.held.has(el) || NOHOLD[el.tagName]) return;
    if(excluded(el) || focusedInside(el)) return;
    for(var p=el.parentNode; p && p.nodeType===1; p=p.parentNode){ if(w.held.has(p)) return; }   // przodek już wstrzymany
    w.held.add(el); el.classList.add('eyl-hold');
  }
  var mo=new MutationObserver(function(muts){
    var w=win; if(!w || w.done || (!w.pending && !w.used)) return;   // działanie bez zapytań — zmiany idą od razu
    w.last=Date.now();
    if(window.__eylSettleTrace) window.__eylSettleTrace.push([Date.now()-w.t0,muts.length,muts[0].target.id||muts[0].target.className||muts[0].target.nodeName]);
    /* Pełna podmiana zawartości na identyczną (np. panel boczny, licznik rysowany od nowa) — nie wstrzymujemy,
       bo nic się wizualnie nie zmienia. Pamiętamy stan sprzed okna: gdy wróci identyczny, zdejmujemy wstrzymanie. */
    var seen=new Map();
    for(var i=0;i<muts.length;i++){
      var m=muts[i], t=m.target;
      if(m.type==='characterData'){
        var pe=t.parentNode; if(!pe || big(pe)) continue;
        if(m.oldValue===t.nodeValue) continue;
        if(!w.prev.has(pe)) w.prev.set(pe,null);
        hold(w,pe); continue;
      }
      if(m.type!=='childList' || t.nodeType!==1) continue;
      if(big(t)){
        for(var j=0;j<m.addedNodes.length;j++){ var a=m.addedNodes[j]; if(a.nodeType===1 && !big(a)) hold(w,a); }
        continue;
      }
      var rec=seen.get(t); if(!rec){ rec={rem:[],first:!w.prev.has(t)}; seen.set(t,rec); }
      for(var k=0;k<m.removedNodes.length;k++) rec.rem.push(m.removedNodes[k]);
    }
    seen.forEach(function(rec,t){
      if(rec.first){
        var old=''; for(var k=0;k<rec.rem.length;k++){ var n=rec.rem[k]; old+=n.nodeType===1?n.outerHTML:(n.nodeType===3?n.nodeValue:''); }
        w.prev.set(t, rec.rem.length ? old : null);
      }
      var pv=w.prev.get(t);
      if(pv!=null && t.innerHTML===pv){
        if(w.held.has(t)){ w.held.delete(t); t.classList.remove('eyl-hold'); }
        return;
      }
      if(!(t.classList && t.classList.contains('eyl-hold'))) hold(w,t);
    });
    schedule(w);
  });
  function startObs(){ try{ mo.observe(document.documentElement,{childList:true,subtree:true,characterData:true,characterDataOldValue:true}); }catch(e){} }
  if(document.documentElement) startObs();

  /* ── spinner przy dłuższym czekaniu ── */
  function spin(on){
    var s=document.getElementById('eyl-settle-spin');
    if(on){
      if(!s){
        s=document.createElement('div'); s.id='eyl-settle-spin'; s.setAttribute('aria-hidden','true');
        var big=/app\.html/.test(location.pathname)||!!document.getElementById('app-root');
        s.innerHTML=(typeof window.eyelingoSpinner==='function')?window.eyelingoSpinner(big?96:72):'';
        (document.body||document.documentElement).appendChild(s);
      }
      requestAnimationFrame(function(){ s.classList.add('on'); });
    } else if(s){ s.classList.remove('on'); setTimeout(function(){ if(s.parentNode && !s.classList.contains('on')) s.parentNode.removeChild(s); },250); }
  }

  /* ── okno działania ── */
  function schedule(w){
    clearTimeout(w.tm);
    if(w.done) return;
    var now=Date.now();
    if(now-w.t0>=MAX_MS){ release(w); return; }
    if(w.held.size && !w.spinT) w.spinT=setTimeout(function(){ if(!w.done && w.held.size) spin(true); },SPIN_AFTER);
    var g=document.getElementById('eyl-nav-gate');
    if(g && g.classList.contains('on')){ w.last=now; w.tm=setTimeout(function(){ schedule(w); },80); return; }   // brama strony aplikacji jeszcze trzyma — czekamy razem z nią
    var wait=w.pending ? 120 : Math.max(0,QUIET_MS-(now-w.last));
    if(!w.pending && wait===0 && w.used){ release(w); return; }
    if(!w.pending && !w.used && now-w.t0>400){ release(w); return; }   // działanie bez zapytań — zamykamy okno
    w.tm=setTimeout(function(){ schedule(w); }, wait||60);
  }
  function release(w){
    if(w.done) return; w.done=true; if(window.__eylSettleTrace) window.__eylSettleTrace.push(['REL',Date.now()-w.t0]);
    clearTimeout(w.tm); clearTimeout(w.spinT); clearTimeout(w.cap);
    var els=[]; w.held.forEach(function(el){ els.push(el); });
    requestAnimationFrame(function(){
      for(var i=0;i<els.length;i++){
        var el=els[i]; el.classList.remove('eyl-hold');
        if(el.isConnected){ el.classList.add('eyl-in'); }
      }
      setTimeout(function(){ for(var i=0;i<els.length;i++) els[i].classList.remove('eyl-in'); },260);
      spin(false);
    });
    if(win===w) win=null;
  }
  function begin(){
    if(win && !win.done){
      // kolejne kliknięcie w trakcie — wstrzymane fragmenty zostają, licznik trwa (jedno odsłonięcie na końcu)
      win.t0=Date.now(); win.last=Date.now(); schedule(win); return;
    }
    var w={t0:Date.now(),last:Date.now(),pending:0,used:false,held:new Set(),prev:new Map(),done:false,tm:null,spinT:null};
    w.cap=setTimeout(function(){ release(w); },MAX_MS+100);
    win=w; schedule(w);
  }
  function interactive(t){
    if(!t || !t.closest) return null;
    return t.closest('a,button,[onclick],[role="button"],[role="tab"],.nav-tab,.mat-tab,label,select,summary');
  }
  document.addEventListener('click',function(e){
    var el=interactive(e.target); if(!el) return;
    if(excluded(el)) return;
    begin();
  },true);
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter') return;
    var t=e.target; if(!t || excluded(t)) return;
    if(t.tagName==='TEXTAREA') return;
    begin();
  },true);
  window.addEventListener('hashchange',function(){ begin(); });
  window.addEventListener('popstate',function(){ begin(); });

  window.eylSettleBegin=begin;          // dla kodu, który zmienia ekran bez kliknięcia
  window.eylSettleDebug=function(){ return win?{pending:win.pending,held:win.held.size,age:Date.now()-win.t0}:null; };
})();
