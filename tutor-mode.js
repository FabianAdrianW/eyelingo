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
  try{ window._tutorMode = sessionStorage.getItem(SS)==='1'; }catch(e){ window._tutorMode=false; }

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
     +'#tutor-panel{display:none}'
     +'#mat-main-content.tutor-on > *:not(.page-head):not(#tutor-panel){display:none !important}'
     +'#mat-main-content.tutor-on #tutor-panel{display:block}'
     +'#mat-main-content.tutor-on #mat-search{display:none}'
     +'.tp-banner{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;background:rgba(201,106,42,.10);color:var(--navy,#1a2340);font-size:13.5px;margin:0 0 16px}'
     +'.tp-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px}.tp-head h3{margin:0;font-size:18px;font-weight:600;flex:1;min-width:140px}'
     +'.tp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}'
     +'.tp-card{border:1.5px solid var(--border,#e6e0d0);border-radius:14px;padding:14px;background:#fff;cursor:pointer;transition:.15s}.tp-card:hover{border-color:var(--navy,#1a2340)}'
     +'.tp-card b{display:block;font-size:15px}.tp-card span{font-size:12.5px;color:var(--dim2,#646c80)}'
     +'.tp-empty{padding:28px 10px;text-align:center;color:var(--dim2,#646c80);font-size:14px;line-height:1.6}'
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

  T.setMode = function(on){
    window._tutorMode=!!on;
    try{ sessionStorage.setItem(SS,on?'1':'0'); }catch(e){}
    var mc=$('mat-main-content'); if(mc) mc.classList.toggle('tutor-on',!!on);
    var t=$('mat-main-title'); if(t) t.textContent = on ? 'Tryb nauczyciela' : 'Ucz się z fiszek';
    var sb=$('mat-main-sub'); if(sb) sb.textContent = on ? 'Katalogi uczniów — materiały, które dla nich przygotowujesz.' : 'Wybierz zestaw — przeglądaj słówka i ćwicz w czterech trybach.';
    var b=$('tutor-toggle-btn'); if(b){ b.classList.toggle('on',!!on); b.textContent = on ? 'Wyłącz tryb nauczyciela' : 'Tryb nauczyciela'; b.style.background = on ? 'var(--orange,#c96a2a)' : ''; }
    var p=$('tutor-pill'); if(p) p.style.display = on ? 'flex' : 'none';
    if(on){ _view='list'; renderPanel(); }
    else { try{ if(typeof window.switchMatTab==='function') window.switchMatTab(window._matTab||'mine'); }catch(e){} }
  };
  T.toggle = async function(){
    if(T.on()){ T.setMode(false); return; }
    if(!(await uid())){ infoBox('Tryb nauczyciela','Zaloguj się, aby korzystać z trybu nauczyciela.'); return; }
    if(!(await isPro())){
      infoBox('Tryb nauczyciela jest w PRO','Jako nauczyciel prowadzisz katalogi uczniów i udostępniasz im zestawy fiszek. Uczniowie nie potrzebują PRO. Włącz PRO, aby korzystać z trybu nauczyciela.');
      return;
    }
    T.setMode(true);
  };

  function ensurePill(){
    css();
    if(!$('tutor-pill')){
      var pill=document.createElement('div'); pill.id='tutor-pill';
      pill.innerHTML='Tryb nauczyciela · nauka nie zapisuje postępu <button type="button" id="tutor-pill-off">Wyłącz</button>';
      document.body.appendChild(pill);
      pill.querySelector('#tutor-pill-off').addEventListener('click',function(){ T.setMode(false); });
    }
    $('tutor-pill').style.display = T.on() ? 'flex' : 'none';
  }
  function ensureChrome(){
    css(); ensurePill();
    var mc=$('mat-main-content'); if(!mc) return false;
    if(!$('tutor-panel')){ var p=document.createElement('div'); p.id='tutor-panel'; mc.appendChild(p); }
    if(!$('tutor-toggle-btn')){
      var host=($('mat-create-btn')||{}).parentNode;
      if(host){
        var b=document.createElement('button'); b.id='tutor-toggle-btn'; b.type='button'; b.className='btn btn-navy'; b.style.whiteSpace='nowrap'; b.textContent='Tryb nauczyciela';
        b.addEventListener('click',T.toggle); host.insertBefore(b,host.firstChild);
      }
    }
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
  function plSets(n){ var d=n%10,h=n%100; return n+' '+(n===1?'zestaw':(d>=2&&d<=4&&!(h>=12&&h<=14))?'zestawy':'zestawów'); }

  async function renderPanel(){
    if(!ensureChrome()) return;
    var p=$('tutor-panel');
    p.innerHTML='<div class="tp-empty">Ładuję…</div>';
    try{
      await loadStudents();
    }catch(e){ p.innerHTML='<div class="tp-banner">'+esc(e.message)+'</div>'; return; }
    if(_view==='student' && _cur){ var c=_students.filter(function(s){return s.link_id===_cur;})[0]; if(c){ return renderStudent(c); } _view='list'; _cur=null; }
    var html='<div class="tp-banner">Nauka i przeglądanie w trybie nauczyciela <b>nie zapisują się</b> do Twoich powtórek.</div>'
      +'<div class="tp-head"><h3>Moi uczniowie</h3><button class="tmd-b o" id="tp-add">+ Dodaj ucznia</button></div>';
    if(!_students.length){
      html+='<div class="tp-empty">Nie masz jeszcze uczniów.<br>Kliknij „Dodaj ucznia”, wygeneruj kod i wyślij go uczniowi (albo pokaż mu kod QR).<br>Uczeń wpisuje kod w swojej aplikacji i konta się łączą.</div>';
    } else {
      html+='<div class="tp-grid">'+_students.map(function(s){
        return '<div class="tp-card" data-l="'+esc(s.link_id)+'"><b>'+esc(nm(s))+'</b><span>'+plSets(s.sets.length)+(s.label&&s.student_name&&s.label!==s.student_name?' · '+esc(s.student_name):'')+'</span></div>';
      }).join('')+'</div>';
    }
    p.innerHTML=html;
    var add=$('tp-add'); if(add) add.addEventListener('click',T.newCode);
    p.querySelectorAll('.tp-card').forEach(function(el){ el.addEventListener('click',function(){ _view='student'; _cur=el.getAttribute('data-l'); renderPanel(); }); });
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
  async function renderStudent(s){
    var p=$('tutor-panel');
    var sets=[]; try{ sets=await fetchSets(s.sets); }catch(e){}
    try{ var u=await uid(); window._matMyUid=u; }catch(e){}
    mergeIntoMat(sets,null);
    var head='<div class="tp-head"><button class="tmd-b" id="tp-back">← Uczniowie</button><h3>'+esc(nm(s))+'</h3>'
      +'<button class="tmd-b" id="tp-rename">Zmień nazwę</button><button class="tmd-b" id="tp-new">Nowy zestaw</button><button class="tmd-b o" id="tp-assign">+ Przypisz zestaw</button><button class="tmd-b d" id="tp-unlink">Rozłącz</button></div>';
    var body;
    if(!sets.length) body='<div class="tp-empty">Ten uczeń nie ma jeszcze przypisanych zestawów.<br>Utwórz zestaw („Nowy zestaw”) i przypisz go tutaj albo wybierz spośród istniejących.</div>';
    else body='<div class="mat-grid">'+sets.map(function(x){
      var card=(typeof window.setCard==='function')?window.setCard(x):('<div class="tp-card"><b>'+esc(x.name)+'</b></div>');
      return '<div style="position:relative">'+card+'<button class="tmd-b d tp-rm" data-s="'+x.id+'" style="position:absolute;left:12px;bottom:10px;padding:3px 10px;font-size:11px" title="Odepnij od ucznia (zestaw zostaje u Ciebie)">Odepnij</button></div>';
    }).join('')+'</div>';
    p.innerHTML='<div class="tp-banner">Uczeń widzi te zestawy na żywo — Twoje zmiany pojawiają się u niego od razu. Nie widzisz jego postępów.</div>'+head+body;
    $('tp-back').addEventListener('click',function(){ _view='list'; _cur=null; renderPanel(); });
    $('tp-new').addEventListener('click',function(){ if(typeof window.openCreateSet==='function') window.openCreateSet(); else toast('Kreator zestawów niedostępny.'); });
    $('tp-assign').addEventListener('click',function(){ assignDialog(s); });
    $('tp-rename').addEventListener('click',function(){ renameDialog(s); });
    $('tp-unlink').addEventListener('click',async function(){
      if(!(await confirmBox('Rozłączyć z uczniem?','Uczeń straci dostęp do Twoich zestawów. Jego własny postęp w nauce zostaje.','Rozłącz',true))) return;
      try{ await rpc('tutor_unlink',{p_link:s.link_id}); _view='list'; _cur=null; toast('Rozłączono.'); renderPanel(); }catch(e){ infoBox('Błąd',e.message); }
    });
    p.querySelectorAll('.tp-rm').forEach(function(b){ b.addEventListener('click',async function(ev){
      ev.stopPropagation();
      var sid=parseInt(b.getAttribute('data-s'),10);
      var r=await DB().from('tutor_link_sets').delete().eq('link_id',s.link_id).eq('set_id',sid);
      if(r.error){ infoBox('Błąd',mapErr(r.error)); return; }
      renderPanel();
    }); });
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
    ['tutor-toggle-btn','tutor-student-bar','tutor-panel','tutor-pill'].forEach(function(id){ var el=$(id); if(el) el.remove(); });
    var mc=$('mat-main-content'); if(mc) mc.classList.remove('tutor-on');
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
          if(T.on()){ T.setMode(true); }
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
          await renderStudentBar(); await pwaShared();
        }catch(e){}
        return r;
      };
      w4.__tutor=true; window.loadMine=w4;
    }
    return typeof lm==='function' || typeof lmn==='function';
  }
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
    var mc=$('mat-main-content'); if(mc) mc.classList.remove('tutor-on');
    var p=$('tutor-pill'); if(p) p.style.display='none';
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
  T._test={nullBuilder:nullBuilder, mapErr:mapErr};
})();
