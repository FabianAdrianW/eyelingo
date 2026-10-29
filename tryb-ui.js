/* Eyelingo — Tryb nauki: układ ekranu (web, index.html).
   Nakładka na istniejący silnik (showTrybModePicker / startTrybMode / updateTrybProgress),
   bez zmiany logiki nauki. Układ:
     ┌ ‹ Zestawy                      Nazwa zestawu                 ← Zakończ ┐
     │ [Przeglądanie|Multiwybór|Wpisywanie|Zapamiętywanie]   [ES → PL | PL → ES] │
     │ Postęp ─────────────────────────────────────────── Opanowane 3 / 38 │
     └ uwagi (zapis do powtórek, „Nie ucz mnie…”)                                ┘
   Ekran wyboru trybu: nagłówek z nazwą zestawu, po prawej przełącznik kierunku.
   „Zmień tryb” zastąpiony zakładkami trybów (aktywny tryb zawsze widoczny). */
(function(){
  'use strict';
  var MODES=[['flip','Przeglądanie'],['mc','Multiwybór'],['write','Wpisywanie'],['memorize','Zapamiętywanie']];
  var REV_MODES=[['write','Wpisywanie'],['mc','Multiwybór'],['memorize','Zapamiętywanie'],['flip','Odwracanie']];
  var CODE={en:'EN',es:'ES',de:'DE',fr:'FR',it:'IT',nl:'NL',pt:'PT',no:'NO',ru:'RU',uk:'UK',ar:'AR',jp:'JA',zh:'ZH',ko:'KO',pl:'PL'};
  function $(id){ return document.getElementById(id); }
  function native(){ try{ return (typeof window.eylNative==='function')?window.eylNative():'pl'; }catch(e){ return 'pl'; } }
  function target(){
    var l=window._trybStudyLang||'';
    if(!l){ try{ var c=_trybCards&&_trybCards[_trybIdx]; l=(c&&c.lang)||''; }catch(e){} }
    return String(l||'').toLowerCase();
  }
  function flag(c){ try{ return window.eylFlagSvg?window.eylFlagSvg(c,14):''; }catch(e){ return ''; } }
  function dir(){ try{ return _trybCardDirection; }catch(e){ return 'foreign'; } }
  function setDir(v){ try{ _trybCardDirection=v; }catch(e){} window._trybCardDirection=v; }

  /* ── style ── */
  var css=document.createElement('style');
  css.textContent=[
    '.ty-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin:0 0 16px}',
    '.ty-top .ty-l{justify-self:start}.ty-top .ty-r{justify-self:end}',
    '.ty-title{font:500 15px/1.3 DM Sans,sans-serif;color:var(--navy);text-align:center;max-width:46vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ty-title small{display:block;font:400 12px/1.3 DM Sans,sans-serif;color:var(--dim2);margin-top:2px}',
    '.ty-link{display:inline-flex;align-items:center;gap:7px;padding:8px 12px;border-radius:10px;border:0;background:transparent;color:var(--dim);font:500 13px/1 DM Sans,sans-serif;cursor:pointer;transition:background .15s,color .15s}',
    '.ty-link:hover{background:var(--paper2,#efece6);color:var(--navy)}',
    '.ty-link svg{flex-shrink:0}',
    '.ty-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 18px}',
    '.ty-seg{display:inline-flex;padding:3px;border-radius:12px;background:var(--paper2,#efece6);gap:2px}',
    '.ty-seg button{border:0;background:transparent;padding:7px 13px;border-radius:9px;font:500 13px/1 DM Sans,sans-serif;color:var(--dim);cursor:pointer;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;transition:background .15s,color .15s,box-shadow .15s}',
    '.ty-seg button:hover{color:var(--navy)}',
    '.ty-seg button[aria-pressed="true"]{background:#fff;color:var(--navy);box-shadow:0 1px 2px rgba(26,35,64,.08),0 2px 8px rgba(26,35,64,.06)}',
    '.ty-seg .ty-arr{color:var(--dim2);font-weight:400}',
    '.ty-dirlab{font:500 11px/1 DM Sans,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:var(--dim2);margin-right:8px}',
    '.ty-dirwrap{display:inline-flex;align-items:center}',
    '#tryb-progress-wrap{max-width:none!important;margin:0 0 18px!important}',
    '#tryb-prog-segments{gap:0!important;height:6px!important;border-radius:99px;overflow:hidden;background:var(--paper2,#efece6)}',
    '#tryb-prog-segments>div{border-radius:0!important;min-width:0!important}',
    '.ty-notes{display:flex;flex-direction:column;gap:8px;margin:0 0 14px}',
    '.ty-notes:empty{display:none}',
    '.ty-notes>div{margin:0!important}',
    '.ty-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:4px 0 20px}',
    '.ty-head h3{font:500 24px/1.2 DM Sans,sans-serif;color:var(--navy);margin:0 0 4px}',
    '.ty-head p{font-size:14px;color:var(--dim2);margin:0}',
    '@media (max-width:640px){.ty-top{grid-template-columns:auto 1fr auto}.ty-title{max-width:none}.ty-bar{flex-direction:column;align-items:stretch}.ty-seg{overflow-x:auto;max-width:100%}.ty-seg button{padding:7px 10px}.ty-dirwrap{justify-content:space-between}}'
  ].join('');
  document.head.appendChild(css);

  var IC_SETS='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/><rect x="14" y="15" width="7" height="6" rx="1.5"/></svg>';
  var IC_BACK='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';
  var IC_X='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  /* ── przełącznik kierunku ── */
  function dirSeg(onChange){
    var n=native(), t=target();
    var known=t && t!==n && CODE[t];
    var a=known?(flag(t)+' '+CODE[t]):'Słowo', b=known?(flag(n)+' '+CODE[n]):'Tłumaczenie';
    var wrap=document.createElement('div'); wrap.className='ty-dirwrap';
    wrap.innerHTML='<span class="ty-dirlab">Kierunek</span>';
    var seg=document.createElement('div'); seg.className='ty-seg'; seg.setAttribute('role','group'); seg.setAttribute('aria-label','Kierunek');
    seg.innerHTML='<button type="button" data-d="foreign">'+a+' <span class="ty-arr">→</span> '+b+'</button>'
                 +'<button type="button" data-d="pl">'+b+' <span class="ty-arr">→</span> '+a+'</button>';
    function paint(){ [].forEach.call(seg.children,function(x){ x.setAttribute('aria-pressed',x.getAttribute('data-d')===dir()?'true':'false'); }); }
    seg.addEventListener('click',function(ev){
      var bt=ev.target.closest('button[data-d]'); if(!bt) return;
      var v=bt.getAttribute('data-d'); if(v===dir()) return;
      setDir(v); paint(); if(onChange) onChange(v);
    });
    paint(); wrap.appendChild(seg);
    return wrap;
  }

  function reloadCard(){
    try{
      var m=_trybMode;
      if(m==='flip' && typeof loadTrybFlipCard==='function') loadTrybFlipCard();
      else if(m==='mc' && typeof loadTrybMCCard==='function') loadTrybMCCard();
      else if(m==='memorize' && typeof loadTrybMemorizeCard==='function') loadTrybMemorizeCard();
      else if(typeof loadTrybCard==='function') loadTrybCard();
    }catch(e){}
  }

  function setName(){
    var n='Sesja nauki';
    try{ n=((typeof stripEmoji==='function')?stripEmoji(_trybExternalName||''):(_trybExternalName||''))||n; }catch(e){}
    try{ if(typeof window.eylT==='function') n=window.eylT(n); }catch(e){}
    return n;
  }
  function langLabel(){
    var t=target(); if(!t) return '';
    try{ var m=window.LEX_LANG_MAP&&window.LEX_LANG_MAP[t]; return (m&&m.label)||''; }catch(e){ return ''; }
  }

  /* ── górny pasek sesji: ‹ Zestawy | nazwa | Zakończ ── */
  function topBar(session,noTitle){
    var old=$('ty-top'); if(old) old.remove();
    var hdr=null;
    [].some.call(session.children,function(ch){ if(ch.querySelector && ch.querySelector('button[onclick^="endSession"]')){ hdr=ch; return true; } return false; });
    if(hdr) hdr.style.display='none';
    var top=document.createElement('div'); top.id='ty-top'; top.className='ty-top';
    var ll=langLabel(), nm=setName(); if(ll && nm.toLowerCase().indexOf(ll.toLowerCase())>=0) ll='';
    top.innerHTML='<div class="ty-l"><button type="button" class="ty-link" data-a="sets">'+IC_SETS+'<span>Zestawy</span></button></div>'
      +'<div class="ty-title" data-noi18n>'+(noTitle?'':esc(nm)+(ll?'<small>'+esc(ll)+'</small>':''))+'</div>'
      +'<div class="ty-r"><button type="button" class="ty-link" data-a="end">'+IC_X+'<span>Zakończ</span></button></div>';
    top.querySelector('[data-a="sets"]').onclick=function(){ if(typeof trybBackToStrefa==='function') trybBackToStrefa(); };
    top.querySelector('[data-a="end"]').onclick=function(){ if(typeof endSession==='function') endSession(); };
    session.insertBefore(top,session.firstChild);
    return top;
  }
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  /* ── pasek trybów + kierunek (w sesji) ── */
  function modeBar(session){
    var old=$('ty-bar'); if(old) old.remove();
    var bar=document.createElement('div'); bar.id='ty-bar'; bar.className='ty-bar';
    var seg=document.createElement('div'); seg.className='ty-seg'; seg.setAttribute('role','tablist'); seg.setAttribute('aria-label','Tryb nauki');
    var list=window._trybIsReview?REV_MODES:MODES;
    seg.innerHTML=list.map(function(m){ return '<button type="button" role="tab" data-m="'+m[0]+'" aria-pressed="'+(m[0]===_trybMode?'true':'false')+'">'+m[1]+'</button>'; }).join('');
    seg.addEventListener('click',function(ev){
      var b=ev.target.closest('button[data-m]'); if(!b) return;
      var m=b.getAttribute('data-m'); if(m===_trybMode) return;
      try{ if(window.speechSynthesis) window.speechSynthesis.cancel(); }catch(e){}
      ['tryb-flip-controls','tryb-mc-options','tryb-flip-nav'].forEach(function(id){ var el=$(id); if(el) el.remove(); });
      try{ var fl=$('tryb-card-flipper'); if(fl) fl.classList.remove('flipped'); }catch(e){}
      window._trybResumeIdx=_trybIdx;          // zmiana trybu nie kasuje postępu sesji
      window.startTrybMode(m);
    });
    bar.appendChild(seg);
    bar.appendChild(dirSeg(function(){ reloadCard(); }));
    var top=$('ty-top');
    if(top && top.nextSibling) session.insertBefore(bar,top.nextSibling); else session.insertBefore(bar,session.firstChild);
    return bar;
  }

  /* ── porządek: góra → tryby → postęp → uwagi → karta ── */
  function order(){
    var s=$('tryb-session'); if(!s) return;
    var top=$('ty-top'), bar=$('ty-bar'), prog=$('tryb-progress-wrap');
    var notes=$('ty-notes'); if(!notes){ notes=document.createElement('div'); notes.id='ty-notes'; notes.className='ty-notes'; }
    var after=bar||top;
    if(prog && after){ s.insertBefore(prog,after.nextSibling); after=prog; }
    if(after) s.insertBefore(notes,after.nextSibling);
    ['tryb-srs-note','tryb-forget-bar'].forEach(function(id){ var el=$(id); if(el && el.parentNode!==notes) notes.appendChild(el); });
  }

  /* ── wrappery ── */
  function wrap(name,after){
    var f=window[name]; if(typeof f!=='function' || f.__ty) return false;
    var g=function(){ var r=f.apply(this,arguments); try{ after.apply(this,arguments); }catch(e){ console.warn('[tryb-ui]',name,e); } return r; };
    g.__ty=true; window[name]=g; return true;
  }

  function afterPicker(){
    var s=$('tryb-session'), p=$('tryb-mode-picker'); if(!s||!p) return;
    var b=$('ty-bar'); if(b) b.remove();
    var pr=$('tryb-progress-wrap'); if(pr) pr.style.display='none';
    topBar(s,true);
    // stary pasek „Wybierz inny zestaw” w pickerze — zbędny (jest w górnym pasku)
    var first=p.firstElementChild;
    if(first && first.querySelector && first.querySelector('button') && !first.querySelector('#tryb-dir-btn') && /zestaw|set/i.test(first.textContent) && first.textContent.length<60) first.remove();
    // nagłówek: tytuł po lewej, kierunek po prawej
    var hdr=null;
    [].some.call(p.children,function(ch){ if(ch.style && ch.style.textAlign==='center' && /fiszek|cards|Wybierz tryb|Choose/i.test(ch.textContent)){ hdr=ch; return true; } return false; });
    if(hdr){
      var count=0; try{ count=_trybCards.length; }catch(e){}
      var h=document.createElement('div'); h.className='ty-head';
      h.innerHTML='<div><h3 data-noi18n>'+esc(setName())+'</h3><p>'+count+' fiszek · Wybierz tryb nauki</p></div>';
      h.appendChild(dirSeg(null));
      hdr.parentNode.replaceChild(h,hdr);
    }
    // stary wiersz kierunku: zostaje tylko przełącznik zapisu do powtórek
    var db=$('tryb-dir-btn');
    if(db){
      var row=db.parentNode;
      [].slice.call(row.children).forEach(function(ch){ if(ch===db || (ch.tagName==='SPAN' && /Kierunek|Direction/.test(ch.textContent))) ch.remove(); });
      row.style.justifyContent='flex-end';
    }
    order();
  }

  function afterStart(){
    var s=$('tryb-session'); if(!s) return;
    ['tryb-back-to-modes','tryb-choose-set'].forEach(function(id){ var el=$(id); if(el) el.remove(); });
    var pr=$('tryb-progress-wrap'); if(pr) pr.style.display='';
    topBar(s); modeBar(s); order();
  }

  function install(){
    var ok=wrap('showTrybModePicker',afterPicker);
    wrap('startTrybMode',afterStart);
    wrap('eylTrybSrsNote',order);
    wrap('eylForgetBar',order);
    return ok;
  }
  (function wait(){ var n=0; (function t(){ if(!install() && n++<60) setTimeout(t,250); })(); })();
})();
