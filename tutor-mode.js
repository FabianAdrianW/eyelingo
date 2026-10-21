/* ═══════════════════════════════════════════════════════════════════════
   Eyelingo — TRYB NAUCZYCIELA (web index.html + PWA app.html)
   Dwa istniejące konta łączą się kodem/QR; jedno występuje jako nauczyciel (PRO).
   Baza: migracja 20261021_tutor_mode.sql (tutor_links, tutor_link_sets, tutor_link_codes + RPC).
   Zasady:
   • nauka w trybie nauczyciela NIE zapisuje się do powtórek (straż zapisu poniżej),
   • tryb żyje tylko w sesji karty (sessionStorage) — po zamknięciu karty wraca normalny zapis,
   • bez wdrożonej migracji wszystko degraduje się do komunikatu, nic się nie wysypuje.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if(window.EylTutor) return;
  var T = window.EylTutor = {};
  var SS = 'eyl_tutor_mode';
  var IS_PWA = !!document.getElementById('s-mine') && !document.getElementById('mat-main-content');

  /* ───── narzędzia ───── */
  function DB(){ try{ return (typeof db!=='undefined' && db) ? db : (window.db||null); }catch(e){ return window.db||null; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function toast(m){ try{ if(typeof window.eylNote==='function'){ window.eylNote(m); return; } }catch(e){} try{ if(typeof window.showToast==='function'){ window.showToast(m); return; } }catch(e){} }
  function $(id){ return document.getElementById(id); }
  async function uid(){ try{ var d=DB(); if(!d) return null; var s=(await d.auth.getSession()).data.session; return s?s.user.id:null; }catch(e){ return null; } }

  /* Kod: 8 znaków A–Z2–9 (bez 0/O/1/I). Akceptuje małe litery, myślnik, spacje, pełny link ?join= */
  T.normCode = function(raw){
    var s = String(raw||'');
    var m = s.match(/[?&]join=([A-Za-z0-9-]+)/);
    if(m) s = m[1];
    return s.toUpperCase().replace(/[^A-Z0-9]/g,'');
  };
  T.fmtCode = function(c){ c=String(c||''); return c.length===8 ? c.slice(0,4)+'-'+c.slice(4) : c; };
  T.joinUrl = function(code){ return location.origin + '/?join=' + encodeURIComponent(code); };

  /* ───── RPC z mapowaniem błędów ───── */
  var ERR = {
    pro_required:'Tryb nauczyciela wymaga konta PRO.',
    too_many_attempts:'Za dużo błędnych prób. Spróbuj ponownie za 10 minut.',
    too_many_codes:'Masz już 20 aktywnych kodów. Poczekaj, aż któryś wygaśnie lub zostanie użyty.',
    not_authenticated:'Zaloguj się, aby kontynuować.',
    not_found:'Nie znaleziono powiązania.'
  };
  function mapErr(e){
    var m=String((e&&e.message)||e||''), c=String((e&&e.code)||'');
    if(c==='PGRST202' || /Could not find the function|schema cache|does not exist|relation .* does not exist/i.test(m)) return 'Funkcja jest w przygotowaniu (baza nie ma jeszcze migracji trybu nauczyciela).';
    for(var k in ERR){ if(m.indexOf(k)>=0) return ERR[k]; }
    return 'Błąd: '+m;
  }
  async function rpc(name,args){
    var d=DB(); if(!d) throw new Error('Brak połączenia z bazą.');
    var r=await d.rpc(name,args||{});
    if(r.error){
      var er=new Error(mapErr(r.error)); er.raw=r.error;
      if(er.message.indexOf('w przygotowaniu')>=0) window.__tutorNoDb=true;   // migracja nie wdrożona → funkcja niewidoczna
      throw er;
    }
    return r.data;
  }
  async function isPro(){
    try{
      if(typeof window.eylIsPremium==='function') return !!(await window.eylIsPremium());
      var u=await uid(); if(!u) return false;
      var r=await DB().from('profiles').select('is_premium,premium_until').eq('user_id',u).maybeSingle();
      var p=r&&r.data; if(!p) return false;
      var until=p.premium_until?new Date(p.premium_until):null;
      return !!(p.is_premium && (!until || until>new Date()));
    }catch(e){ return false; }
  }

  /* ═══════ 1. STRAŻ ZAPISU — w trybie nauczyciela nic nie trafia do powtórek ═══════ */
  T.on = function(){ return !!window._tutorMode; };
  // tryb nie przeżywa odświeżenia poza „Moje fiszki" (web) i w ogóle nie przeżywa go w aplikacji
  try{ window._tutorMode = !IS_PWA && sessionStorage.getItem(SS)==='1' && /^#(community|strefa)/.test(location.hash); }catch(e){ window._tutorMode=false; }

  var BLOCKED = {srs_progress:1, word_progress:1, grammar_progress:1};
  var WRITES  = {upsert:1, insert:1, update:1, delete:1};
  function nullBuilder(){
    var done=Promise.resolve({data:null,error:null,status:204,count:null});
    var b={};
    ['select','eq','neq','in','is','match','order','limit','single','maybeSingle','not','filter','range','returns'].forEach(function(k){ b[k]=function(){ return b; }; });
    b.then=function(a,r){ return done.then(a,r); };
    b['catch']=function(r){ return done['catch'](r); };
    b['finally']=function(f){ return done['finally'](f); };
    return b;
  }
  function guardDb(){
    var d=DB(); if(!d || d.__tutorGuard || typeof d.from!=='function') return !!(d&&d.__tutorGuard);
    var orig=d.from.bind(d);
    d.from=function(t){
      var q=orig(t);
      if(window._tutorMode && BLOCKED[t]){
        return new Proxy(q,{ get:function(tg,p){
          if(WRITES[p]) return function(){ return nullBuilder(); };
          var v=tg[p]; return (typeof v==='function') ? v.bind(tg) : v;
        }});
      }
      return q;
    };
    d.__tutorGuard=true; return true;
  }
  // lokalny cache powtórek (web: usrsRecord/_usrsSaveAll; PWA: nazwy z app.html poniżej)
  function guardFns(){
    ['usrsRecord','_usrsSaveAll','_pwSaveSRS','pwSaveSRS','_pwRecord'].forEach(function(n){
      var f=window[n]; if(typeof f!=='function' || f.__tutorGuard) return;
      var w=function(){ if(window._tutorMode) return (n==='usrsRecord'||/Record|Save/.test(n)) ? Promise.resolve() : undefined; return f.apply(this,arguments); };
      w.__tutorGuard=true; window[n]=w;
    });
  }
  (function installGuards(){
    var tries=0;
    (function tick(){
      var okDb=guardDb(); guardFns();
      if(!okDb && tries++<200) setTimeout(tick,100);
      else if(tries++<30) setTimeout(tick,500);    // funkcje mogą pojawić się po załadowaniu skryptów strony
    })();
  })();

  /* ═══════ 2. MODALE ═══════ */
  function css(){
    if($('tmd-css')) return;
    var s=document.createElement('style'); s.id='tmd-css';
    s.textContent=
      '.tmd-ov{position:fixed;inset:0;z-index:100001;background:rgba(26,35,64,.45);display:flex;align-items:center;justify-content:center;padding:18px}'
     +'.tmd{width:100%;max-width:440px;max-height:88vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 18px 60px rgba(26,35,64,.25);padding:22px;font-family:"DM Sans",system-ui,sans-serif;color:var(--navy,#1a2340)}'
     +'.tmd h3{margin:0 0 6px;font-size:18px;font-weight:600}.tmd p{margin:0 0 14px;font-size:14px;line-height:1.5;color:var(--dim,#5b6478)}'
     +'.tmd-in{width:100%;box-sizing:border-box;padding:12px 14px;border:1.5px solid var(--border2,#d8d2c0);border-radius:12px;font-size:20px;letter-spacing:3px;text-transform:uppercase;text-align:center;font-family:inherit}'
     +'.tmd-in.tmd-txt{letter-spacing:0;text-transform:none;text-align:left;font-size:15px}'
     +'.tmd-row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}'
     +'.tmd-b{padding:10px 18px;border-radius:100px;font-size:14px;font-weight:500;cursor:pointer;font-family:inherit;border:1.5px solid var(--border2,#d8d2c0);background:transparent;color:var(--navy,#1a2340)}'
     +'.tmd-b.p{background:var(--navy,#1a2340);color:#fff;border-color:var(--navy,#1a2340)}.tmd-b.o{background:var(--orange,#c96a2a);color:#fff;border-color:var(--orange,#c96a2a)}.tmd-b.d{color:#b3261e;border-color:#e3b4b0}'
     +'.tmd-b[disabled]{opacity:.5;cursor:default}'
     +'.tmd-code{font-size:32px;font-weight:700;letter-spacing:5px;text-align:center;padding:12px;border-radius:14px;background:rgba(26,35,64,.06);margin:8px 0;user-select:all}'
     +'.tmd-qr{display:flex;justify-content:center;margin:10px 0}.tmd-qr svg{width:190px;height:190px}'
     +'.tmd-err{color:#b3261e;font-size:13px;margin-top:8px;min-height:16px}'
     +'.tmd-chk{display:flex;align-items:center;gap:10px;padding:10px 6px;border-bottom:1px solid rgba(26,35,64,.08);font-size:14px;cursor:pointer}'
     +'.tmd-chk input{width:18px;height:18px}.tmd-chk small{color:var(--dim2,#646c80);margin-left:auto}'
     +'.tmd-menu{display:flex;flex-direction:column;gap:8px;margin-top:10px}.tmd-menu .tmd-b{width:100%;text-align:center;padding:13px}'
     +'@media (max-width:600px){.tmd-ov{align-items:flex-end;padding:0}.tmd{max-width:none;border-radius:20px 20px 0 0;padding-bottom:calc(22px + env(safe-area-inset-bottom,0px))}}'
     +'#tutor-panel{display:none}'
     +'#mat-main-content .page-head{align-items:flex-start;gap:14px}#mat-main-content .page-head > div:first-child{flex:1;min-width:0}#mat-main-content .page-head > .tsw{flex-shrink:0;align-self:flex-start;margin-top:2px}'
     +'#mat-main-content.tutor-on > *:not(.page-head):not(#tutor-panel){display:none !important}'
     +'#mat-main-content.tutor-on #tutor-panel{display:block}'
     +'#mat-main-content.tutor-on #mat-search,#mat-main-content.tutor-on #mat-create-btn,#mat-main-content.tutor-on #mat-create-ai-btn{display:none !important}'
     +'#s-mine.tutor-on #tutor-panel{display:block}'
     +'#s-mine.tutor-on #mine-list,#s-mine.tutor-on #ns-entry,#s-mine.tutor-on #tutor-student-bar{display:none !important}'
     /* przełącznik (web) */
     +'.tsw{display:inline-flex;align-items:center;gap:10px;padding:7px 8px 7px 16px;border-radius:100px;border:1.5px solid var(--border2,#d8d2c0);background:#fff;cursor:pointer;font:500 14px "DM Sans",system-ui,sans-serif;color:var(--navy,#1a2340);white-space:nowrap;transition:.2s}'
     +'.tsw:hover{border-color:var(--navy,#1a2340)}.tsw.on{border-color:var(--orange,#c96a2a);background:rgba(201,106,42,.08)}'
     +'.tsw-track{position:relative;width:46px;height:26px;border-radius:100px;background:#cfc9b8;transition:.2s;flex-shrink:0}'
     +'.tsw-knob{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.28);transition:.22s cubic-bezier(.3,1.3,.5,1)}'
     +'.tsw.on .tsw-track{background:var(--orange,#c96a2a)}.tsw.on .tsw-knob{left:23px}'
     /* przełącznik (aplikacja) */
     +'.tseg{position:relative;display:grid;grid-template-columns:1fr 1fr;padding:4px;border-radius:14px;background:rgba(26,35,64,.07);margin:0 0 18px}'
     +'.tseg-ind{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:11px;background:#fff;box-shadow:0 1px 6px rgba(26,35,64,.16);transition:transform .25s cubic-bezier(.3,1.2,.5,1)}'
     +'.tseg.on .tseg-ind{transform:translateX(100%);background:var(--orange,#c96a2a)}'
     +'.tseg button{position:relative;z-index:1;border:0;background:transparent;padding:11px 6px;font-weight:600;font-size:14px;font-family:inherit;color:var(--dim,#5b6478);cursor:pointer;border-radius:11px;transition:color .2s}'
     +'.tseg:not(.on) button[data-m="0"],.tseg.on button[data-m="1"]{color:var(--navy,#1a2340)}.tseg.on button[data-m="1"]{color:#fff}'
     /* panel */
     +'.tp-note{display:flex;align-items:flex-start;gap:9px;padding:11px 14px;border-radius:12px;background:rgba(201,106,42,.09);color:var(--navy,#1a2340);font-size:13.5px;line-height:1.45;margin:0 0 18px}.tp-note svg{flex-shrink:0;margin-top:2px;color:var(--orange,#c96a2a)}'
     +'.tp-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 14px;flex-wrap:wrap}'
     +'.tp-h{font-size:20px;font-weight:600;color:var(--navy,#1a2340);line-height:1.2}.tp-sub{font-size:13px;color:var(--dim2,#646c80);margin-top:3px}'
     +'.tb{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:10px 18px;border-radius:100px;border:1.5px solid var(--border2,var(--line2,#d8d2c0));background:#fff;color:var(--navy,#1a2340);font:500 14px "DM Sans",system-ui,sans-serif;font-family:inherit;cursor:pointer;transition:.15s;white-space:nowrap}'
     +'.tb:hover{border-color:var(--navy,#1a2340)}.tb.pri{background:var(--orange-btn,var(--orange,#c96a2a));border-color:transparent;color:#fff}.tb.navy{background:var(--navy,#1a2340);border-color:transparent;color:#fff}.tb.orange{border-color:var(--orange,#c96a2a);color:var(--orange,#c96a2a);background:transparent}'
     +'.tb.ghost{background:transparent}.tb.icon{padding:9px 11px}.tb.sm{padding:7px 13px;font-size:13px}.tb.big{width:100%;padding:15px;font-size:15px;margin-top:6px}.tb.back{padding:7px 14px;font-size:13px;margin:0 0 14px}'
     +'.tp-list{display:flex;flex-direction:column;gap:10px}'
     +'.sr{display:flex;align-items:center;gap:14px;width:100%;box-sizing:border-box;text-align:left;padding:14px 16px;border-radius:16px;border:1.5px solid var(--border,var(--line,#e6e0d0));background:#fff;cursor:pointer;font-family:inherit;color:var(--navy,#1a2340);transition:.15s}.sr:hover{border-color:var(--navy,#1a2340);transform:translateY(-1px)}'
     +'.sr-av{width:42px;height:42px;border-radius:50%;background:rgba(26,35,64,.09);color:var(--navy,#1a2340);display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:17px;flex-shrink:0}.sr-av.big{width:52px;height:52px;font-size:21px}'
     +'.sr-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.sr-tx b{font-size:15.5px;font-weight:600}.sr-tx small{font-size:13px;color:var(--dim2,#646c80)}.sr-ch{color:var(--dim2,#646c80);display:flex}'
     +'.tp-steps{display:flex;flex-direction:column;gap:12px;max-width:560px}'
     +'.tp-step{display:flex;gap:14px;align-items:flex-start;padding:14px 16px;border-radius:16px;background:#fff;border:1.5px solid var(--border,var(--line,#e6e0d0))}'
     +'.tp-step>span{width:28px;height:28px;border-radius:50%;background:var(--navy,#1a2340);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;flex-shrink:0}.tp-step b{display:block;font-size:14.5px}.tp-step small{display:block;font-size:13px;color:var(--dim2,#646c80);margin-top:2px;line-height:1.45}'
     +'.th{display:flex;align-items:center;gap:14px;margin:0 0 14px}.th-tx{flex:1;min-width:0}.th-tx .tp-h{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
     +'.tp-actions{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}'
     +'.tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}'
     +'.tc{display:flex;flex-direction:column;border:1.5px solid var(--border,#e6e0d0);border-radius:16px;background:#fff;overflow:hidden}'
     +'.tc-top{display:flex;align-items:center;gap:12px;padding:15px 16px 10px;cursor:pointer}.tc-fl{width:38px;height:38px;border-radius:10px;background:rgba(26,35,64,.06);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--navy,#1a2340)}'
     +'.tc-tx{min-width:0;display:flex;flex-direction:column;gap:2px}.tc-tx b{font-size:15px;font-weight:600;color:var(--navy,#1a2340);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tc-tx small{font-size:12.5px;color:var(--dim2,#646c80)}'
     +'.tc-act{display:flex;gap:7px;flex-wrap:wrap;padding:6px 16px 14px}'
     +'.tc-ft{margin-top:auto;border-top:1px solid rgba(26,35,64,.08);padding:8px 12px;display:flex;justify-content:flex-end}'
     +'.tc-un{border:0;background:transparent;color:#b3261e;font:500 12.5px "DM Sans",system-ui,sans-serif;font-family:inherit;cursor:pointer;padding:6px 8px;border-radius:8px}.tc-un:hover{background:rgba(179,38,30,.08)}'
     +'.trows{display:flex;flex-direction:column;gap:10px}'
     +'.trow{display:flex;align-items:center;gap:12px;padding:12px 10px 12px 14px;border-radius:16px;background:#fff;border:.5px solid var(--line,#e6e0d0);cursor:pointer}'
     +'.trow-ic{width:40px;height:40px;border-radius:12px;background:var(--paper2,rgba(26,35,64,.06));display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--navy,#1a2340)}'
     +'.trow-tx{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.trow-tx b{font-size:15px;font-weight:600;color:var(--navy,#1a2340);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.trow-tx small{font-size:12.5px;color:var(--dim2,#646c80)}'
     +'.trow-b{width:40px;height:40px;border-radius:12px;border:0;background:transparent;color:var(--dim,#5b6478);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}.trow-b:active{background:rgba(26,35,64,.08)}.trow-b.d{color:#b3261e}'
     +'#s-mine .tp-actions .tb{flex:1 1 calc(50% - 8px)}#s-mine .tp-actions .tb:last-child{flex-basis:100%}#s-mine .tp-bar .tb{width:100%}'
     +'.tp-empty{padding:26px 10px;text-align:center;color:var(--dim2,#646c80);font-size:14px;line-height:1.6}'
     +'#tutor-pill.pwa{white-space:nowrap;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 90px);max-width:calc(100% - 28px);font-size:12px;padding:8px 8px 8px 14px}'
     +'#tutor-pill{position:fixed;left:14px;bottom:14px;z-index:100000;display:none;align-items:center;gap:10px;padding:9px 14px;border-radius:100px;background:var(--orange,#c96a2a);color:#fff;font:500 13px "DM Sans",system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.2)}'
     +'#tutor-pill button{border:0;background:rgba(255,255,255,.25);color:#fff;border-radius:100px;padding:4px 10px;font:inherit;cursor:pointer}'
     +'#tutor-student-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;font-size:13px;color:var(--dim2,#646c80)}'
     +'.tsb-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 6px 5px 12px;border-radius:100px;background:rgba(26,35,64,.07);color:var(--navy,#1a2340)}'
     +'.tsb-chip button{border:0;background:transparent;cursor:pointer;color:var(--dim2,#646c80);font-size:15px;line-height:1;padding:0 6px}'
     +'.tsb-join{padding:6px 14px;border-radius:100px;border:1.5px solid var(--navy,#1a2340);background:transparent;color:var(--navy,#1a2340);font:500 12.5px "DM Sans",system-ui,sans-serif;cursor:pointer}';
    document.head.appendChild(s);
  }
  function modal(inner){
    css();
    var ov=document.createElement('div'); ov.className='tmd-ov';
    ov.innerHTML='<div class="tmd" role="dialog" aria-modal="true">'+inner+'</div>';
    document.body.appendChild(ov);
    function close(){ try{ document.removeEventListener('keydown',key,true); ov.remove(); }catch(e){} }
    function key(e){ if(e.key==='Escape'){ e.preventDefault(); close(); } }
    document.addEventListener('keydown',key,true);
    ov.addEventListener('mousedown',function(e){ if(e.target===ov) close(); });
    return {ov:ov, box:ov.firstChild, close:close, q:function(s){ return ov.querySelector(s); }};
  }
  function confirmBox(title,body,okLabel,danger){
    return new Promise(function(res){
      var m=modal('<h3>'+esc(title)+'</h3><p>'+esc(body)+'</p><div class="tmd-row"><button class="tmd-b" data-x="0">Anuluj</button><button class="tmd-b '+(danger?'d':'p')+'" data-x="1">'+esc(okLabel||'OK')+'</button></div>');
      m.ov.addEventListener('click',function(e){ var b=e.target.closest&&e.target.closest('[data-x]'); if(b){ m.close(); res(b.getAttribute('data-x')==='1'); } });
      m.ov.addEventListener('mousedown',function(e){ if(e.target===m.ov) res(false); });
    });
  }
  function infoBox(title,body){ var m=modal('<h3>'+esc(title)+'</h3><p>'+esc(body)+'</p><div class="tmd-row"><button class="tmd-b p" data-x="1">OK</button></div>'); m.ov.addEventListener('click',function(e){ if(e.target.closest&&e.target.closest('[data-x]')) m.close(); }); }

  /* ═══════ 3. NAUCZYCIEL ═══════ */
  var _students=[];            // [{link_id,student_id,label,student_name,sets:[ids]}]
  var _view='list', _cur=null; // 'list' | 'student'
  var _curSets=[], _pending=null, _studyAt=0;

  var IC={
    chev:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    eye:'<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    plus:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    spark:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>',
    more:'<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    unlink:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    info:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>',
    card:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>'
  };

  function root(){ return IS_PWA ? $('s-mine') : $('mat-main-content'); }
  function syncSwitch(){
    var on=T.on();
    var b=$('tutor-toggle-btn'); if(b){ b.classList.toggle('on',on); b.setAttribute('aria-checked',on?'true':'false'); }
    var sg=$('tutor-seg'); if(sg){
      sg.classList.toggle('on',on);
      [].slice.call(sg.querySelectorAll('button')).forEach(function(x){ x.setAttribute('aria-selected',(x.getAttribute('data-m')==='1')===on?'true':'false'); });
    }
  }

  /* Tryb nauczyciela żyje tylko w „Moje fiszki" (web) / „Moje zestawy" (aplikacja). */
  T.setMode = function(on,opts){
    opts=opts||{};
    window._tutorMode=!!on;
    try{ sessionStorage.setItem(SS,on?'1':'0'); }catch(e){}
    var mc=root(); if(mc) mc.classList.toggle('tutor-on',!!on);
    if(IS_PWA){
      var h=document.querySelector('#s-mine .scroll .h1');
      if(h){ if(!h.getAttribute('data-orig')) h.setAttribute('data-orig',h.textContent); h.textContent = on ? 'Tryb nauczyciela' : h.getAttribute('data-orig'); }
    } else {
      var t=$('mat-main-title'); if(t) t.textContent = on ? 'Tryb nauczyciela' : 'Ucz się z fiszek';
      var sb=$('mat-main-sub'); if(sb) sb.textContent = on ? 'Katalogi uczniów — materiały, które dla nich przygotowujesz.' : 'Wybierz zestaw — przeglądaj słówka i ćwicz w czterech trybach.';
    }
    syncSwitch();
    var p=$('tutor-pill'); if(p) p.style.display = on ? 'flex' : 'none';
    if(on){ _view='list'; _cur=null; renderPanel(); }
    else {
      _pending=null;
      if(!opts.silent && !IS_PWA){ try{ if(typeof window.switchMatTab==='function') window.switchMatTab(window._matTab||'mine'); }catch(e){} }
    }
  };
  T.toggle = async function(){
    if(T.on()){ T.setMode(false); return; }
    if(!(await uid())){ infoBox('Tryb nauczyciela','Zaloguj się, aby korzystać z trybu nauczyciela.'); syncSwitch(); return; }
    if(!(await isPro())){
      infoBox('Tryb nauczyciela jest w PRO','Jako nauczyciel prowadzisz katalogi uczniów i udostępniasz im zestawy fiszek. Uczniowie nie potrzebują PRO. Włącz PRO, aby korzystać z trybu nauczyciela.');
      syncSwitch(); return;
    }
    T.setMode(true);
  };

  function ensurePill(){
    css();
    if(!$('tutor-pill')){
      var pill=document.createElement('div'); pill.id='tutor-pill';
      if(IS_PWA) pill.className='pwa';
      pill.innerHTML='<span>'+(IS_PWA?'Tryb nauczyciela · bez zapisu postępu':'Tryb nauczyciela · nauka nie zapisuje postępu')+'</span><button type="button" id="tutor-pill-off">Wyłącz</button>';
      document.body.appendChild(pill);
      pill.querySelector('#tutor-pill-off').addEventListener('click',function(){ T.setMode(false); });
    }
    $('tutor-pill').style.display = T.on() ? 'flex' : 'none';
  }
  function ensureChrome(){
    css(); ensurePill();
    if(IS_PWA){
      var sc=document.querySelector('#s-mine .scroll'); if(!sc) return false;
      if(!$('tutor-seg')){
        var sg=document.createElement('div'); sg.id='tutor-seg'; sg.className='tseg'; sg.setAttribute('role','tablist');
        sg.innerHTML='<span class="tseg-ind"></span><button type="button" role="tab" data-m="0">Moje zestawy</button><button type="button" role="tab" data-m="1">Tryb nauczyciela</button>';
        var h=sc.querySelector('.h1'); if(h&&h.parentNode===sc) sc.insertBefore(sg,h.nextSibling); else sc.insertBefore(sg,sc.firstChild);
        sg.querySelector('[data-m="0"]').addEventListener('click',function(){ if(T.on()) T.setMode(false); });
        sg.querySelector('[data-m="1"]').addEventListener('click',function(){ if(!T.on()) T.toggle(); });
      }
      if(!$('tutor-panel')){ var p=document.createElement('div'); p.id='tutor-panel'; var ml=$('mine-list'); if(ml&&ml.parentNode) ml.parentNode.insertBefore(p,ml.nextSibling); else sc.appendChild(p); }
    } else {
      var mc=$('mat-main-content'); if(!mc) return false;
      if(!$('tutor-panel')){ var p2=document.createElement('div'); p2.id='tutor-panel'; mc.appendChild(p2); }
      if(!$('tutor-toggle-btn')){
        var host=($('mat-create-btn')||{}).parentNode, head=host&&host.parentNode;
        if(host){
          var b=document.createElement('button'); b.id='tutor-toggle-btn'; b.type='button'; b.className='tsw'; b.setAttribute('role','switch'); b.setAttribute('aria-checked','false');
          b.innerHTML='<span class="tsw-lbl">Tryb nauczyciela</span><span class="tsw-track"><span class="tsw-knob"></span></span>';
          b.addEventListener('click',T.toggle); (head||host).appendChild(b);   // zawsze skrajnie po prawej w nagłówku — nie skacze po zmianie trybu
        }
      }
    }
    syncSwitch();
    return true;
  }

  async function loadStudents(){
    var list=await rpc('tutor_list_students');
    _students=(list||[]).map(function(r){ return {link_id:r.link_id,student_id:r.student_id,label:r.label,student_name:r.student_name,sets:[]}; });
    if(_students.length){
      var r=await DB().from('tutor_link_sets').select('link_id,set_id').in('link_id',_students.map(function(s){return s.link_id;}));
      ((r&&r.data)||[]).forEach(function(x){ var s=_students.filter(function(y){return y.link_id===x.link_id;})[0]; if(s) s.sets.push(x.set_id); });
    }
  }
  function nm(s){ return s.label || s.student_name || 'Uczeń'; }
  function ini(s){ var n=String(nm(s)).trim(); return esc((n.charAt(0)||'U').toUpperCase()); }
  function plSets(n){ var d=n%10,h=n%100; return n+' '+(n===1?'zestaw':(d>=2&&d<=4&&!(h>=12&&h<=14))?'zestawy':'zestawów'); }
  function plCards(n){ var d=n%10,h=n%100; return n+' '+(n===1?'fiszka':(d>=2&&d<=4&&!(h>=12&&h<=14))?'fiszki':'fiszek'); }
  function note(t){ return '<div class="tp-note">'+IC.info+'<span>'+t+'</span></div>'; }

  async function renderPanel(){
    if(!ensureChrome()) return;
    var p=$('tutor-panel'); if(!p || !T.on()) return;
    p.onclick=onPanelClick;
    if(!p.firstChild) p.innerHTML='<div class="tp-empty">Ładuję…</div>';
    try{ await loadStudents(); }catch(e){ p.innerHTML=note(esc(e.message)); return; }
    if(_view==='student' && _cur){ var c=_students.filter(function(s){return s.link_id===_cur;})[0]; if(c){ return renderStudent(c); } _view='list'; _cur=null; _pending=null; }
    var html=note('Nauka i przeglądanie w trybie nauczyciela <b>nie zapisują się</b> do Twoich powtórek.')
      +'<div class="tp-bar"><div><div class="tp-h">Twoi uczniowie</div>'+(_students.length?'<div class="tp-sub">'+_students.length+' '+(_students.length===1?'uczeń':(_students.length%10>=2&&_students.length%10<=4&&!(_students.length%100>=12&&_students.length%100<=14))?'uczniów':'uczniów')+' · kliknij, aby otworzyć katalog</div>':'')+'</div>'
      +(_students.length?'<button class="tb pri" data-a="add">'+IC.plus+' Dodaj ucznia</button>':'')+'</div>';
    if(!_students.length){
      html+='<div class="tp-steps">'
        +'<div class="tp-step"><span>1</span><div><b>Wygeneruj kod</b><small>Kliknij „Dodaj ucznia” — dostaniesz kod i kod QR.</small></div></div>'
        +'<div class="tp-step"><span>2</span><div><b>Wyślij go uczniowi</b><small>Na czacie, mailem albo pokaż QR na lekcji online.</small></div></div>'
        +'<div class="tp-step"><span>3</span><div><b>Uczeń wpisuje kod</b><small>W swojej aplikacji: Moje zestawy → „Mam kod od nauczyciela”. Konta się łączą.</small></div></div>'
        +'<button class="tb pri big" data-a="add">'+IC.plus+' Dodaj pierwszego ucznia</button></div>';
    } else {
      html+='<div class="tp-list">'+_students.map(function(s){
        return '<button class="sr" data-a="student" data-l="'+esc(s.link_id)+'"><span class="sr-av">'+ini(s)+'</span><span class="sr-tx"><b>'+esc(nm(s))+'</b><small>'+plSets(s.sets.length)+(s.label&&s.student_name&&s.label!==s.student_name?' · '+esc(s.student_name):'')+'</small></span><span class="sr-ch">'+IC.chev+'</span></button>';
      }).join('')+'</div>';
    }
    p.innerHTML=html;
  }

  function onPanelClick(ev){
    var el=ev.target.closest&&ev.target.closest('[data-a]'); if(!el) return;
    _studyAt=Date.now();                       // nauka uruchomiona z panelu może przejść na inną stronę — to dozwolone
    var a=el.getAttribute('data-a'), s=_students.filter(function(x){return x.link_id===_cur;})[0];
    var sid=parseInt(el.getAttribute('data-s'),10), set=_curSets.filter(function(x){return x.id===sid;})[0];
    if(a==='add') return T.newCode();
    if(a==='student'){ _view='student'; _cur=el.getAttribute('data-l'); return renderPanel(); }
    if(a==='back'){ _view='list'; _cur=null; _pending=null; return renderPanel(); }
    if(!s) return;
    if(a==='assign') return assignDialog(s);
    if(a==='new') return startCreate(s,'manual');
    if(a==='ai') return startCreate(s,'ai');
    if(a==='more') return moreMenu(s);
    if(!set) return;
    var nmv=String(set.name||'Zestaw'), lg=set.lang||'';
    if(a==='unpin') return unpinSet(s,set);
    if(IS_PWA){
      if(a==='eye' && typeof window.previewSet==='function') return window.previewSet(String(set.id),nmv,lg||'en');
      if(a==='open' && typeof window.openSet==='function'){ var n=(set.user_set_cards&&set.user_set_cards[0]&&set.user_set_cards[0].count)||0; return window.openSet(String(set.id),nmv,n,lg||'en'); }
      return;
    }
    if(a==='eye' && typeof window.eylPreviewSet==='function') return window.eylPreviewSet(set.id);
    if(a==='srs' && typeof window.matCardStartSRS==='function') return window.matCardStartSRS(set.id,nmv);
    if(a==='lex' && typeof window.matCardLexModal==='function') return window.matCardLexModal(set.id,nmv,lg);
    if(a==='open' && typeof window.openSet==='function') return window.openSet(set.id);
  }

  /* — kod zaproszenia + QR — */
  T.newCode = async function(){
    var code;
    try{ code=await rpc('tutor_create_link_code'); }catch(e){ infoBox('Nie udało się wygenerować kodu',e.message); return; }
    var url=T.joinUrl(code), qr='';
    try{ var q=window.qrcode(0,'M'); q.addData(url); q.make(); qr=q.createSvgTag({cellSize:6,margin:2,scalable:true}); }catch(e){ qr=''; }
    var m=modal('<h3>Kod dla ucznia</h3><p>Uczeń wpisuje ten kod w aplikacji (Moje fiszki → „Mam kod od nauczyciela”) albo skanuje QR. Kod jest jednorazowy i ważny 24 godziny.</p>'
      +'<div class="tmd-code" id="tmd-code">'+esc(T.fmtCode(code))+'</div>'
      +(qr?'<div class="tmd-qr">'+qr+'</div>':'')
      +'<div class="tmd-row"><button class="tmd-b" id="tmd-cp1">Kopiuj kod</button><button class="tmd-b" id="tmd-cp2">Kopiuj link</button><button class="tmd-b p" id="tmd-ok">Gotowe</button></div>');
    function cp(txt,btn){ try{ navigator.clipboard.writeText(txt).then(function(){ btn.textContent='Skopiowano'; }); }catch(e){ btn.textContent='Zaznacz i skopiuj'; } }
    m.q('#tmd-cp1').addEventListener('click',function(){ cp(T.fmtCode(code),this); });
    m.q('#tmd-cp2').addEventListener('click',function(){ cp(url,this); });
    m.q('#tmd-ok').addEventListener('click',function(){ m.close(); renderPanel(); });
  };

  /* — katalog ucznia — */
  async function fetchSets(ids){
    if(!ids.length) return [];
    if(IS_PWA){
      var q=await DB().from('user_sets').select('id,name,lang,user_set_cards(count)').in('id',ids).order('name',{ascending:true});
      return (q&&q.data)||[];
    }
    var sel='id,name,lang,user_id,is_public,likes_count,source,user_set_cards(id,word,translation)';
    var r=await DB().from('user_sets').select(sel).in('id',ids);
    if(r.error){ r=await DB().from('user_sets').select('id,name,lang,user_id,is_public,likes_count,user_set_cards(id,word,translation)').in('id',ids); }
    return (r&&r.data)||[];
  }
  function mergeIntoMat(sets,tag){
    try{
      var cur=window._matSets||[]; var ids={}; cur.forEach(function(s){ ids[s.id]=1; });
      sets.forEach(function(s){ if(tag) s._tutor=tag; if(!ids[s.id]) cur.push(s); });
      window._matSets=cur;
    }catch(e){}
  }
  function langInfo(l){ try{ if(l && typeof LEX_LANG_MAP!=='undefined' && LEX_LANG_MAP[l]) return LEX_LANG_MAP[l]; }catch(e){} return null; }
  function flag(l,sz){ try{ if(l && typeof window.eylFlagSvg==='function') return window.eylFlagSvg(l,sz); }catch(e){} return ''; }
  function cntOf(s){ var c=s.user_set_cards||[]; return (c.length===1&&c[0]&&typeof c[0].count==='number')?c[0].count:c.length; }

  function setItem(x){
    var n=cntOf(x), li=langInfo(x.lang), lname=li?(li.name||String(x.lang).toUpperCase()):(x.lang?String(x.lang).toUpperCase():'Język nieustawiony');
    var meta=esc(lname)+' · '+plCards(n);
    if(IS_PWA){
      return '<div class="trow" data-a="open" data-s="'+x.id+'"><span class="trow-ic">'+(flag(x.lang,20)||IC.card)+'</span>'
        +'<span class="trow-tx"><b>'+esc(x.name||'Bez nazwy')+'</b><small>'+meta+'</small></span>'
        +'<button class="trow-b" data-a="eye" data-s="'+x.id+'" aria-label="Podgląd słów">'+IC.eye+'</button>'
        +'<button class="trow-b d" data-a="unpin" data-s="'+x.id+'" aria-label="Odepnij od ucznia">'+IC.unlink+'</button></div>';
    }
    return '<div class="tc"><div class="tc-top" data-a="open" data-s="'+x.id+'"><span class="tc-fl">'+(flag(x.lang,22)||IC.card)+'</span>'
      +'<span class="tc-tx"><b>'+esc(x.name||'Bez nazwy')+'</b><small>'+meta+'</small></span></div>'
      +'<div class="tc-act"><button class="tb sm" data-a="eye" data-s="'+x.id+'" title="Podejrzyj słowa">'+IC.eye+' Podgląd</button>'
      +'<button class="tb sm navy" data-a="srs" data-s="'+x.id+'">Ucz się</button>'
      +'<button class="tb sm orange" data-a="lex" data-s="'+x.id+'">Ailex</button></div>'
      +'<div class="tc-ft"><button class="tc-un" data-a="unpin" data-s="'+x.id+'">Odepnij od ucznia</button></div></div>';
  }

  async function renderStudent(s){
    var p=$('tutor-panel');
    var sets=[]; try{ sets=await fetchSets(s.sets); }catch(e){}
    _curSets=sets;
    if(!IS_PWA){ try{ var u=await uid(); window._matMyUid=u; }catch(e){} mergeIntoMat(sets,null); }
    var html=note('Uczeń widzi te zestawy <b>na żywo</b> — Twoje zmiany pojawiają się u niego od razu. Nie widzisz jego postępów.')
      +'<button class="tb ghost back" data-a="back">← Wszyscy uczniowie</button>'
      +'<div class="th"><span class="sr-av big">'+ini(s)+'</span><div class="th-tx"><div class="tp-h">'+esc(nm(s))+'</div><div class="tp-sub">'+plSets(sets.length)+(s.label&&s.student_name&&s.label!==s.student_name?' · konto: '+esc(s.student_name):'')+'</div></div>'
      +'<button class="tb ghost icon" data-a="more" aria-label="Więcej opcji">'+IC.more+'</button></div>'
      +'<div class="tp-actions"><button class="tb pri" data-a="new">'+IC.plus+' Nowy zestaw</button><button class="tb navy" data-a="ai">'+IC.spark+' Z AI</button><button class="tb" data-a="assign">Przypisz istniejący</button></div>';
    if(!sets.length) html+='<div class="tp-empty">Ten uczeń nie ma jeszcze zestawów.<br>Utwórz nowy — trafi od razu do jego katalogu — albo przypisz jeden z istniejących.</div>';
    else html+='<div class="'+(IS_PWA?'trows':'tgrid')+'">'+sets.map(setItem).join('')+'</div>';
    p.innerHTML=html;
  }

  /* — nowy zestaw prosto do katalogu ucznia (ręcznie / z AI) — */
  async function startCreate(s,kind){
    var u=await uid(); if(!u) return;
    var r=await DB().from('user_sets').select('id').eq('user_id',u);
    _pending={link:s.link_id,ids:((r&&r.data)||[]).map(function(x){return x.id;}),t:Date.now(),name:nm(s)};
    try{
      if(IS_PWA){
        if(typeof window.eylNewSetOpen!=='function'){ toast('Kreator zestawów niedostępny.'); return; }
        await window.eylNewSetOpen();
        if(kind==='ai' && typeof window._nsGo==='function') window._nsGo('topic');
      } else if(kind==='ai' && typeof window.openCreateSetAI==='function') window.openCreateSetAI();
      else if(typeof window.openCreateSet==='function') window.openCreateSet();
      else toast('Kreator zestawów niedostępny.');
    }catch(e){}
  }
  async function autoAssign(){
    if(!_pending) return;
    if(Date.now()-_pending.t>30*60*1000){ _pending=null; return; }
    try{
      var u=await uid(); if(!u) return;
      var r=await DB().from('user_sets').select('id,name').eq('user_id',u).order('id',{ascending:false}).limit(10);
      var fresh=((r&&r.data)||[]).filter(function(x){ return _pending.ids.indexOf(x.id)<0; });
      if(!fresh.length) return;
      var pd=_pending; _pending=null;
      var ins=await DB().from('tutor_link_sets').insert(fresh.map(function(x){ return {link_id:pd.link,set_id:x.id}; }));
      if(ins.error){ toast(mapErr(ins.error)); return; }
      toast('Dodano do katalogu: '+pd.name);
    }catch(e){}
  }
  async function unpinSet(s,set){
    if(!(await confirmBox('Odpiąć zestaw od ucznia?','„'+(set.name||'Zestaw')+'” zniknie z aplikacji ucznia. Zestaw zostaje na Twoim koncie.','Odepnij',true))) return;
    var r=await DB().from('tutor_link_sets').delete().eq('link_id',s.link_id).eq('set_id',set.id);
    if(r.error){ infoBox('Błąd',mapErr(r.error)); return; }
    renderPanel();
  }
  function moreMenu(s){
    var m=modal('<h3>'+esc(nm(s))+'</h3><div class="tmd-menu"><button class="tmd-b" id="mm-ren">Zmień nazwę ucznia</button><button class="tmd-b d" id="mm-un">Rozłącz z uczniem</button><button class="tmd-b" id="mm-x">Zamknij</button></div>');
    m.q('#mm-x').addEventListener('click',m.close);
    m.q('#mm-ren').addEventListener('click',function(){ m.close(); renameDialog(s); });
    m.q('#mm-un').addEventListener('click',async function(){
      m.close();
      if(!(await confirmBox('Rozłączyć z uczniem?','Uczeń straci dostęp do Twoich zestawów. Jego własny postęp w nauce zostaje.','Rozłącz',true))) return;
      try{ await rpc('tutor_unlink',{p_link:s.link_id}); _view='list'; _cur=null; _pending=null; toast('Rozłączono.'); renderPanel(); }catch(e){ infoBox('Błąd',e.message); }
    });
  }

  async function assignDialog(s){
    var u=await uid(); if(!u) return;
    var r=await DB().from('user_sets').select('id,name,user_set_cards(count)').eq('user_id',u).order('created_at',{ascending:false});
    var mine=((r&&r.data)||[]).filter(function(x){ return s.sets.indexOf(x.id)<0; });
    if(!mine.length){ infoBox('Brak zestawów','Nie masz zestawów do przypisania. Utwórz nowy zestaw przyciskiem „Nowy zestaw”.'); return; }
    var m=modal('<h3>Przypisz zestawy uczniowi</h3><p>Zaznacz zestawy, które uczeń ma widzieć w swojej aplikacji.</p>'
      +mine.map(function(x){ var n=(x.user_set_cards&&x.user_set_cards[0]&&x.user_set_cards[0].count)||0; return '<label class="tmd-chk"><input type="checkbox" value="'+x.id+'"><span>'+esc(x.name)+'</span><small>'+n+' fiszek</small></label>'; }).join('')
      +'<div class="tmd-err" id="tmd-e"></div><div class="tmd-row"><button class="tmd-b" id="tmd-no">Anuluj</button><button class="tmd-b o" id="tmd-go">Przypisz</button></div>');
    m.q('#tmd-no').addEventListener('click',m.close);
    m.q('#tmd-go').addEventListener('click',async function(){
      var ids=[].slice.call(m.ov.querySelectorAll('input:checked')).map(function(i){return parseInt(i.value,10);});
      if(!ids.length){ m.q('#tmd-e').textContent='Zaznacz co najmniej jeden zestaw.'; return; }
      var ins=await DB().from('tutor_link_sets').insert(ids.map(function(id){ return {link_id:s.link_id,set_id:id}; }));
      if(ins.error){ m.q('#tmd-e').textContent=mapErr(ins.error); return; }
      m.close(); toast('Przypisano.'); renderPanel();
    });
  }
  function renameDialog(s){
    var m=modal('<h3>Nazwa ucznia</h3><p>Widoczna tylko dla Ciebie. Zostaw puste, by używać nazwy z konta ucznia ('+esc(s.student_name||'Uczeń')+').</p>'
      +'<input class="tmd-in tmd-txt" id="tmd-nm" maxlength="80" value="'+esc(s.label||'')+'"><div class="tmd-err" id="tmd-e"></div>'
      +'<div class="tmd-row"><button class="tmd-b" id="tmd-no">Anuluj</button><button class="tmd-b p" id="tmd-go">Zapisz</button></div>');
    m.q('#tmd-no').addEventListener('click',m.close);
    m.q('#tmd-go').addEventListener('click',async function(){
      var v=(m.q('#tmd-nm').value||'').trim()||null;
      var r=await DB().from('tutor_links').update({label:v}).eq('id',s.link_id);
      if(r.error){ m.q('#tmd-e').textContent=mapErr(r.error); return; }
      m.close(); renderPanel();
    });
  }

  /* ═══════ 4. UCZEŃ ═══════ */
  var _myTutors=[];
  async function loadMyTutors(){
    if(window.__tutorNoDb){ _myTutors=[]; return _myTutors; }
    try{ _myTutors=(await rpc('tutor_my_tutors'))||[]; }catch(e){ _myTutors=[]; }
    return _myTutors;
  }
  // do czasu wdrożenia migracji funkcja jest niewidoczna (brak przycisków i paska)
  function hideFeature(){
    ['tutor-toggle-btn','tutor-seg','tutor-student-bar','tutor-panel','tutor-pill'].forEach(function(id){ var el=$(id); if(el) el.remove(); });
    var mc=root(); if(mc) mc.classList.remove('tutor-on');
    window._tutorMode=false; try{ sessionStorage.setItem(SS,'0'); }catch(e){}
  }

  T.join = function(prefill){
    var m=modal('<h3>Kod od nauczyciela</h3><p>Wpisz kod otrzymany od nauczyciela. Po połączeniu zobaczysz materiały, które dla Ciebie przygotował.</p>'
      +'<input class="tmd-in" id="tmd-c" maxlength="12" placeholder="XXXX-XXXX" autocomplete="off" autocapitalize="characters" inputmode="text">'
      +'<div class="tmd-err" id="tmd-e"></div>'
      +'<div class="tmd-row"><button class="tmd-b" id="tmd-scan" style="display:none">Skanuj QR</button><button class="tmd-b" id="tmd-no">Anuluj</button><button class="tmd-b p" id="tmd-go">Dalej</button></div>');
    var inp=m.q('#tmd-c'), err=m.q('#tmd-e');
    if(prefill) inp.value=T.fmtCode(T.normCode(prefill));
    inp.addEventListener('input',function(){ var c=T.normCode(inp.value).slice(0,8); inp.value=T.fmtCode(c); err.textContent=''; });
    setTimeout(function(){ try{ inp.focus(); }catch(e){} },30);
    m.q('#tmd-no').addEventListener('click',m.close);
    inp.addEventListener('keydown',function(e){ if(e.key==='Enter') go(); });
    m.q('#tmd-go').addEventListener('click',go);
    if(window.BarcodeDetector && navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      var sb=m.q('#tmd-scan'); sb.style.display='inline-block'; sb.addEventListener('click',function(){ scan(m,function(code){ inp.value=T.fmtCode(T.normCode(code)); go(); }); });
    }
    async function go(){
      var code=T.normCode(inp.value);
      if(code.length!==8){ err.textContent='Kod ma 8 znaków.'; return; }
      var btn=m.q('#tmd-go'); btn.disabled=true;
      try{
        var pv=await rpc('tutor_preview_code',{p_code:code});
        if(!pv||!pv.ok){ err.textContent = pv&&pv.error==='already_linked' ? 'Jesteś już połączony z tym nauczycielem.' : 'Nieprawidłowy lub wygasły kod.'; btn.disabled=false; return; }
        m.box.innerHTML='<h3>Połączyć z: '+esc(pv.tutor_name)+'?</h3><p>Nauczyciel będzie mógł udostępniać Ci zestawy fiszek, a Ty zobaczysz je w „Moje fiszki”. Nauczyciel <b>nie widzi</b> Twoich postępów. Możesz się rozłączyć w każdej chwili.</p>'
          +'<div class="tmd-err" id="tmd-e2"></div><div class="tmd-row"><button class="tmd-b" id="tmd-no2">Anuluj</button><button class="tmd-b o" id="tmd-ok2">Połącz</button></div>';
        m.q('#tmd-no2').addEventListener('click',m.close);
        m.q('#tmd-ok2').addEventListener('click',async function(){
          this.disabled=true;
          try{
            var r=await rpc('tutor_redeem_code',{p_code:code});
            if(!r||!r.ok){ m.q('#tmd-e2').textContent = r&&r.error==='already_linked' ? 'Jesteś już połączony z tym nauczycielem.' : 'Nieprawidłowy lub wygasły kod.'; this.disabled=false; return; }
            m.close(); toast('Połączono z: '+r.tutor_name); try{ sessionStorage.removeItem('eyl_join_code'); }catch(e){}
            reloadSets();
          }catch(e){ m.q('#tmd-e2').textContent=e.message; this.disabled=false; }
        });
      }catch(e){ err.textContent=e.message; btn.disabled=false; }
    }
  };

  function scan(m,onCode){
    var wrap=document.createElement('div');
    wrap.innerHTML='<video playsinline muted style="width:100%;border-radius:12px;margin-top:10px"></video><div class="tmd-row"><button class="tmd-b" type="button">Zamknij kamerę</button></div>';
    m.box.appendChild(wrap);
    var v=wrap.querySelector('video'), stream=null, stop=false;
    function end(){ stop=true; try{ if(stream) stream.getTracks().forEach(function(t){t.stop();}); }catch(e){} try{ wrap.remove(); }catch(e){} }
    wrap.querySelector('button').addEventListener('click',end);
    navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(s){
      stream=s; v.srcObject=s; v.play();
      var det=new window.BarcodeDetector({formats:['qr_code']});
      (function loop(){
        if(stop) return;
        det.detect(v).then(function(r){ if(r&&r.length){ var c=T.normCode(r[0].rawValue); if(c.length===8){ end(); onCode(c); return; } } setTimeout(loop,250); },function(){ setTimeout(loop,400); });
      })();
    },function(){ end(); toast('Brak dostępu do kamery — wpisz kod ręcznie.'); });
  }

  // odśwież listę zestawów (web: loadMySets, PWA: loadMine)
  function reloadSets(){
    try{
      if(typeof window.loadMySets==='function' && $('mat-main-content')) return window.loadMySets();
      if(typeof window.loadMine==='function') return window.loadMine();
    }catch(e){}
    return renderStudentBar();
  }
  async function renderStudentBar(){
    if(!$('mat-main-content') && !$('mine-list')) return;
    css();
    var bar=$('tutor-student-bar');
    if(!bar){
      bar=document.createElement('div'); bar.id='tutor-student-bar';
      var anchor=$('mat-continue-wrap')||$('mine-list'); var mc=$('mat-main-content');
      if(anchor&&anchor.parentNode) anchor.parentNode.insertBefore(bar,anchor); else if(mc) mc.appendChild(bar);
    }
    var tt=await loadMyTutors();
    bar.innerHTML='<button type="button" class="tsb-join" id="tsb-join">Mam kod od nauczyciela</button>'
      +tt.map(function(t){ return '<span class="tsb-chip">Nauczyciel: '+esc(t.tutor_name)+'<button type="button" data-l="'+esc(t.link_id)+'" title="Rozłącz" aria-label="Rozłącz z nauczycielem">×</button></span>'; }).join('');
    $('tsb-join').addEventListener('click',function(){ T.join(); });
    bar.querySelectorAll('.tsb-chip button').forEach(function(b){ b.addEventListener('click',async function(){
      if(!(await confirmBox('Rozłączyć z nauczycielem?','Przestaniesz widzieć jego zestawy. Twój własny postęp w nauce zostaje.','Rozłącz',true))) return;
      try{ await rpc('tutor_unlink',{p_link:b.getAttribute('data-l')}); toast('Rozłączono.'); reloadSets(); }catch(e){ infoBox('Błąd',e.message); }
    }); });
  }

  // zestawy nauczycieli doklejone do listy „Moje fiszki” ucznia
  async function appendShared(){
    try{
      var u=await uid(); if(!u) return;
      var tt=_myTutors.length?_myTutors:await loadMyTutors(); if(!tt.length) return;
      var r=await DB().from('tutor_link_sets').select('link_id,set_id').in('link_id',tt.map(function(t){return t.link_id;}));
      var rows=(r&&r.data)||[]; if(!rows.length) return;
      var sets=await fetchSets(rows.map(function(x){return x.set_id;}));
      var byTutor={}; tt.forEach(function(t){ byTutor[t.tutor_id]=t.tutor_name; });
      sets=sets.filter(function(s){ return s.user_id!==u; });
      sets.forEach(function(s){ s._tutor=byTutor[s.user_id]||'Nauczyciel'; s.username=s._tutor; });
      var cur=window._matSets||[], have={}; cur.forEach(function(s){ have[s.id]=1; });
      sets.forEach(function(s){ if(!have[s.id]) cur.push(s); });
      window._matSets=cur;
      if(typeof window.matRenderMine==='function') window.matRenderMine(); else if(typeof matRenderMine==='function') matRenderMine();
    }catch(e){}
  }

  /* ═══════ 5. WPIĘCIE W STRONĘ (web) ═══════ */
  function hook(){
    // lista „Moje fiszki”: po załadowaniu dokleja zestawy nauczycieli i pasek ucznia
    var lm=window.loadMySets;
    if(typeof lm==='function' && !lm.__tutor){
      var w=async function(){
        var r=await lm.apply(this,arguments);
        try{
          if(!(await uid())) return r;
          await loadMyTutors();                                   // sonda: czy migracja jest wdrożona
          if(window.__tutorNoDb){ hideFeature(); return r; }
          ensureChrome();
          if(T.on()){ if(!root()||!root().classList.contains('tutor-on')) T.setMode(true); else { await autoAssign(); renderPanel(); } }
          else { await renderStudentBar(); await appendShared(); }
        }catch(e){}
        return r;
      };
      w.__tutor=true; window.loadMySets=w;
    }
    // plakietka „od nauczyciela” na karcie
    var sc=window.setCard;
    if(typeof sc==='function' && !sc.__tutor){
      var w2=function(s){
        var h=sc.apply(this,arguments);
        if(s && s._tutor){ h=h.replace('<div class="mat-card-count">','<div class="mat-card-count" style="color:var(--orange,#c96a2a);font-weight:500">od nauczyciela: '+esc(s._tutor)+'</div><div class="mat-card-count">'); }
        return h;
      };
      w2.__tutor=true; window.setCard=w2;
    }
    // w modalu zestawu nauczyciela: bez „Dodaj do moich” (materiał zostaje u nauczyciela)
    var sm=window.showSetModal;
    if(typeof sm==='function' && !sm.__tutor){
      var w3=function(s){
        var r=sm.apply(this,arguments);
        try{ if(s&&s._tutor){ [].slice.call(document.querySelectorAll('#mat-modal-body button')).forEach(function(b){ if((b.getAttribute('onclick')||'').indexOf('addSetToMine')>=0) b.remove(); }); } }catch(e){}
        return r;
      };
      w3.__tutor=true; window.showSetModal=w3;
    }
    // PWA (app.html): lista „Moje zestawy” = loadMine; tylko strona ucznia (nauczyciel zarządza uczniami w wersji web)
    var lmn=window.loadMine;
    if(typeof lmn==='function' && !lmn.__tutor){
      var w4=async function(){
        var r=await lmn.apply(this,arguments);
        try{
          if(!(await uid())) return r;
          await loadMyTutors();
          if(window.__tutorNoDb){ hideFeature(); return r; }
          ensureChrome();
          if(T.on()){ if(!root()||!root().classList.contains('tutor-on')) T.setMode(true); else { await autoAssign(); renderPanel(); } }
          else { await renderStudentBar(); await pwaShared(); }
        }catch(e){}
        return r;
      };
      w4.__tutor=true; window.loadMine=w4;
    }
    return typeof lm==='function' || typeof lmn==='function';
  }
  function mc_on(){ var mc=root(); if(mc) mc.classList.toggle('tutor-on',T.on()); }
  async function pwaShared(){
    try{
      var list=$('mine-list'); if(!list) return;
      var tt=_myTutors; if(!tt.length) return;
      var r=await DB().from('tutor_link_sets').select('link_id,set_id').in('link_id',tt.map(function(t){return t.link_id;}));
      var rows=(r&&r.data)||[]; if(!rows.length) return;
      var q=await DB().from('user_sets').select('id,name,lang,user_id,user_set_cards(count)').in('id',rows.map(function(x){return x.set_id;}));
      var sets=(q&&q.data)||[]; if(!sets.length) return;
      var byTutor={}; tt.forEach(function(t){ byTutor[t.tutor_id]=t.tutor_name; });
      if(list.querySelector('.empty')) list.innerHTML='';
      var pl=(typeof window.plural==='function')?window.plural:function(n,a,b,c){ return n===1?a:(n%10>=2&&n%10<=4&&(n%100<10||n%100>=20))?b:c; };
      var html=sets.map(function(s){
        var cnt=(s.user_set_cards&&s.user_set_cards[0]&&s.user_set_cards[0].count)||0, lg=s.lang||'en', nmx=String(s.name||'Bez nazwy');
        var onc="openSet('"+s.id+"','"+esc(nmx).replace(/&#39;/g,"\\'")+"',"+cnt+",'"+esc(lg)+"')";
        return '<div class="row" onclick="'+onc+'"><div class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg></div>'
          +'<div class="body"><div class="t">'+esc(nmx)+'</div><div class="m">'+cnt+' '+pl(cnt,'fiszka','fiszki','fiszek')+' · <span style="color:var(--orange,#c96a2a)">od nauczyciela: '+esc(byTutor[s.user_id]||'Nauczyciel')+'</span></div></div>'
          +'<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></div>';
      }).join('');
      list.insertAdjacentHTML('beforeend',html);
    }catch(e){}
  }
  /* Tryb nauczyciela obowiązuje tylko w „Moje fiszki" (web) / „Moje zestawy" (aplikacja).
     Wyjście do innej sekcji wyłącza go — chyba że to nauka uruchomiona z panelu (kilka sekund po kliknięciu). */
  function hookNav(){
    var fn=IS_PWA?window.go:window.showPage;
    if(typeof fn!=='function') return false;
    if(fn.__tutorNav) return true;
    var w=function(name){
      var keep=IS_PWA ? (name==='mine'||name==='set') : (name==='community'||name==='strefa');
      if(T.on() && !keep && (IS_PWA || Date.now()-_studyAt>6000)) T.setMode(false,{silent:true});
      var r=fn.apply(this,arguments);
      if(keep && T.on()){ setTimeout(function(){ mc_on(); renderPanel(); },30); }
      return r;
    };
    w.__tutorNav=true;
    if(IS_PWA) window.go=w; else window.showPage=w;
    return true;
  }
  (function waitNav(){ var n=0; (function tick(){ if(!hookNav() && n++<120) setTimeout(tick,250); })(); })();
  (function wait(){ var n=0; (function tick(){ var ok=hook(); if(!ok && n++<120) setTimeout(tick,250); else if(n++<40) setTimeout(tick,1000); })(); })();

  /* ═══════ 6. LINK ?join=KOD (QR zeskanowany aparatem telefonu) ═══════ */
  (function joinLink(){
    try{
      var p=new URLSearchParams(location.search), c=p.get('join');
      if(c){
        sessionStorage.setItem('eyl_join_code',T.normCode(c));
        p.delete('join'); var q=p.toString();
        history.replaceState(null,'',location.pathname+(q?'?'+q:'')+location.hash);
      }
    }catch(e){}
    var tries=0;
    (function poll(){
      var code=null; try{ code=sessionStorage.getItem('eyl_join_code'); }catch(e){}
      if(!code || tries++>120) return;
      uid().then(function(u){
        if(!u){ setTimeout(poll,1500); return; }
        try{ sessionStorage.removeItem('eyl_join_code'); }catch(e){}
        try{
          if($('mine-list') && typeof window.go==='function'){ window.go('mine'); if(typeof window.loadMine==='function') window.loadMine(); }   // PWA
          else if(typeof window.showPage==='function') window.showPage('community');                                                         // web
        }catch(e){}
        setTimeout(function(){ T.join(code); },400);
      });
    })();
  })();

  /* wylogowanie zawsze wyłącza tryb nauczyciela (żeby kolejne konto w tej karcie uczyło się normalnie) */
  T.reset = function(){
    window._tutorMode=false; try{ sessionStorage.setItem(SS,'0'); }catch(e){}
    var mc=root(); if(mc) mc.classList.remove('tutor-on');
    var p=$('tutor-pill'); if(p) p.style.display='none';
    syncSwitch(); _pending=null; _curSets=[];
    _students=[]; _view='list'; _cur=null; _myTutors=[];
  };
  (function watchAuth(){
    var n=0;
    (function tick(){
      var d=DB();
      if(d && d.auth && typeof d.auth.onAuthStateChange==='function'){
        try{ d.auth.onAuthStateChange(function(ev){ if(ev==='SIGNED_OUT') T.reset(); }); }catch(e){}
        return;
      }
      if(n++<100) setTimeout(tick,200);
    })();
  })();
  if(T.on() && document.body) ensurePill();

  /* narzędzia do testów */
  T._test={nullBuilder:nullBuilder, mapErr:mapErr, forgetStudy:function(){ _studyAt=0; }};
})();
