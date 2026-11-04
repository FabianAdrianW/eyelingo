/* ═══ EYELINGO — SPOŁECZNOŚĆ (zestawy udostępnione przez użytkowników) ═══
   Wspólne dla strony (index.html) i PWA (app.html). Desktop ma własny widok w fiszki_app.py.
   Dane: user_sets (is_public, level, book, description, hidden) + RPC:
     community_sets · toggle_set_like · copy_community_set (limit Free 5 zestawów na serwerze),
   zgłoszenia: set_reports (3 zgłoszenia → zestaw ukryty, właściciel nie zdejmie ukrycia).
   Zestawu społeczności można się uczyć bez kopiowania; kopia wlicza się do limitu zestawów. */
(function(){
  if(window.EylCom) return;
  function EN(){ try{ return typeof window.eylIsEnNative==='function' && window.eylIsEnNative(); }catch(e){ return false; } }
  function T(pl,en){ return EN()?en:pl; }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function dbc(){ return (typeof db!=='undefined' && db) ? db : null; }
  function plural(n,a,b,c){ n=Math.abs(n); if(n===1) return a; var t=n%10,h=n%100; return (t>=2&&t<=4&&(h<10||h>=20))?b:c; }
  function cardsTxt(n){ return EN()?(n+' '+(n===1?'card':'cards')):(n+' '+plural(n,'fiszka','fiszki','fiszek')); }
  function toast(m){
    try{ if(typeof window.eylToast==='function'){ window.eylToast(m); return; } }catch(e){}
    try{ if(typeof window.showToast==='function'){ window.showToast(m,'success'); return; } }catch(e){}
  }
  function flag(code,w){ try{ return window.eylFlagSvg?window.eylFlagSvg(code,w||14):''; }catch(e){ return ''; } }

  var LANGS=['en','es','de','fr','it','nl','pt','no','ru','uk','ar','jp','zh','ko','pl'];
  var LNAME={en:['Angielski','English'],es:['Hiszpański','Spanish'],de:['Niemiecki','German'],fr:['Francuski','French'],
    it:['Włoski','Italian'],nl:['Niderlandzki','Dutch'],pt:['Portugalski','Portuguese'],no:['Norweski','Norwegian'],
    ru:['Rosyjski','Russian'],uk:['Ukraiński','Ukrainian'],ar:['Arabski','Arabic'],jp:['Japoński','Japanese'],
    zh:['Chiński','Chinese'],ko:['Koreański','Korean'],pl:['Polski','Polish']};
  function lname(c){ var x=LNAME[c]; return x?(EN()?x[1]:x[0]):(c?String(c).toUpperCase():''); }
  var LEVELS=['A1','A2','B1','B2','C1','C2'];

  /* ── warstwa danych ── */
  var API={
    list: async function(o){
      o=o||{};
      var r=await dbc().rpc('community_sets',{p_q:(o.q||null),p_lang:(o.lang||null),p_level:(o.level||null),
        p_sort:(o.sort||'popular'),p_limit:(o.limit||24),p_offset:(o.offset||0)});
      if(r.error) throw r.error;
      return r.data||[];
    },
    cards: async function(id){
      var r=await dbc().from('user_set_cards').select('word,translation,image_url,image_attr,sort_order').eq('set_id',id)
        .order('sort_order',{ascending:true,nullsFirst:false}).order('id',{ascending:true});
      if(r.error) throw r.error;
      return (r.data||[]).filter(function(c){ return c.word && c.translation; });
    },
    like: async function(id){ var r=await dbc().rpc('toggle_set_like',{p_set:id}); if(r.error) throw r.error; return r.data; },
    copy: async function(id){
      var r=await dbc().rpc('copy_community_set',{p_set:id});
      if(r.error){ var m=String(r.error.message||''); var e=new Error(/free_set_limit/.test(m)?'limit':m); throw e; }
      return r.data;
    },
    report: async function(id,reason){
      var s=(await dbc().auth.getSession()).data.session; if(!s) throw new Error('auth');
      var r=await dbc().from('set_reports').insert({set_id:id,user_id:s.user.id,reason:(reason||'').slice(0,300)||null});
      if(r.error && !/duplicate|unique/i.test(String(r.error.message||''))) throw r.error;
      return true;
    },
    share: async function(id,f){
      var r=await dbc().from('user_sets').update(f).eq('id',id);
      if(r.error) throw r.error;
      return true;
    },
    shareInfo: async function(id){
      var r=await dbc().from('user_sets').select('id,is_public,level,book,description,lang,hidden').eq('id',id).maybeSingle();
      return (r&&r.data)||null;
    },
    loggedIn: async function(){ try{ return !!(await dbc().auth.getSession()).data.session; }catch(e){ return false; } }
  };

  /* ── wspólne okienka (lekki modal, styl strony/PWA przez zmienne CSS) ── */
  var CSS='.ecm-ov{position:fixed;inset:0;z-index:10080;background:rgba(26,35,64,.5);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:18px}'
   +'.ecm-box{background:#fff;color:var(--navy,#1a2340);border-radius:18px;max-width:440px;width:100%;max-height:86vh;overflow:auto;padding:22px 20px;box-shadow:0 24px 60px rgba(26,35,64,.28);font-family:DM Sans,system-ui,sans-serif}'
   +'.ecm-h{font-size:17px;font-weight:600;margin:0 0 6px}.ecm-p{font-size:13.5px;line-height:1.55;color:var(--dim,#4a5270);margin:0 0 14px}'
   +'.ecm-row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}'
   +'.ecm-btn{border:1.5px solid var(--border2,#d9d4c7);background:transparent;color:var(--navy,#1a2340);border-radius:11px;padding:9px 16px;font:500 13.5px DM Sans,system-ui,sans-serif;cursor:pointer}'
   +'.ecm-btn.pri{background:var(--orange,#A94C13);border-color:var(--orange,#A94C13);color:#fff}'
   +'.ecm-list{display:flex;flex-direction:column;gap:4px;margin:6px 0 0}.ecm-w{display:flex;gap:10px;justify-content:space-between;font-size:14px;padding:7px 2px;border-bottom:1px solid rgba(26,35,64,.07)}.ecm-w .t{color:var(--dim2,#7a8099);text-align:right}'
   +'.ecm-ta{width:100%;box-sizing:border-box;border:1.5px solid var(--border2,#d9d4c7);border-radius:11px;padding:9px 11px;font:14px DM Sans,system-ui,sans-serif;min-height:70px;resize:vertical}'
   +'.ecm-chk{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:1.5;color:var(--dim,#4a5270);margin:4px 0}';
  function ensureCss(id,css){ if(document.getElementById(id)) return; var s=document.createElement('style'); s.id=id; s.textContent=css; document.head.appendChild(s); }
  function modal(html){
    ensureCss('ecm-css',CSS);
    var ov=document.createElement('div'); ov.className='ecm-ov';
    ov.innerHTML='<div class="ecm-box">'+html+'</div>';
    ov.addEventListener('click',function(e){ if(e.target===ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }

  async function preview(s){
    var ov=modal('<div class="ecm-h">'+esc(s.name)+'</div><div class="ecm-p">'+flag(s.lang)+' '+esc(lname(s.lang))+(s.level?' · '+esc(s.level):'')+' · '+cardsTxt(s.cards_count||0)+'</div><div class="ecm-list" data-l>…</div><div class="ecm-row"><button class="ecm-btn" data-x>'+T('Zamknij','Close')+'</button></div>');
    ov.querySelector('[data-x]').onclick=function(){ ov.remove(); };
    try{
      var c=await API.cards(s.id);
      ov.querySelector('[data-l]').innerHTML=c.map(function(x){ return '<div class="ecm-w"><span>'+esc(x.word)+'</span><span class="t">'+esc(x.translation)+'</span></div>'; }).join('')||T('Brak fiszek.','No cards.');
    }catch(e){ ov.querySelector('[data-l]').textContent=T('Nie udało się wczytać słów.','Could not load the words.'); }
  }

  function reportDialog(s){
    var ov=modal('<div class="ecm-h">'+T('Zgłoś zestaw','Report this set')+'</div>'
      +'<div class="ecm-p">'+T('Np. obraźliwe treści, spam albo skopiowane materiały, do których autor nie ma praw. Po kilku zgłoszeniach zestaw znika do czasu sprawdzenia.','E.g. offensive content, spam or copied material the author has no rights to. After several reports the set is hidden until reviewed.')+'</div>'
      +'<textarea class="ecm-ta" maxlength="300" placeholder="'+esc(T('Powód (opcjonalnie)','Reason (optional)'))+'"></textarea>'
      +'<div class="ecm-row"><button class="ecm-btn" data-x>'+T('Anuluj','Cancel')+'</button><button class="ecm-btn pri" data-ok>'+T('Zgłoś','Report')+'</button></div>');
    ov.querySelector('[data-x]').onclick=function(){ ov.remove(); };
    ov.querySelector('[data-ok]').onclick=async function(){
      try{ await API.report(s.id, ov.querySelector('textarea').value.trim()); ov.remove(); toast(T('Dziękujemy — zgłoszenie wysłane','Thanks — report sent')); }
      catch(e){ ov.remove(); toast(T('Zaloguj się, aby zgłosić zestaw','Log in to report a set')); }
    };
  }

  async function copySet(s, after){
    if(!(await API.loggedIn())){ toast(T('Zaloguj się, aby skopiować zestaw','Log in to copy the set')); return; }
    try{
      await API.copy(s.id);
      toast(T('Skopiowano do Moich zestawów','Copied to My sets'));
      try{ if(typeof window.track==='function') window.track('community_set_copied',{lang:s.lang||''}); }catch(e){}
      if(after) after();
    }catch(e){
      if(e.message==='limit'){
        var msg=T('W wersji darmowej możesz mieć do 5 własnych zestawów. Zestawu z Społeczności możesz się uczyć bez kopiowania — albo przejdź na PRO.','On the free plan you can have up to 5 sets of your own. You can learn a community set without copying it — or go PRO.');
        if(typeof window.eylUpgradeModal==='function') window.eylUpgradeModal(T('Limit darmowych zestawów','Free set limit'), msg);
        else { var ov=modal('<div class="ecm-h">'+T('Limit darmowych zestawów','Free set limit')+'</div><div class="ecm-p">'+msg+'</div><div class="ecm-row"><button class="ecm-btn pri" data-x>OK</button></div>'); ov.querySelector('[data-x]').onclick=function(){ ov.remove(); }; }
      } else toast(T('Nie udało się skopiować — spróbuj ponownie','Could not copy — try again'));
    }
  }

  /* ── Zasady przed pierwszą publikacją ── */
  var RULES_KEY='eyl_com_rules_ok';
  function rulesAccepted(){ try{ return localStorage.getItem(RULES_KEY)==='1'; }catch(e){ return false; } }
  function rulesDialog(){
    return new Promise(function(res){
      var ov=modal('<div class="ecm-h">'+T('Udostępnianie w Społeczności','Sharing with the community')+'</div>'
        +'<div class="ecm-p">'+T('Twój zestaw zobaczą i będą mogli się z niego uczyć inni użytkownicy Eyelingo (z Twoim pseudonimem). W każdej chwili możesz go wycofać.','Other Eyelingo users will see your set and can learn from it (with your nickname). You can withdraw it at any time.')+'</div>'
        +'<label class="ecm-chk"><input type="checkbox" data-c> <span>'+T('Udostępniam tylko własną pracę: nie przepisuję 1:1 cudzych materiałów (np. list słówek z podręcznika z ich tłumaczeniami i przykładami) i nie używam logo ani znaków wydawców. Treści nie są obraźliwe.','I only share my own work: I don\'t copy other people\'s material 1:1 (e.g. a textbook\'s word lists with its translations and examples) and I don\'t use publishers\' logos or trademarks. The content isn\'t offensive.')+'</span></label>'
        +'<div class="ecm-row"><button class="ecm-btn" data-x>'+T('Anuluj','Cancel')+'</button><button class="ecm-btn pri" data-ok disabled style="opacity:.5">'+T('Udostępnij','Share')+'</button></div>');
      var c=ov.querySelector('[data-c]'), ok=ov.querySelector('[data-ok]');
      c.onchange=function(){ ok.disabled=!c.checked; ok.style.opacity=c.checked?'1':'.5'; };
      ov.querySelector('[data-x]').onclick=function(){ ov.remove(); res(false); };
      ok.onclick=function(){ try{ localStorage.setItem(RULES_KEY,'1'); }catch(e){} ov.remove(); res(true); };
    });
  }

  window.EylCom={API:API,T:T,esc:esc,lname:lname,LANGS:LANGS,LEVELS:LEVELS,cardsTxt:cardsTxt,flag:flag,
    preview:preview,reportDialog:reportDialog,copySet:copySet,rulesAccepted:rulesAccepted,rulesDialog:rulesDialog,toast:toast};

  /* ── wspólny widok listy (strona i PWA różnią się tylko kontenerem i akcją „Ucz się”) ── */
  var LCSS='.ecl-bar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}'
   +'.ecl-bar input,.ecl-bar select{border:1.5px solid var(--border2,#d9d4c7);border-radius:11px;padding:9px 11px;font:14px DM Sans,system-ui,sans-serif;background:#fff;color:var(--navy,#1a2340)}'
   +'.ecl-bar input{flex:1 1 220px;min-width:0}'
   +'.ecl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}'
   +'.ecl-card{background:#fff;border:1px solid var(--border,#e7e3da);border-radius:16px;padding:15px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}'
   +'.ecl-name{font-size:15px;font-weight:600;color:var(--navy,#1a2340);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
   +'.ecl-meta{font-size:12px;color:var(--dim2,#7a8099);display:flex;align-items:center;gap:5px;flex-wrap:wrap}'
   +'.ecl-book{align-self:flex-start;font-size:11px;font-weight:500;background:rgba(169,76,19,.09);color:var(--orange,#A94C13);padding:3px 8px;border-radius:100px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
   +'.ecl-desc{font-size:12.5px;color:var(--dim,#4a5270);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}'
   +'.ecl-act{display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap}'
   +'.ecl-b{border:1.5px solid var(--border2,#d9d4c7);background:transparent;color:var(--navy,#1a2340);border-radius:100px;padding:6px 12px;font:500 12.5px DM Sans,system-ui,sans-serif;cursor:pointer;display:inline-flex;align-items:center;gap:5px}'
   +'.ecl-b.pri{border-color:var(--navy,#1a2340);background:var(--navy,#1a2340);color:#fff}'
   +'.ecl-b.like.on{color:#c2410c;border-color:rgba(194,65,12,.4)}'
   +'.ecl-more{margin-left:auto;border:none;background:transparent;color:var(--dim2,#7a8099);cursor:pointer;font-size:12px;padding:6px}'
   +'.ecl-empty{text-align:center;color:var(--dim2,#7a8099);font-size:14px;line-height:1.6;padding:34px 12px;border:1px dashed var(--border2,#d9d4c7);border-radius:16px}'
   +'.ecl-load{display:block;margin:16px auto 0}'
   +'@media(max-width:560px){.ecl-grid{grid-template-columns:1fr}}';
  var HEART='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>';

  function renderBrowser(root, opts){
    ensureCss('ecl-css',LCSS);
    var st={q:'',lang:opts.lang||'',level:'',sort:'popular',offset:0,items:[],busy:false,done:false};
    root.innerHTML='<div class="ecl-bar">'
      +'<input type="search" data-q placeholder="'+esc(T('Szukaj: temat, podręcznik, unit…','Search: topic, textbook, unit…'))+'">'
      +'<select data-lang><option value="">'+T('Wszystkie języki','All languages')+'</option>'+LANGS.map(function(c){ return '<option value="'+c+'"'+(c===st.lang?' selected':'')+'>'+esc(lname(c))+'</option>'; }).join('')+'</select>'
      +'<select data-lvl><option value="">'+T('Każdy poziom','Any level')+'</option>'+LEVELS.map(function(l){ return '<option>'+l+'</option>'; }).join('')+'</select>'
      +'<select data-sort><option value="popular">'+T('Najpopularniejsze','Most popular')+'</option><option value="new">'+T('Najnowsze','Newest')+'</option></select>'
      +'</div><div class="ecl-grid" data-g></div><button class="ecl-b ecl-load" data-more style="display:none">'+T('Pokaż więcej','Show more')+'</button>';
    var g=root.querySelector('[data-g]'), more=root.querySelector('[data-more]');
    var tmr=null;
    root.querySelector('[data-q]').addEventListener('input',function(e){ clearTimeout(tmr); var v=e.target.value.trim(); tmr=setTimeout(function(){ st.q=v; reload(); },300); });
    root.querySelector('[data-lang]').onchange=function(e){ st.lang=e.target.value; reload(); };
    root.querySelector('[data-lvl]').onchange=function(e){ st.level=e.target.value; reload(); };
    root.querySelector('[data-sort]').onchange=function(e){ st.sort=e.target.value; reload(); };
    more.onclick=function(){ load(); };

    function card(s, i){
      var meta=flag(s.lang,13)+' <span>'+esc(lname(s.lang))+'</span>'+(s.level?'<span>· '+esc(s.level)+'</span>':'')+'<span>· '+cardsTxt(s.cards_count||0)+'</span><span>· '+esc(T('od ','by '))+esc(s.author||'')+'</span>';
      return '<div class="ecl-card" data-i="'+i+'">'
        +'<div class="ecl-name" title="'+esc(s.name)+'">'+esc(s.name)+'</div>'
        +(s.book?'<div class="ecl-book" title="'+esc(s.book)+'">'+esc(s.book)+'</div>':'')
        +'<div class="ecl-meta">'+meta+'</div>'
        +(s.description?'<div class="ecl-desc">'+esc(s.description)+'</div>':'')
        +'<div class="ecl-act">'
          +'<button class="ecl-b pri" data-a="learn">'+T('Ucz się','Learn')+'</button>'
          +'<button class="ecl-b" data-a="prev">'+T('Podgląd','Preview')+'</button>'
          +(s.is_mine?'':'<button class="ecl-b" data-a="copy">'+T('Kopiuj','Copy')+'</button>')
          +'<button class="ecl-b like'+(s.liked?' on':'')+'" data-a="like"'+(s.is_mine?' disabled style="opacity:.6;cursor:default"':'')+'>'+HEART+'<span>'+(s.likes_count||0)+'</span></button>'
          +(s.is_mine?'<span class="ecl-more" style="cursor:default">'+T('Twój zestaw','Your set')+'</span>':'<button class="ecl-more" data-a="rep" title="'+esc(T('Zgłoś','Report'))+'">'+T('Zgłoś','Report')+'</button>')
        +'</div></div>';
    }
    g.addEventListener('click',async function(e){
      var b=e.target.closest('[data-a]'); if(!b) return;
      var el=b.closest('.ecl-card'); var s=st.items[+el.getAttribute('data-i')]; if(!s) return;
      var a=b.getAttribute('data-a');
      if(a==='learn') opts.onLearn(s);
      else if(a==='prev') preview(s);
      else if(a==='copy') copySet(s, opts.onCopied);
      else if(a==='rep') reportDialog(s);
      else if(a==='like'){
        if(s.is_mine) return;
        if(!(await API.loggedIn())){ toast(T('Zaloguj się, aby polubić','Log in to like')); return; }
        try{ var n=await API.like(s.id); s.liked=!s.liked; s.likes_count=n; b.classList.toggle('on',s.liked); b.querySelector('span').textContent=n; }catch(err){}
      }
    });
    function emptyHtml(){
      var filt=st.q||st.lang||st.level;
      return '<div class="ecl-empty" style="grid-column:1/-1">'
        +(filt?T('Nic nie znaleziono dla tych filtrów.','Nothing found for these filters.')+'<br>':'')
        +T('Społeczność dopiero rośnie. Udostępnij własny zestaw: <b>Moje zestawy → Edytuj → Udostępnij w Społeczności</b> — pomożesz innym uczniom i nauczycielom.',
           'The community is just getting started. Share your own set: <b>My sets → Edit → Share with the community</b> — you\'ll help other learners and teachers.')
        +'</div>';
    }
    async function load(){
      if(st.busy||st.done) return; st.busy=true; more.style.display='none';
      if(!st.offset) g.innerHTML='<div class="ecl-empty" style="grid-column:1/-1;border:none">'+T('Wczytuję…','Loading…')+'</div>';
      try{
        var rows=await API.list({q:st.q,lang:st.lang,level:st.level,sort:st.sort,offset:st.offset,limit:24});
        if(!st.offset){ st.items=[]; g.innerHTML=''; }
        var start=st.items.length; st.items=st.items.concat(rows); st.offset+=rows.length; st.done=rows.length<24;
        if(!st.items.length) g.innerHTML=emptyHtml();
        else g.insertAdjacentHTML('beforeend',rows.map(function(s,k){ return card(s,start+k); }).join(''));
        more.style.display=st.done?'none':'block';
      }catch(e){ if(!st.offset) g.innerHTML='<div class="ecl-empty" style="grid-column:1/-1">'+T('Nie udało się wczytać. Sprawdź połączenie.','Could not load. Check your connection.')+'</div>'; }
      st.busy=false;
    }
    function reload(){ st.offset=0; st.done=false; st.items=[]; load(); }
    reload();
    return {reload:reload};
  }

  /* ── Panel „Udostępnij w Społeczności” (edytor zestawu na stronie) ── */
  function sharePanelHtml(info){
    var pub=!!(info&&info.is_public), hid=!!(info&&info.hidden);
    return '<div id="ecs-panel" style="border:1px solid var(--border,#e7e3da);border-radius:14px;padding:14px 15px;margin:4px 0 12px;background:var(--paper,#faf8f3)">'
      +'<label style="display:flex;gap:10px;align-items:center;cursor:pointer;font-size:14px;font-weight:500;color:var(--navy,#1a2340)"><input type="checkbox" id="ecs-pub"'+(pub?' checked':'')+' style="width:17px;height:17px;accent-color:var(--orange,#A94C13)"> '+T('Udostępnij w Społeczności','Share with the community')+'</label>'
      +'<div style="font-size:12px;color:var(--dim2,#7a8099);margin:4px 0 0 27px;line-height:1.5">'+T('Inni będą mogli uczyć się z tego zestawu i go skopiować. Twoje zmiany od razu widać u wszystkich.','Others can learn from this set and copy it. Your edits are visible to everyone right away.')+'</div>'
      +(hid?'<div style="font-size:12px;color:#b42318;margin:8px 0 0 27px">'+T('Zestaw został ukryty po zgłoszeniach i czeka na sprawdzenie.','This set was hidden after reports and is waiting for review.')+'</div>':'')
      +'<div id="ecs-f" style="display:'+(pub?'grid':'none')+';grid-template-columns:110px 1fr;gap:8px;margin-top:12px">'
        +'<select id="ecs-lvl" class="fi" style="font-size:13px"><option value="">'+T('Poziom','Level')+'</option>'+LEVELS.map(function(l){ return '<option'+((info&&info.level)===l?' selected':'')+'>'+l+'</option>'; }).join('')+'</select>'
        +'<input id="ecs-book" class="fi" maxlength="80" style="font-size:13px" placeholder="'+esc(T('Podręcznik i unit (opcjonalnie), np. Repetytorium 8 · Unit 10','Textbook and unit (optional), e.g. Grade 8 review · Unit 10'))+'" value="'+esc((info&&info.book)||'')+'">'
        +'<textarea id="ecs-desc" class="fi" maxlength="300" rows="2" style="grid-column:1/-1;font-size:13px;resize:vertical" placeholder="'+esc(T('Krótki opis (opcjonalnie): dla kogo, czego dotyczy','Short description (optional): who it is for, what it covers'))+'">'+esc((info&&info.description)||'')+'</textarea>'
      +'</div>'
      +((info&&!info.lang)?'<div style="font-size:12px;color:var(--orange,#A94C13);margin:8px 0 0 27px">'+T('Ustaw język zestawu (plakietka na kafelku), żeby inni mogli go znaleźć.','Set the set\'s language (badge on the tile) so others can find it.')+'</div>':'')
      +'</div>';
  }
  function readSharePanel(){
    var p=document.getElementById('ecs-pub'); if(!p) return null;
    return {is_public:p.checked,
      level:(document.getElementById('ecs-lvl')||{}).value||null,
      book:((document.getElementById('ecs-book')||{}).value||'').trim().slice(0,80)||null,
      description:((document.getElementById('ecs-desc')||{}).value||'').trim().slice(0,300)||null};
  }
  window.EylCom.sharePanelHtml=sharePanelHtml;
  window.EylCom.readSharePanel=readSharePanel;
  window.EylCom.renderBrowser=renderBrowser;

  /* ═══ STRONA (index.html) ═══ */
  function initWeb(){
    var segBox=document.getElementById('mat-segment');
    if(!segBox || document.getElementById('mseg-com') || typeof window.setMatSegment!=='function') return false;
    var b=document.createElement('button'); b.id='mseg-com'; b.type='button';
    b.textContent=T('Społeczność','Community');
    var base='border:none;font-weight:500;font-size:13px;padding:7px 18px;border-radius:100px;cursor:pointer;font-family:DM Sans,sans-serif;transition:.15s;';
    var on='background:#fff;color:var(--navy);box-shadow:0 1px 4px rgba(0,0,0,.08)', off='background:transparent;color:var(--dim2);box-shadow:none';
    b.style.cssText=base+off;
    segBox.appendChild(b);
    var box=document.createElement('div'); box.id='com-segment'; box.style.display='none';
    var eylSeg=document.getElementById('eyl-segment');
    (eylSeg&&eylSeg.parentNode?eylSeg.parentNode:segBox.parentNode).insertBefore(box, eylSeg?eylSeg.nextSibling:segBox.nextSibling);
    var HIDE=['mat-tabs-row','mat-continue-wrap','mat-count','mat-drag-hint','mat-grid','mat-voices','mat-collection-view','mat-learn-surface','mat-create-btn','mat-create-ai-btn','mat-search','eyl-segment'];
    var orig=window.setMatSegment, view=null;
    window.setMatSegment=function(seg){
      if(seg!=='com'){ box.style.display='none'; b.style.cssText=base+off; return orig.apply(this,arguments); }
      window._matSeg='com';
      ['mseg-mine','mseg-eyl'].forEach(function(id){ var x=document.getElementById(id); if(x) x.style.cssText=base+off; });
      b.style.cssText=base+on;
      HIDE.forEach(function(id){ var x=document.getElementById(id); if(x) x.style.display='none'; });
      var t=document.getElementById('mat-main-title'), su=document.getElementById('mat-main-sub');
      if(t) t.textContent=T('Społeczność','Community');
      if(su) su.textContent=T('Zestawy udostępnione przez innych — ucz się od razu albo skopiuj do swoich.','Sets shared by others — learn right away or copy them to yours.');
      var _sbt=document.getElementById('mat-sidebar-toggle'); if(_sbt) _sbt.style.display='none';
      var _cat=document.getElementById('mat-sb-catalogs'); if(_cat) _cat.style.display='none';
      box.style.display='block';
      if(!view) view=renderBrowser(box,{onLearn:learnWeb,onCopied:function(){ try{ if(window.loadMySets) window.loadMySets(); }catch(e){} }});
      else view.reload();
    };
    b.onclick=function(){ window.setMatSegment('com'); };
    return true;
  }
  async function learnWeb(s){
    try{
      var cards=await API.cards(s.id);
      if(!cards.length){ toast(T('Brak fiszek w tym zestawie','This set has no cards')); return; }
      window._trybStudyLang=s.lang||'';
      var mapped=cards.map(function(c){ return {word:c.word,translation:c.translation,image_url:c.image_url||'',image_attr:c.image_attr||'',lang:s.lang||undefined}; });
      try{ _trybExternalCards=mapped; _trybExternalName=s.name||''; }catch(e){ window._trybExternalCards=mapped; window._trybExternalName=s.name||''; }
      window._trybSource='strefa';
      try{ if(typeof window.track==='function') window.track('community_set_learn',{lang:s.lang||''}); }catch(e){}
      if(typeof RewardSystem!=='undefined' && RewardSystem.load) RewardSystem.load();
      if(typeof showPage==='function') showPage('tryb');
      setTimeout(function(){ if(typeof startSession==='function') startSession('set_external'); },300);
    }catch(e){ toast(T('Nie udało się wczytać zestawu','Could not load the set')); }
  }
  /* Edytor zestawu: panel udostępniania + zapis razem z „Zapisz zmiany” */
  function hookWebEditor(){
    if(typeof window.openEditSet!=='function' || window.openEditSet._ecs) return false;
    var oOpen=window.openEditSet;
    var w=async function(id){
      var r=await oOpen.apply(this,arguments);
      try{
        var body=document.getElementById('mat-modal-body');
        if(!body || !document.getElementById('edit-set-name') || document.getElementById('ecs-panel')) return r;
        var info=await API.shareInfo(id); if(!info) return r;
        var foot=null; Array.prototype.forEach.call(body.children,function(ch){ if(/sticky/.test(ch.getAttribute('style')||'')) foot=ch; });
        var tmp=document.createElement('div'); tmp.innerHTML=sharePanelHtml(info);
        body.insertBefore(tmp.firstChild, foot);
        var pub=document.getElementById('ecs-pub');
        pub.onchange=async function(){
          if(pub.checked && !rulesAccepted()){ var ok=await rulesDialog(); if(!ok){ pub.checked=false; return; } }
          document.getElementById('ecs-f').style.display=pub.checked?'grid':'none';
        };
        window._ecsEditId=id; window._ecsWasPublic=!!info.is_public;
      }catch(e){}
      return r;
    };
    w._ecs=true; window.openEditSet=w;
    if(typeof window.saveEditSet==='function' && !window.saveEditSet._ecs){
      var oSave=window.saveEditSet;
      var s=async function(id){
        var f=readSharePanel();
        var r=await oSave.apply(this,arguments);
        var mm=document.getElementById('mat-modal');
        var saved=!mm || mm.style.display==='none';          // oryginał zamyka okno tylko po udanym zapisie
        if(f && saved && String(window._ecsEditId)===String(id)){
          try{
            await API.share(id,f);
            if(f.is_public && !window._ecsWasPublic) toast(T('Zestaw udostępniony w Społeczności','Set shared with the community'));
            else if(!f.is_public && window._ecsWasPublic) toast(T('Zestaw wycofany ze Społeczności','Set removed from the community'));
          }catch(e){ toast(T('Nie udało się zapisać udostępniania','Could not save sharing')); }
        }
        return r;
      };
      s._ecs=true; window.saveEditSet=s;
    }
    return true;
  }

  /* ═══ PWA (app.html) ═══ */
  function initPwa(){
    var main=document.getElementById('app-main'); var bento=document.querySelector('#s-ucz .v2-bento');
    if(!main || !bento || document.getElementById('s-community') || typeof window.go!=='function') return false;
    ensureCss('ecl-css',LCSS);
    var tile=document.createElement('div'); tile.className='row'; tile.id='com-tile';
    tile.style.cssText='margin:12px 0 0;cursor:pointer';
    tile.innerHTML='<div class="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 20c0-2.2 1.3-4 3-4.6"/></svg></div>'
      +'<div class="body"><div class="t">'+T('Społeczność','Community')+'</div><div class="m">'+T('Zestawy udostępnione przez innych','Sets shared by others')+'</div></div>'
      +'<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
    bento.parentNode.insertBefore(tile, bento.nextSibling);
    var sec=document.createElement('section'); sec.className='screen'; sec.id='s-community';
    sec.innerHTML='<div class="backbar"><button class="back" onclick="go(\'ucz\')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> '+T('Ucz się','Learn')+'</button></div>'
      +'<div class="scroll"><div class="h1 mb16">'+T('Społeczność','Community')+'</div><div class="sub" style="margin:-8px 0 14px">'+T('Ucz się od razu albo skopiuj do swoich. Udostępniasz własne zestawy na eyelingo.app: Edytuj → Udostępnij.','Learn right away or copy to yours. You share your own sets on eyelingo.app: Edit → Share.')+'</div><div id="com-root"></div></div>';
    main.appendChild(sec);
    var view=null;
    tile.onclick=function(){
      window.go('community');
      if(!view) view=renderBrowser(document.getElementById('com-root'),{onLearn:learnPwa,onCopied:function(){ try{ if(typeof window.loadMine==='function') window.loadMine(); }catch(e){} }});
      else view.reload();
    };
    if(typeof window.openSet==='function' && !window.openSet._ecs){
      var oo=window.openSet;
      var no=function(){ window._ecsPwaKind=''; return oo.apply(this,arguments); };
      no._ecs=true; window.openSet=no;
    }
    if(typeof window.setBack==='function' && !window.setBack._ecs){
      var ob=window.setBack;
      var nb=function(){ if(window._ecsPwaKind==='community'){ window._ecsPwaKind=''; window.go('community'); return; } return ob.apply(this,arguments); };
      nb._ecs=true; window.setBack=nb;
    }
    return true;
  }
  function learnPwa(s){
    try{
      if(typeof window.openSet!=='function') return;
      window.openSet(String(s.id), s.name||'', s.cards_count||0, s.lang||'en');
      window._ecsPwaKind='community';
      var bl=document.getElementById('set-back-label'); if(bl) bl.textContent=T('Społeczność','Community');
      try{ if(typeof window.track==='function') window.track('community_set_learn',{lang:s.lang||'',surface:'mobile'}); }catch(e){}
    }catch(e){}
  }

  function boot(){
    var tries=0;
    (function tick(){
      var isWeb=!!document.getElementById('mat-segment'), isPwa=!!document.getElementById('app-main');
      if(isWeb){ initWeb(); hookWebEditor(); }
      if(isPwa) initPwa();
      var done=(isWeb && document.getElementById('mseg-com') && window.openEditSet && window.openEditSet._ecs)
             || (isPwa && document.getElementById('s-community'));
      if(!done && ++tries<60) setTimeout(tick,500);
    })();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
