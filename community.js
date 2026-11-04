/* ═══ EYELINGO — SPOŁECZNOŚĆ (zestawy udostępnione przez użytkowników) ═══
   Wspólne dla strony (index.html) i PWA (app.html). Desktop ma własny widok w fiszki_app.py.
   Dane: user_sets (is_public, level, book, description, hidden) + RPC:
     community_sets · rate_community_set · copy_community_set (limit Free 5 zestawów na serwerze),
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
        p_sort:(o.sort||'top'),p_limit:(o.limit||24),p_offset:(o.offset||0),
        p_native:(typeof window.eylNative==='function'?window.eylNative():null)});
      if(r.error) throw r.error;
      return r.data||[];
    },
    cards: async function(id){
      var r=await dbc().from('user_set_cards').select('word,translation,image_url,image_attr,sort_order').eq('set_id',id)
        .order('sort_order',{ascending:true,nullsFirst:false}).order('id',{ascending:true});
      if(r.error) throw r.error;
      return (r.data||[]).filter(function(c){ return c.word && c.translation; });
    },
    rate: async function(id,stars){ var r=await dbc().rpc('rate_community_set',{p_set:id,p_stars:stars}); if(r.error) throw r.error; return (r.data&&r.data[0])||null; },
    mySets: async function(){
      var s=(await dbc().auth.getSession()).data.session; if(!s) return [];
      var r=await dbc().from('user_sets').select('id,name,lang,is_public,hidden').eq('user_id',s.user.id).order('created_at',{ascending:false});
      return (r&&r.data)||[];
    },
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
   +'.ecl-rate{white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:var(--navy,#1a2340);font-weight:600}'
   +'.ecl-rate .n{font-weight:400;color:var(--dim2,#7a8099)}.ecl-star{color:#e0a100}'
   +'.ecl-rate.none{font-weight:400;color:var(--dim2,#7a8099)}'
   +'.ecl-top{display:flex;justify-content:space-between;align-items:center;gap:10px}'
   +'.ecl-share{border:1.5px solid var(--orange,#A94C13);color:var(--orange,#A94C13);background:transparent;border-radius:100px;padding:9px 15px;font:600 13px DM Sans,system-ui,sans-serif;cursor:pointer;white-space:nowrap}'
   +'.ecr-stars{display:flex;gap:6px;justify-content:center;margin:6px 0 4px}.ecr-stars button{border:none;background:transparent;font-size:34px;line-height:1;cursor:pointer;color:#d9d4c7;padding:2px;transition:transform .1s}.ecr-stars button.on{color:#e0a100}.ecr-stars button:hover{transform:scale(1.12)}'
   +'.ecl-more{margin-left:auto;border:none;background:transparent;color:var(--dim2,#7a8099);cursor:pointer;font-size:12px;padding:6px}'
   +'.ecl-empty{text-align:center;color:var(--dim2,#7a8099);font-size:14px;line-height:1.6;padding:34px 12px;border:1px dashed var(--border2,#d9d4c7);border-radius:16px}'
   +'.ecl-load{display:block;margin:16px auto 0}'
   +'@media(max-width:560px){.ecl-grid{grid-template-columns:1fr}}';
  function fmtAvg(v){ var n=Math.round((+v||0)*10)/10; return EN()?n.toFixed(1):n.toFixed(1).replace('.',','); }
  function ratingsTxt(n){ return EN()?(n+' '+(n===1?'rating':'ratings')):(n+' '+plural(n,'ocena','oceny','ocen')); }
  function rateHtml(s){
    if(!s.rating_count) return '<span class="ecl-rate none">'+T('Brak ocen','No ratings yet')+'</span>';
    return '<span class="ecl-rate"><span class="ecl-star">★</span>'+fmtAvg(s.rating_avg)+' <span class="n">('+ratingsTxt(s.rating_count)+')</span></span>';
  }
  function rateDialog(s, done){
    var cur=s.my_stars||0;
    var ov=modal('<div class="ecm-h" style="text-align:center">'+T('Oceń zestaw','Rate this set')+'</div>'
      +'<div class="ecm-p" style="text-align:center;margin-bottom:4px">'+esc(s.name)+'</div>'
      +'<div class="ecr-stars">'+[1,2,3,4,5].map(function(k){ return '<button type="button" data-k="'+k+'" aria-label="'+k+'">★</button>'; }).join('')+'</div>'
      +'<div class="ecm-p" data-h style="text-align:center;min-height:20px;margin:0">'+(cur?T('Twoja ocena: ','Your rating: ')+cur+'/5':T('Jak przydatny jest ten zestaw?','How useful is this set?'))+'</div>'
      +'<div class="ecm-row" style="justify-content:space-between">'+(cur?'<button class="ecm-btn" data-del>'+T('Usuń ocenę','Remove rating')+'</button>':'<span></span>')+'<button class="ecm-btn" data-x>'+T('Zamknij','Close')+'</button></div>');
    var btns=ov.querySelectorAll('.ecr-stars button');
    function paint(n){ Array.prototype.forEach.call(btns,function(b){ b.classList.toggle('on', +b.getAttribute('data-k')<=n); }); }
    paint(cur);
    Array.prototype.forEach.call(btns,function(b){
      var k=+b.getAttribute('data-k');
      b.onmouseenter=function(){ paint(k); }; b.onmouseleave=function(){ paint(cur); };
      b.onclick=function(){ send(k); };
    });
    async function send(k){
      try{
        var r=await API.rate(s.id,k);
        if(r){ s.rating_avg=r.rating_avg; s.rating_count=r.rating_count; s.my_stars=r.my_stars; }
        ov.remove(); toast(k?T('Dziękujemy za ocenę','Thanks for rating'):T('Ocena usunięta','Rating removed'));
        try{ if(k && typeof window.track==='function') window.track('community_set_rated',{stars:k}); }catch(e){}
        if(done) done();
      }catch(e){ toast(T('Nie udało się zapisać oceny','Could not save the rating')); }
    }
    ov.querySelector('[data-x]').onclick=function(){ ov.remove(); };
    var d=ov.querySelector('[data-del]'); if(d) d.onclick=function(){ send(0); };
  }

  function renderBrowser(root, opts){
    ensureCss('ecl-css',LCSS);
    var st={q:'',lang:opts.lang||'',level:'',sort:'top',offset:0,items:[],busy:false,done:false};
    root.innerHTML='<div class="ecl-top" style="margin:0 0 12px"><div class="ecm-p" style="margin:0">'+T('Najlepiej oceniane są na górze. Ocenić możesz każdy zestaw, z którego się uczysz.','Top-rated sets come first. You can rate any set you learn from.')+'</div>'
      +'<button class="ecl-share" data-share>'+T('+ Udostępnij swój zestaw','+ Share your set')+'</button></div>'
      +'<div class="ecl-bar">'
      +'<input type="search" data-q placeholder="'+esc(T('Szukaj: temat, podręcznik, unit…','Search: topic, textbook, unit…'))+'">'
      +'<select data-lang><option value="">'+T('Wszystkie języki','All languages')+'</option>'+LANGS.map(function(c){ return '<option value="'+c+'"'+(c===st.lang?' selected':'')+'>'+esc(lname(c))+'</option>'; }).join('')+'</select>'
      +'<select data-lvl><option value="">'+T('Każdy poziom','Any level')+'</option>'+LEVELS.map(function(l){ return '<option>'+l+'</option>'; }).join('')+'</select>'
      +'<select data-sort><option value="top">'+T('Najlepiej oceniane','Top rated')+'</option><option value="new">'+T('Najnowsze','Newest')+'</option></select>'
      +'</div><div class="ecl-grid" data-g></div><button class="ecl-b ecl-load" data-more style="display:none">'+T('Pokaż więcej','Show more')+'</button>';
    var g=root.querySelector('[data-g]'), more=root.querySelector('[data-more]');
    var tmr=null;
    root.querySelector('[data-q]').addEventListener('input',function(e){ clearTimeout(tmr); var v=e.target.value.trim(); tmr=setTimeout(function(){ st.q=v; reload(); },300); });
    root.querySelector('[data-lang]').onchange=function(e){ st.lang=e.target.value; reload(); };
    root.querySelector('[data-lvl]').onchange=function(e){ st.level=e.target.value; reload(); };
    root.querySelector('[data-sort]').onchange=function(e){ st.sort=e.target.value; reload(); };
    more.onclick=function(){ load(); };
    root.querySelector('[data-share]').onclick=function(){ shareDialog(null, reload); };

    function card(s, i){
      var meta=flag(s.lang,13)+' <span>'+esc(lname(s.lang))+'</span>'+(s.level?'<span>· '+esc(s.level)+'</span>':'')+'<span>· '+cardsTxt(s.cards_count||0)+'</span><span>· '+esc(T('od ','by '))+esc(s.author||'')+'</span>';
      return '<div class="ecl-card" data-i="'+i+'">'
        +'<div class="ecl-top"><div class="ecl-name" title="'+esc(s.name)+'">'+esc(s.name)+'</div>'+rateHtml(s)+'</div>'
        +(s.book?'<div class="ecl-book" title="'+esc(s.book)+'">'+esc(s.book)+'</div>':'')
        +'<div class="ecl-meta">'+meta+'</div>'
        +(s.description?'<div class="ecl-desc">'+esc(s.description)+'</div>':'')
        +'<div class="ecl-act">'
          +'<button class="ecl-b pri" data-a="learn">'+T('Ucz się','Learn')+'</button>'
          +'<button class="ecl-b" data-a="prev">'+T('Podgląd','Preview')+'</button>'
          +(s.is_mine?'':'<button class="ecl-b" data-a="copy">'+T('Kopiuj','Copy')+'</button>')
          +(s.is_mine?'<button class="ecl-b" data-a="edit">'+T('Udostępnianie','Sharing')+'</button>':'<button class="ecl-b" data-a="rate">'+(s.my_stars?('★ '+s.my_stars+'/5'):T('Oceń','Rate'))+'</button>')
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
      else if(a==='edit') shareDialog({id:s.id,name:s.name}, reload);
      else if(a==='rate'){
        if(!(await API.loggedIn())){ toast(T('Zaloguj się, aby ocenić','Log in to rate')); return; }
        rateDialog(s, function(){ el.outerHTML=card(s, +el.getAttribute('data-i')); });
      }
    });
    function emptyHtml(){
      var filt=st.q||st.lang||st.level;
      return '<div class="ecl-empty" style="grid-column:1/-1">'
        +(filt?T('Nic nie znaleziono dla tych filtrów.','Nothing found for these filters.')+'<br>':'')
        +T('Społeczność dopiero rośnie. Udostępnij własny zestaw przyciskiem <b>„+ Udostępnij swój zestaw”</b> — pomożesz innym uczniom i nauczycielom.',
           'The community is just getting started. Share your own set with <b>“+ Share your set”</b> — you\'ll help other learners and teachers.')
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
  /* ── Okno „Udostępnij w Społeczności” — dostępne z zakładki Społeczność, z kafla zestawu i z PWA ── */
  async function shareDialog(set, after){
    if(!(await API.loggedIn())){ toast(T('Zaloguj się, aby udostępnić zestaw','Log in to share a set')); return; }
    var sets=[], info=null;
    if(!set){
      sets=await API.mySets();
      if(!sets.length){ var o0=modal('<div class="ecm-h">'+T('Nie masz jeszcze zestawów','You have no sets yet')+'</div><div class="ecm-p">'+T('Najpierw stwórz zestaw w „Moich zestawach” — ręcznie, z tematu albo ze zdjęcia.','First create a set in “My sets” — by hand, from a topic or from a photo.')+'</div><div class="ecm-row"><button class="ecm-btn pri" data-x>OK</button></div>'); o0.querySelector('[data-x]').onclick=function(){ o0.remove(); }; return; }
    }
    var ov=modal('<div class="ecm-h">'+T('Udostępnij w Społeczności','Share with the community')+'</div><div data-b class="ecm-p">…</div>');
    async function fill(id){
      info=await API.shareInfo(id);
      var b=ov.querySelector('[data-b]'); if(!info){ b.textContent=T('Nie udało się wczytać zestawu.','Could not load the set.'); return; }
      var pub=!!info.is_public, needRules=!pub && !rulesAccepted();
      b.className=''; b.innerHTML=
        (sets.length?'<label class="ecm-p" style="display:block;margin:0 0 4px">'+T('Zestaw','Set')+'</label><select data-set class="ecm-ta" style="min-height:0;margin-bottom:10px">'+sets.map(function(x){ return '<option value="'+x.id+'"'+(String(x.id)===String(id)?' selected':'')+'>'+esc(x.name||'')+(x.is_public?' · '+T('udostępniony','shared'):'')+'</option>'; }).join('')+'</select>':'<div class="ecm-p" style="font-weight:600;color:var(--navy,#1a2340);margin-bottom:8px">'+esc((set&&set.name)||'')+'</div>')
        +(pub?'<div class="ecm-p" style="color:#16794c;margin-bottom:10px">✓ '+T('Zestaw jest udostępniony — inni mogą się z niego uczyć i go oceniać.','This set is shared — others can learn from it and rate it.')+'</div>':'<div class="ecm-p">'+T('Inni użytkownicy będą mogli uczyć się z tego zestawu, oceniać go i kopiować. Zmiany w zestawie od razu widać u wszystkich.','Other users can learn from this set, rate it and copy it. Your edits are visible to everyone right away.')+'</div>')
        +(info.hidden?'<div class="ecm-p" style="color:#b42318">'+T('Zestaw został ukryty po zgłoszeniach i czeka na sprawdzenie.','This set was hidden after reports and is waiting for review.')+'</div>':'')
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'
          +'<select data-lang class="ecm-ta" style="min-height:0"><option value="">'+T('Język zestawu','Set language')+'</option>'+LANGS.map(function(c){ return '<option value="'+c+'"'+(info.lang===c?' selected':'')+'>'+esc(lname(c))+'</option>'; }).join('')+'</select>'
          +'<select data-lvl class="ecm-ta" style="min-height:0"><option value="">'+T('Poziom (opcjonalnie)','Level (optional)')+'</option>'+LEVELS.map(function(l){ return '<option'+(info.level===l?' selected':'')+'>'+l+'</option>'; }).join('')+'</select>'
          +'<input data-book class="ecm-ta" style="min-height:0;grid-column:1/-1" maxlength="80" placeholder="'+esc(T('Podręcznik i unit (opcjonalnie), np. Repetytorium 8 · Unit 10','Textbook and unit (optional), e.g. Grade 8 review · Unit 10'))+'" value="'+esc(info.book||'')+'">'
          +'<textarea data-desc class="ecm-ta" style="grid-column:1/-1" maxlength="300" placeholder="'+esc(T('Krótki opis (opcjonalnie): dla kogo, czego dotyczy','Short description (optional): who it is for, what it covers'))+'">'+esc(info.description||'')+'</textarea>'
        +'</div>'
        +(needRules?'<label class="ecm-chk" style="margin-top:10px"><input type="checkbox" data-rules> <span>'+T('Udostępniam tylko własną pracę: nie przepisuję 1:1 cudzych materiałów (np. list słówek z podręcznika z ich tłumaczeniami i przykładami) i nie używam logo ani znaków wydawców. Treści nie są obraźliwe.','I only share my own work: I don\'t copy other people\'s material 1:1 (e.g. a textbook\'s word lists with its translations and examples) and I don\'t use publishers\' logos or trademarks. The content isn\'t offensive.')+'</span></label>':'')
        +'<div class="ecm-p" data-err style="color:#b42318;margin:8px 0 0;min-height:0"></div>'
        +'<div class="ecm-row" style="justify-content:space-between">'
          +(pub?'<button class="ecm-btn" data-off>'+T('Wycofaj ze Społeczności','Remove from community')+'</button>':'<span></span>')
          +'<span style="display:flex;gap:8px"><button class="ecm-btn" data-x>'+T('Anuluj','Cancel')+'</button><button class="ecm-btn pri" data-ok>'+(pub?T('Zapisz','Save'):T('Udostępnij','Share'))+'</button></span>'
        +'</div>';
      var sel=b.querySelector('[data-set]'); if(sel) sel.onchange=function(){ fill(sel.value); };
      b.querySelector('[data-x]').onclick=function(){ ov.remove(); };
      var off=b.querySelector('[data-off]');
      if(off) off.onclick=async function(){ try{ await API.share(info.id,{is_public:false}); ov.remove(); toast(T('Zestaw wycofany ze Społeczności','Set removed from the community')); if(after) after(); }catch(e){ toast(T('Nie udało się zapisać','Could not save')); } };
      b.querySelector('[data-ok]').onclick=async function(){
        var err=b.querySelector('[data-err]'), lang=b.querySelector('[data-lang]').value;
        if(!lang){ err.textContent=T('Wybierz język zestawu — po nim inni go znajdą.','Choose the set language — that is how others find it.'); return; }
        var rc=b.querySelector('[data-rules]');
        if(rc && !rc.checked){ err.textContent=T('Zaznacz zgodę na zasady udostępniania.','Please accept the sharing rules.'); return; }
        if(rc){ try{ localStorage.setItem(RULES_KEY,'1'); }catch(e){} }
        try{
          await API.share(info.id,{is_public:true,lang:lang,level:b.querySelector('[data-lvl]').value||null,
            book:b.querySelector('[data-book]').value.trim().slice(0,80)||null,
            description:b.querySelector('[data-desc]').value.trim().slice(0,300)||null});
          ov.remove();
          toast(pub?T('Zapisano','Saved'):T('Zestaw udostępniony w Społeczności','Set shared with the community'));
          try{ if(!pub && typeof window.track==='function') window.track('community_set_shared',{lang:lang}); }catch(e){}
          if(after) after();
        }catch(e){ err.textContent=T('Nie udało się zapisać. Spróbuj ponownie.','Could not save. Try again.'); }
      };
    }
    fill(set?set.id:sets[0].id);
  }
  window.EylCom.shareDialog=shareDialog;

  /* Kafle „Moje zestawy” na stronie: przycisk „Udostępnij” / „W Społeczności ✓” przy każdym zestawie */
  var _pubCache={ts:0,map:{}};
  async function pubMap(force){
    if(!force && Date.now()-_pubCache.ts<15000) return _pubCache.map;
    var m={}; (await API.mySets()).forEach(function(x){ m[x.id]=x; }); _pubCache={ts:Date.now(),map:m}; return m;
  }
  function decorateWebMine(){
    var grid=document.getElementById('mat-grid'); if(!grid || window._matSeg==='com' || window._matSeg==='eyl') return;
    var cards=grid.querySelectorAll('.mat-card'); if(!cards.length) return;
    pubMap().then(function(m){
      Array.prototype.forEach.call(cards,function(c){
        if(c.querySelector('.ecs-chip')) return;
        var mm=/openSet\((\d+)\)/.exec(c.getAttribute('onclick')||''); if(!mm) return;
        var id=+mm[1], st=m[id]; if(!st) return;                       // tylko własne zestawy
        var row=c.querySelector('div[onclick="event.stopPropagation()"]') || c;
        var bt=document.createElement('button'); bt.type='button'; bt.className='ecs-chip';
        bt.style.cssText='display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:100px;border:1.5px solid '+(st.is_public?'rgba(22,121,76,.45)':'var(--border2)')+';background:transparent;color:'+(st.is_public?'#16794c':'var(--dim)')+';font-size:12px;font-family:DM Sans,sans-serif;cursor:pointer';
        bt.textContent=st.is_public?T('W Społeczności ✓','In community ✓'):T('Udostępnij','Share');
        bt.title=T('Udostępnij w Społeczności','Share with the community');
        bt.onclick=function(e){ e.stopPropagation(); shareDialog({id:id,name:st.name}, function(){ _pubCache.ts=0; c.querySelector('.ecs-chip').remove(); decorateWebMine(); }); };
        row.appendChild(bt);
      });
    }).catch(function(){});
  }
  function watchWebMine(){
    var grid=document.getElementById('mat-grid'); if(!grid || grid._ecsObs) return;
    var t=null; var obs=new MutationObserver(function(){ clearTimeout(t); t=setTimeout(decorateWebMine,120); });
    obs.observe(grid,{childList:true}); grid._ecsObs=obs; decorateWebMine();
  }

  /* PWA: wiersz „Udostępnij w Społeczności” w ekranie własnego zestawu */
  function pwaShareRow(){
    var sec=document.querySelector('#s-set .set-sec'); if(!sec || document.getElementById('ecs-pwa-row')) return !!document.getElementById('ecs-pwa-row');
    var r=document.createElement('button'); r.className='set-row'; r.id='ecs-pwa-row';
    r.innerHTML='<span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M15 20c0-2.2 1.3-4 3-4.6"/></svg></span>'
      +'<span class="bd"><span class="lb">'+T('Udostępnij w Społeczności','Share with the community')+'</span><span class="vl" id="ecs-pwa-val">'+T('Niech inni też się z niego uczą','Let others learn from it too')+'</span></span>'
      +'<svg class="cv" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
    sec.parentNode.insertBefore(r, sec.nextSibling);
    r.onclick=function(){ try{ shareDialog({id:+curSetId,name:curSetName}, refreshPwaRow); }catch(e){} };
    return true;
  }
  async function refreshPwaRow(){
    var r=document.getElementById('ecs-pwa-row'); if(!r) return;
    var own=false, pub=false;
    try{ own=(typeof curSetKind!=='undefined' && curSetKind==='set' && window._ecsPwaKind!=='community'); }catch(e){}
    r.style.display=own?'':'none'; if(!own) return;
    try{ var i=await API.shareInfo(+curSetId); pub=!!(i&&i.is_public); }catch(e){}
    var v=document.getElementById('ecs-pwa-val'); if(v) v.textContent=pub?T('Udostępniony ✓ — inni mogą go oceniać','Shared ✓ — others can rate it'):T('Niech inni też się z niego uczą','Let others learn from it too');
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
      var no=function(){ window._ecsPwaKind=''; var r=oo.apply(this,arguments); try{ pwaShareRow(); setTimeout(refreshPwaRow,0); }catch(e){} return r; };
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
      try{ refreshPwaRow(); }catch(e){}
      var bl=document.getElementById('set-back-label'); if(bl) bl.textContent=T('Społeczność','Community');
      try{ if(typeof window.track==='function') window.track('community_set_learn',{lang:s.lang||'',surface:'mobile'}); }catch(e){}
    }catch(e){}
  }

  function boot(){
    var tries=0;
    (function tick(){
      var isWeb=!!document.getElementById('mat-segment'), isPwa=!!document.getElementById('app-main');
      if(isWeb){ initWeb(); hookWebEditor(); watchWebMine(); }
      if(isPwa) initPwa();
      var done=(isWeb && document.getElementById('mseg-com') && window.openEditSet && window.openEditSet._ecs)
             || (isPwa && document.getElementById('s-community'));
      if(!done && ++tries<60) setTimeout(tick,500);
    })();
  }
  /* Deep-link z programu desktop: eyelingo.app/?com=1 (przeglądaj) lub ?com=share (okno udostępniania) */
  try{
    var q=new URLSearchParams(location.search), cv=q.get('com');
    if(cv==='1'||cv==='share'){
      sessionStorage.setItem('eylComLink',cv+'|'+Date.now());
      q.delete('com'); var qs=q.toString(); history.replaceState(null,'',location.pathname+(qs?'?'+qs:'')+location.hash);
    }
  }catch(e){}
  function comLinkTick(n){
    var v=''; try{ v=sessionStorage.getItem('eylComLink')||''; }catch(e){}
    var parts=v.split('|'); if(!v || Date.now()-(+parts[1]||0)>600000){ try{ sessionStorage.removeItem('eylComLink'); }catch(e){} return; }
    (async function(){
      try{
        if(dbc() && document.getElementById('mseg-com') && await API.loggedIn()){
          var pc=document.getElementById('page-community');
          if(!pc || !pc.classList.contains('active')){ window._matSeg='mine'; if(typeof showPage==='function') showPage('community'); }
          else{
            sessionStorage.removeItem('eylComLink');
            window.setMatSegment('com');
            if(parts[0]==='share') setTimeout(function(){ shareDialog(null,null); },400);
            return;
          }
        }
      }catch(e){}
      if(n<1200) setTimeout(function(){ comLinkTick(n+1); },500);
    })();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
  comLinkTick(0);
})();
