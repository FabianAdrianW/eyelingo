// Eyelingo — tutors.js

// ═══════════════════════════════════════════════════════
// CHAT V2 — 2-kolumnowy, historia zawsze widoczna
// ═══════════════════════════════════════════════════════
var _tcp = {
  open: false,
  activeTutorId: null,
  activeTutorName: '',
  myId: null,
  realtimeSub: null,
  convs: {},        // tutorId → lastMsg
  contacts: JSON.parse(localStorage.getItem('tutor_contacts')||'{}')
};

async function _tcpGetMyId(){
  if(_tcp.myId) return _tcp.myId;
  var sess=(await db.auth.getSession()).data.session;
  _tcp.myId = sess ? sess.user.id : null;
  return _tcp.myId;
}

// ── Otwórz chat ──
async function openTutorChat(tutorId, tutorName){
  var panel=document.getElementById('tutor-chat-panel');
  panel.classList.add('open');
  _tcp.open=true;

  // Zapisz kontakt
  if(!_tcp.contacts[tutorId]){
    _tcp.contacts[tutorId]=Date.now();
    localStorage.setItem('tutor_contacts',JSON.stringify(_tcp.contacts));
    try{
      var myId=await _tcpGetMyId();
      if(myId) await db.from('tutor_contacts').upsert({user_id:myId,tutor_id:tutorId,contacted_at:new Date().toISOString()},{onConflict:'user_id,tutor_id'});
    }catch(e){}
  }

  // Załaduj listę konwersacji (lewa kolumna)
  loadTcpConvList();

  // Aktywuj konkretną rozmowę
  if(tutorId) activateTcpConv(tutorId, tutorName);

  // Zamknij modal lektora
  var vm=document.getElementById('tutor-view-modal');
  if(vm) vm.style.display='none';
}

function closeTutorChat(){
  document.getElementById('tutor-chat-panel').classList.remove('open');
  _tcp.open=false;
  if(_tcp.realtimeSub){try{db.removeChannel(_tcp.realtimeSub);}catch(e){}_tcp.realtimeSub=null;}
}

function toggleChatPanel(){
  if(_tcp.open){ closeTutorChat(); }
  else {
    var panel=document.getElementById('tutor-chat-panel');
    panel.classList.add('open');
    _tcp.open=true;
    loadTcpConvList();
  }
}

// ── Lista konwersacji (lewa kolumna) ──
async function loadTcpConvList(){
  var myId=await _tcpGetMyId();
  var listEl=document.getElementById('tcp-conv-list');
  if(!myId){listEl.innerHTML='<div class="tcp-empty" style="padding:16px;font-size:12px">Zaloguj się aby zobaczyć wiadomości</div>';return;}
  try{
    var {data:msgs}=await db.from('tutor_messages')
      .select('sender_id,receiver_id,content,created_at,read_at')
      .or('sender_id.eq.'+myId+',receiver_id.eq.'+myId)
      .order('created_at',{ascending:false})
      .limit(200);
    if(!msgs||!msgs.length){
      listEl.innerHTML='<div class="tcp-empty" style="padding:16px;font-size:12px"><span style="font-size:22px">💬</span><span>Brak rozmów.<br>Kliknij ikonę przy lektorze.</span></div>';
      return;
    }
    // Grupuj po rozmówcy
    var convMap={};
    msgs.forEach(function(m){
      var otherId=m.sender_id===myId?m.receiver_id:m.sender_id;
      if(otherId===myId) return; // wyklucz wiadomości do samego siebie
      if(!convMap[otherId]) convMap[otherId]={lastMsg:m,unread:0};
      if(m.receiver_id===myId&&!m.read_at) convMap[otherId].unread++;
    });
    // Pobierz nazwy — profiles username priorytetowy
    var otherIds=Object.keys(convMap);
    var nameMap={};
    var roleMap={};
    if(otherIds.length){
      var {data:profs}=await db.from('profiles').select('user_id,username').in('user_id',otherIds);
      (profs||[]).forEach(function(p){if(p&&p.username&&p.username.trim())nameMap[p.user_id]=p.username.trim();});
      var {data:tuts}=await db.from('tutors').select('user_id,display_name,languages').in('user_id',otherIds);
      (tuts||[]).forEach(function(t){
        roleMap[t.user_id]=true;
        roleMap[t.user_id+'_langs']=t.languages||[]; // przechowaj języki
        // Dla lektora: używamy display_name jeśli brak username (ale username ma priorytet)
        if(!nameMap[t.user_id]&&t.display_name)nameMap[t.user_id]=t.display_name;
      });
      // Fallback: pobierz metadane z auth przez wiadomości
      // (sender email niedostępny bez admin key — użyj display_name z tutors lub sensowny fallback)
      otherIds.forEach(function(id){
        if(!nameMap[id]){
          // Spróbuj wziąć część przed @ z user_id - niemożliwe bez admin
          // Użyj "Nieznany użytkownik" zamiast surowego ID
          nameMap[id]='Nieznany użytkownik';
        }
      });
    }
    listEl.innerHTML='';
    otherIds.forEach(function(otherId){
      var conv=convMap[otherId];
      var name=nameMap[otherId]||'Nieznany użytkownik';
      var isLektor=roleMap[otherId]||false;
      var preview=(conv.lastMsg.content||'').slice(0,32)+(conv.lastMsg.content&&conv.lastMsg.content.length>32?'…':'');
      var item=document.createElement('div');
      item.className='tcp-conv-item'+(otherId===_tcp.activeTutorId?' active':'');
      item.dataset.tid=otherId;
      // Zbuduj sublabel: "Lektor angielskiego" dla lektora, "Użytkownik" dla innych
      var sublabel='';
      if(isLektor){
        // Pobierz język lektora z nameMap extended
        var tutorLangs=roleMap[otherId+'_langs']||[];
        var langNames={en:'angielskiego',es:'hiszpańskiego',nl:'holenderskiego',jp:'japońskiego',de:'niemieckiego',fr:'francuskiego'};
        sublabel='Lektor'+(tutorLangs.length?' '+langNames[tutorLangs[0]]:'');
      }
      item.innerHTML='<div class="tcp-conv-avatar" style="background:'+(isLektor?'var(--orange)':'var(--navy)')+'">'+name[0].toUpperCase()+'</div>'
        +'<div style="flex:1;min-width:0">'
        +'<div class="tcp-conv-name">'+escH(name)+(isLektor?' <span style="font-size:9px;background:var(--orange);color:#fff;padding:1px 5px;border-radius:4px;font-weight:700;vertical-align:middle">LEKTOR</span>':'')+'</div>'
        +'<div class="tcp-conv-preview" style="'+(sublabel?'color:var(--orange);font-size:10px;font-weight:600':'')+'">'+escH(sublabel||preview)+'</div>'
        +(sublabel?'<div class="tcp-conv-preview">'+escH(preview)+'</div>':'')
        +'</div>'
        +(conv.unread?'<div class="tcp-conv-badge">'+conv.unread+'</div>':'');
      item.onclick=function(){activateTcpConv(otherId,name);};
      listEl.appendChild(item);
    });
  }catch(e){listEl.innerHTML='<div style="padding:12px;font-size:12px;color:#c33">Błąd: '+escH(e.message)+'</div>';}
}

// ── Aktywuj konkretną rozmowę ──
async function activateTcpConv(tutorId, tutorName){
  _tcp.activeTutorId=tutorId;
  _tcp.activeTutorName=tutorName||'Lektor';

  // Aktualizuj header
  document.getElementById('tcp-name').textContent=_tcp.activeTutorName;
  document.getElementById('tcp-status').textContent='Rozmowa z lektorem';
  document.getElementById('tcp-avatar').textContent=(_tcp.activeTutorName[0]||'👤').toUpperCase();

  // Podświetl aktywną konwersację
  document.querySelectorAll('.tcp-conv-item').forEach(function(el){
    el.classList.toggle('active',el.dataset.tid===tutorId);
  });

  // Pokaż pole input
  document.getElementById('tcp-input-row').style.display='flex';

  // Załaduj wiadomości
  await loadTcpMessages(tutorId);

  // Realtime
  subscribeTcpRealtime(tutorId);

  setTimeout(function(){var i=document.getElementById('tcp-input');if(i)i.focus();},100);
}

// ── Wiadomości ──
async function loadTcpMessages(tutorId){
  var myId=await _tcpGetMyId();
  if(!myId)return;
  var msgEl=document.getElementById('tcp-messages');
  msgEl.innerHTML='<div style="text-align:center;padding:20px;color:var(--dim2);font-size:12px">Ładowanie…</div>';
  try{
    var {data:msgs}=await db.from('tutor_messages')
      .select('id,sender_id,content,created_at')
      .or('and(sender_id.eq.'+myId+',receiver_id.eq.'+tutorId+'),and(sender_id.eq.'+tutorId+',receiver_id.eq.'+myId+')')
      .order('created_at',{ascending:true})
      .limit(100);
    renderTcpMessages(msgs||[],myId);
    // Oznacz przeczytane
    await db.from('tutor_messages').update({read_at:new Date().toISOString()})
      .eq('sender_id',tutorId).eq('receiver_id',myId).is('read_at',null);
    updateChatBadge();
    // Odśwież listę (żeby badge zniknął)
    loadTcpConvList();
  }catch(e){msgEl.innerHTML='<div style="text-align:center;padding:20px;color:#c33;font-size:12px">Błąd ładowania</div>';}
}

function renderTcpMessages(msgs,myId){
  var el=document.getElementById('tcp-messages');
  if(!msgs.length){
    el.innerHTML='<div class="tcp-empty"><span style="font-size:32px">👋</span><span>Napisz pierwszą wiadomość!</span></div>';
    return;
  }
  el.innerHTML='';
  msgs.forEach(function(m){
    var mine=m.sender_id===myId;
    var time=new Date(m.created_at).toLocaleTimeString('pl',{hour:'2-digit',minute:'2-digit'});
    var wrap=document.createElement('div');
    wrap.style.cssText='display:flex;flex-direction:column;align-items:'+(mine?'flex-end':'flex-start')+';gap:2px';
    wrap.innerHTML='<div class="tcp-bubble '+(mine?'mine':'theirs')+'">'+escH(m.content||'')+'</div>'
      +'<span class="tcp-time">'+time+'</span>';
    el.appendChild(wrap);
  });
  el.scrollTop=el.scrollHeight;
}

// ── Wyślij ──
async function sendChatMsg2(){
  var input=document.getElementById('tcp-input');
  var content=(input.value||'').trim();
  if(!content||!_tcp.activeTutorId)return;
  var myId=await _tcpGetMyId();
  if(!myId){showToast('Zaloguj się aby pisać','error');return;}
  input.value='';
  try{
    await db.from('tutor_messages').insert({sender_id:myId,receiver_id:_tcp.activeTutorId,content:content});
    // Dodaj bąbelek lokalnie
    var el=document.getElementById('tcp-messages');
    var time=new Date().toLocaleTimeString('pl',{hour:'2-digit',minute:'2-digit'});
    var wrap=document.createElement('div');
    wrap.style.cssText='display:flex;flex-direction:column;align-items:flex-end;gap:2px';
    wrap.innerHTML='<div class="tcp-bubble mine">'+escH(content)+'</div>'
      +'<span class="tcp-time">'+time+'</span>';
    // Usuń empty state jeśli istnieje
    var empty=el.querySelector('.tcp-empty');
    if(empty)empty.remove();
    el.appendChild(wrap);
    el.scrollTop=el.scrollHeight;
    // Odśwież listę konwersacji
    setTimeout(loadTcpConvList,300);
  }catch(e){showToast('Błąd wysyłania','error');}
}

// ── Realtime ──
function subscribeTcpRealtime(tutorId){
  if(_tcp.realtimeSub){try{db.removeChannel(_tcp.realtimeSub);}catch(e){}}
  _tcpGetMyId().then(function(myId){
    if(!myId)return;
    _tcp.realtimeSub=db.channel('tcp:'+myId+':'+tutorId)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'tutor_messages',filter:'receiver_id=eq.'+myId},function(payload){
        var m=payload.new;
        if(m.sender_id!==tutorId)return;
        var el=document.getElementById('tcp-messages');
        if(!el)return;
        var time=new Date(m.created_at).toLocaleTimeString('pl',{hour:'2-digit',minute:'2-digit'});
        var wrap=document.createElement('div');
        wrap.style.cssText='display:flex;flex-direction:column;align-items:flex-start;gap:2px';
        wrap.innerHTML='<div class="tcp-bubble theirs">'+escH(m.content||'')+'</div>'
          +'<span class="tcp-time">'+time+'</span>';
        el.appendChild(wrap);
        el.scrollTop=el.scrollHeight;
        updateChatBadge();
        loadTcpConvList();
      })
      .subscribe();
  });
}

async function updateChatBadge(){
  var myId=await _tcpGetMyId();
  if(!myId)return;
  try{
    var {count}=await db.from('tutor_messages').select('id',{count:'exact',head:true}).eq('receiver_id',myId).is('read_at',null);
    var badge=document.getElementById('chat-badge');
    if(badge){badge.textContent=count||'';badge.style.display=count>0?'flex':'none';}
  }catch(e){}
}

// ── Rate Modal V2 (z X i Escape) ──
var _trm={tutorId:null,val:0};
var _trmLabels=['','Bardzo słaby 😞','Słaby 😕','Przeciętny 😐','Dobry 😊','Świetny! 🤩'];

function openRateModal(tutorId){
  _trm.tutorId=tutorId;_trm.val=0;
  document.getElementById('trm-msg').textContent='';
  document.getElementById('trm-comment').value='';
  document.getElementById('trm-label').textContent='';
  document.querySelectorAll('.trm-star').forEach(function(s){s.classList.remove('lit');});
  document.getElementById('tutor-rate-modal').classList.add('open');
}
function closeRateModal(){document.getElementById('tutor-rate-modal').classList.remove('open');}
function setRateModalStar(val){
  _trm.val=val;
  document.querySelectorAll('.trm-star').forEach(function(s,i){s.classList.toggle('lit',i<val);});
  document.getElementById('trm-label').textContent=_trmLabels[val]||'';
}
async function submitRateModal(){
  if(!_trm.val){document.getElementById('trm-msg').innerHTML='<span style="color:#c33">Wybierz ocenę</span>';return;}
  var comment=document.getElementById('trm-comment').value.trim();
  var sess=(await db.auth.getSession()).data.session;
  if(!sess){document.getElementById('trm-msg').innerHTML='<span style="color:#c33">Zaloguj się</span>';return;}
  // Blokada samodzielnego oceniania
  try{
    var {data:ownTutor}=await db.from('tutors').select('id').eq('user_id',sess.user.id).eq('id',_trm.tutorId).maybeSingle();
    if(ownTutor){
      document.getElementById('trm-msg').innerHTML='<span style="color:#c33">Nie możesz oceniać własnego profilu</span>';
      return;
    }
  }catch(e){}
  try{
    await db.from('tutor_reviews').upsert({tutor_id:_trm.tutorId,user_id:sess.user.id,rating:_trm.val,comment:comment},{onConflict:'tutor_id,user_id'});
    var {data:revs}=await db.from('tutor_reviews').select('rating').eq('tutor_id',_trm.tutorId);
    if(revs&&revs.length){
      var avg=revs.reduce(function(s,r){return s+r.rating;},0)/revs.length;
      await db.from('tutors').update({rating_avg:Math.round(avg*10)/10,rating_count:revs.length}).eq('id',_trm.tutorId);
    }
    document.getElementById('trm-msg').innerHTML='<span style="color:#16a34a">✅ Dziękujemy za opinię!</span>';
    setTimeout(closeRateModal,1500);
    if(typeof loadTutors==='function')loadTutors();
  }catch(e){document.getElementById('trm-msg').innerHTML='<span style="color:#c33">Błąd: '+escH(e.message)+'</span>';}
}

// Escape zamyka modal oceny
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    closeRateModal();
    closeTutorChat();
  }
});

// hasTutorContact helper
function hasTutorContact(tutorId){return !!_tcp.contacts[tutorId];}

// Chat badge po zalogowaniu
var _origPostLogin2=window.postLogin;
window.postLogin=function(){if(_origPostLogin2)_origPostLogin2();setTimeout(updateChatBadge,1000);};



// ═══════════════════════════════════════════════════════
// LEKTORZY — nowy design kart (redesign 2.0)
// Psychologia: pre-attentive processing, spatial memory
// ═══════════════════════════════════════════════════════
// ── helper: dostępność — kompaktowe pilulki dni ──
// Psychologia: chunking — grupujemy info w łatwe do skanowania jednostki
function buildAvailBars(avail){
  var DAYS_PL=['Pon','Wt','Śr','Czw','Pt','Sob','Nd'];
  var DAYS_EN=['mon','tue','wed','thu','fri','sat','sun'];
  var activeDays=[];
  DAYS_EN.forEach(function(d,i){
    var day=(avail||{})[d];
    if(day&&day.active) activeDays.push({label:DAYS_PL[i].slice(0,2),from:day.from,to:day.to});
  });
  if(!activeDays.length) return '<div style="font-size:11px;color:var(--dim2)">Brak podanej dostępności</div>';

  // Wypisz tylko aktywne dni jako kompaktowe pilulki
  // Jeśli godziny są te same dla kilku dni — grupuj
  var groups={};
  DAYS_EN.forEach(function(d,i){
    var day=(avail||{})[d];
    if(!day||!day.active)return;
    var key=(day.from||'')+'–'+(day.to||'');
    if(!groups[key])groups[key]=[];
    groups[key].push(DAYS_PL[i].slice(0,2));
  });

  var html='<div style="display:flex;flex-direction:column;gap:5px">';
  Object.keys(groups).forEach(function(hours){
    var days=groups[hours];
    html+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
    html+='<div style="display:flex;gap:3px">';
    days.forEach(function(d){
      html+='<span style="font-size:10px;font-weight:700;background:rgba(22,163,74,.12);color:#15803d;padding:2px 6px;border-radius:5px;border:1px solid rgba(22,163,74,.25)">'+d+'</span>';
    });
    html+='</div>';
    html+='<span style="font-size:10px;color:var(--dim2);font-weight:600">⏰ '+hours+'</span>';
    html+='</div>';
  });
  html+='</div>';
  return html;
}

// ── helper: tygodniowa siatka dostępności (modal) ──
// Psychologia: spatial memory — 7 kolumn = 7 dni, natychmiastowy pattern recognition
function buildFullAvailCalendar(avail){
  var DAYS_PL=['Pon','Wt','Śr','Czw','Pt','Sob','Nd'];
  var DAYS_EN=['mon','tue','wed','thu','fri','sat','sun'];

  // Tygodniowa siatka — 7 kafelków
  var html='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">';
  DAYS_EN.forEach(function(d,i){
    var day=avail[d];
    var active=day&&day.active;
    var isWeekend=i>=5;

    html+='<div style="display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 6px;border-radius:12px;'
      +(active
        ?'background:rgba(22,163,74,.1);border:1.5px solid rgba(22,163,74,.3)'
        :'background:var(--paper2);border:1.5px solid var(--border)')
      +'">';

    // Nazwa dnia
    html+='<span style="font-size:11px;font-weight:700;color:'+(active?'#15803d':'var(--dim2)')+'">'+DAYS_PL[i]+'</span>';

    // Ikona
    html+='<span style="font-size:16px">'+(active?'✅':'—')+'</span>';

    // Godziny
    if(active&&day.from&&day.to){
      html+='<span style="font-size:9px;font-weight:600;color:#15803d;text-align:center;line-height:1.4">'+day.from+'<br>'+day.to+'</span>';
    } else {
      html+='<span style="font-size:9px;color:var(--dim2)">—</span>';
    }
    html+='</div>';
  });
  html+='</div>';

  // Podsumowanie tekstowe pod siatką
  var activeDays=DAYS_EN.filter(function(d){return avail[d]&&avail[d].active;});
  if(activeDays.length){
    html+='<div style="margin-top:10px;font-size:11px;color:var(--dim2);text-align:center">';
    html+='Dostępny <strong style="color:var(--navy)">'+activeDays.length+' dni</strong> w tygodniu';
    html+='</div>';
  }
  return html;
}

// ═══════════════════════════════════════════════════════
// renderTutors — redesign v3.0
// Psychologia: pre-attentive processing, F-pattern, visual hierarchy
// ═══════════════════════════════════════════════════════
function renderTutors(tutors){
  var el=document.getElementById('tutors-list');
  el.innerHTML='';
  if(!tutors||!tutors.length){
    el.innerHTML='<div style="color:var(--dim2);font-size:14px;padding:40px;text-align:center">Brak lektorów spełniających kryteria</div>';
    return;
  }
  var langFlags={'en':'🇬🇧','es':'🇪🇸','nl':'🇳🇱','jp':'🇯🇵','de':'🇩🇪','fr':'🇫🇷','it':'🇮🇹','pt':'🇵🇹'};
  var DAYS_PL=['Pon','Wt','Śr','Czw','Pt','Sob','Nd'];
  var DAYS_EN=['mon','tue','wed','thu','fri','sat','sun'];

  tutors.forEach(function(t){
    var avail=t.availability||{};
    var isTop=(t.rating_avg||0)>=4.5&&(t.rating_count||0)>=3;

    var wrapper=document.createElement('div');
    wrapper.style.cssText='display:flex;gap:10px;align-items:stretch';

    // Chat button
    var chatBtn=document.createElement('button');
    chatBtn.title='Napisz wiadomość';
    chatBtn.style.cssText='flex-shrink:0;width:40px;background:var(--paper2);border:2px solid var(--border);border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.2s;color:var(--dim2)';
    chatBtn.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
    chatBtn.onmouseover=function(){this.style.background='var(--navy)';this.style.color='#fff';this.style.borderColor='var(--navy)';};
    chatBtn.onmouseout=function(){this.style.background='var(--paper2)';this.style.color='var(--dim2)';this.style.borderColor='var(--border)';};
    chatBtn.onclick=function(ev){ev.stopPropagation();openTutorChat(t.user_id||t.id,t.display_name);};
    wrapper.appendChild(chatBtn);

    // KARTA — 2 kolumny: lewa (opis) | prawa (dostępność + video)
    var card=document.createElement('div');
    card.style.cssText='flex:1;border:2px solid var(--border);border-radius:20px;overflow:hidden;background:#fff;cursor:pointer;transition:.25s;display:grid;grid-template-columns:1fr 340px';
    card.onmouseover=function(){this.style.borderColor='var(--orange)';this.style.boxShadow='0 8px 32px rgba(201,106,42,.12)';this.style.transform='translateY(-2px)';};
    card.onmouseout=function(){this.style.borderColor='var(--border)';this.style.boxShadow='none';this.style.transform='none';};
    card.onclick=function(){viewTutor(t.id);};

    // Badge wyróżnionego
    if(isTop){
      var full=document.createElement('div');
      full.style.cssText='grid-column:1/-1;background:linear-gradient(90deg,#f5c842,#c96a2a);color:#fff;font-size:9px;font-weight:700;padding:3px 16px;letter-spacing:.5px;text-align:center';
      full.textContent='⭐ WYRÓŻNIONY LEKTOR';
      card.appendChild(full);
    }

    // ── LEWA: opis lektora ──
    var left=document.createElement('div');
    left.style.cssText='padding:18px 20px;display:flex;flex-direction:column;gap:10px;border-right:1px solid var(--border)';

    // Wiersz 1: avatar + imię + cena (po prawej od imienia)
    var r1=document.createElement('div');
    r1.style.cssText='display:flex;gap:12px;align-items:flex-start';
    var av=document.createElement('div');
    av.style.cssText='width:56px;height:56px;border-radius:50%;background:var(--navy);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;border:2.5px solid var(--paper2)';
    if(t.photo_url){var img=document.createElement('img');img.src=t.photo_url;img.style.cssText='width:100%;height:100%;object-fit:cover';img.onerror=function(){this.parentNode.innerHTML='<span style="font-size:20px;color:#fff">👤</span>';};av.appendChild(img);}
    else av.innerHTML='<span style="font-size:20px;color:#fff">👤</span>';
    r1.appendChild(av);

    var nk=document.createElement('div');
    nk.style.cssText='flex:1;min-width:0';

    // Imię + cena w jednej linii
    var nameLine=document.createElement('div');
    nameLine.style.cssText='display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:3px';
    var nameSpan=document.createElement('span');
    nameSpan.style.cssText='font-size:17px;font-weight:800;color:var(--navy);font-family:Syne,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    nameSpan.textContent=t.display_name||'';
    nameLine.appendChild(nameSpan);
    var priceSpan=document.createElement('span');
    priceSpan.style.cssText='font-size:16px;font-weight:800;color:var(--orange);font-family:Syne,sans-serif;white-space:nowrap;flex-shrink:0';
    priceSpan.textContent=t.price_per_hour?t.price_per_hour+' PLN/h':'Cena do ustalenia';
    if(!t.price_per_hour) priceSpan.style.fontSize='12px';
    nameLine.appendChild(priceSpan);
    nk.appendChild(nameLine);

    // Gwiazdki + opinie + języki
    var meta=document.createElement('div');
    meta.style.cssText='display:flex;align-items:center;gap:5px;flex-wrap:wrap';
    meta.innerHTML=renderStarsDisplay(t.rating_avg||0)
      +'<span style="font-size:11px;color:var(--dim2);font-weight:600">'+(t.rating_avg||0).toFixed(1)+'</span>'
      +'<span style="font-size:11px;color:var(--dim2)">('+(t.rating_count||0)+' opinii)</span>'
      +'<span style="color:var(--border2);margin:0 2px">·</span>'
      +(t.languages||[]).map(function(l){return'<span style="font-size:14px">'+(langFlags[l]||'')+'</span>';}).join('');
    nk.appendChild(meta);
    r1.appendChild(nk);
    left.appendChild(r1);

    // Bio — 3 linie
    if(t.bio){
      var bio=document.createElement('div');
      bio.style.cssText='font-size:13px;color:var(--dim);line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden';
      bio.textContent=t.bio;
      left.appendChild(bio);
    }
    card.appendChild(left);

    // ── PRAWA: dostępność + video obok siebie ──
    var right=document.createElement('div');
    right.style.cssText='display:flex;flex-direction:column;background:var(--paper2);overflow:hidden';

    // Górna część: dostępność + video obok siebie
    var rightTop=document.createElement('div');
    rightTop.style.cssText='display:flex;flex:1;overflow:hidden';

    // Dostępność — kafelki po lewej, godziny po prawej
    var calWrap=document.createElement('div');
    calWrap.style.cssText='padding:14px;flex:1;min-width:200px';
    var calLbl=document.createElement('div');
    calLbl.style.cssText='font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--dim2);margin-bottom:8px';
    calLbl.textContent='📅 Dostępność';
    calWrap.appendChild(calLbl);

    // Lista dni: [kafelek] godziny
    var daysList=document.createElement('div');
    daysList.style.cssText='display:flex;flex-direction:column;gap:4px';
    DAYS_EN.forEach(function(d,i){
      var day=avail[d];var active=day&&day.active;
      var row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:8px;white-space:nowrap';
      // Kafelek dnia
      var tile=document.createElement('div');
      tile.style.cssText='width:34px;height:26px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;'
        +(active?'background:rgba(22,163,74,.15);border:1.5px solid rgba(22,163,74,.4)':'background:var(--paper2);border:1.5px solid var(--border)');
      tile.innerHTML='<span style="font-size:11px;font-weight:800;color:'+(active?'#15803d':'var(--dim2)')+'">'+DAYS_PL[i].slice(0,2)+'</span>';
      row.appendChild(tile);
      // Godziny
      var hrs=document.createElement('span');
      hrs.style.cssText='font-size:12px;font-weight:'+(active?'700':'400')+';color:'+(active?'#15803d':'var(--dim2)');
      hrs.textContent=active&&day.from&&day.to?day.from+' – '+day.to:'—';
      row.appendChild(hrs);
      daysList.appendChild(row);
    });
    calWrap.appendChild(daysList);

    // Poziomy pod dostępnością
    if((t.levels||[]).length){
      var lvlRow=document.createElement('div');
      lvlRow.style.cssText='display:flex;flex-wrap:wrap;gap:4px;margin-top:10px';
      // Pokaż zakres: A1 – C1
      var sorted=(t.levels||[]).sort();
      var first=sorted[0],last=sorted[sorted.length-1];
      var rangeLabel=first===last?first:first+' – '+last;
      var rangeChip=document.createElement('span');
      rangeChip.style.cssText='font-size:10px;font-weight:700;padding:2px 9px;border-radius:6px;border:1.5px solid var(--orange);color:var(--orange);background:#fff';
      rangeChip.textContent=rangeLabel;
      lvlRow.appendChild(rangeChip);
      calWrap.appendChild(lvlRow);
    }
    rightTop.appendChild(calWrap);

    // Video po prawej stronie dostępności
    var vWrap=document.createElement('div');
    vWrap.style.cssText='flex:1;overflow:hidden;border-left:1px solid var(--border);position:relative;background:var(--paper2);display:flex;align-items:center;justify-content:center;min-height:120px';
    if(t.video_url){
      var ytMatch=t.video_url.match(/(?:youtu\.be\/|[?&]v=)([^&\/?]+)/);
      if(ytMatch&&ytMatch[1]){
        var vid=ytMatch[1];
        vWrap.style.background='#000';
        vWrap.innerHTML='<img src="https://img.youtube.com/vi/'+vid+'/mqdefault.jpg" style="width:100%;height:100%;object-fit:cover;opacity:.65">'
          +'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer" onclick="event.stopPropagation();playYTEmbed(this.parentNode)" data-vid="'+vid+'">'
          +'<div style="width:28px;height:28px;background:rgba(255,0,0,.9);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"></polygon></svg></div>'
          +'<span style="font-size:10px;color:#fff;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.6)">Autoprezentacja</span>'
          +'</div>';
      }
    } else {
      vWrap.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;gap:4px">'
        +'<span style="font-size:20px;opacity:.2">🎬</span>'
        +'<span style="font-size:9px;color:var(--dim2);opacity:.6;text-align:center">Brak wideo</span>'
        +'</div>';
    }
    rightTop.appendChild(vWrap);
    right.appendChild(rightTop);
    card.appendChild(right);
    wrapper.appendChild(card);
    el.appendChild(wrapper);
  });
}



// ═══════════════════════════════════════════════════════
// BRAKUJĄCE FUNKCJE LEKTORÓW
// ═══════════════════════════════════════════════════════

// ── viewTutor — podgląd profilu lektora ──
async function viewTutor(tutorId){
  var modal=document.getElementById('tutor-view-modal');
  var contentEl=document.getElementById('tutor-view-content');
  if(!modal||!contentEl)return;
  modal.style.display='flex';
  contentEl.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim2);font-size:14px;gap:10px"><span style="font-size:24px">⏳</span>Ładowanie profilu...</div>';
  contentEl.style.cssText='display:flex;flex-direction:column;height:100%';

  try{
    var {data:t}=await db.from('tutors').select('*').eq('id',tutorId).maybeSingle();
    if(!t){contentEl.innerHTML='<div style="padding:40px;text-align:center;color:var(--dim2)">Nie znaleziono lektora</div>';return;}

    var {data:reviews}=await db.from('tutor_reviews')
      .select('rating,comment,created_at,user_id')
      .eq('tutor_id',tutorId).order('created_at',{ascending:false}).limit(10);

    if(reviews&&reviews.length){
      var uids=reviews.map(function(r){return r.user_id;});
      var {data:rp}=await db.from('profiles').select('user_id,username').in('user_id',uids);
      var rm={};(rp||[]).forEach(function(p){rm[p.user_id]=p.username;});
      reviews.forEach(function(r){r._username=rm[r.user_id]||'Użytkownik';});
    }

    var sess=(await db.auth.getSession()).data.session;
    var myId=sess?sess.user.id:null;

    var DAYS_PL=['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela'];
    var DAYS_EN=['mon','tue','wed','thu','fri','sat','sun'];
    var langFlags={'en':'🇬🇧','es':'🇪🇸','nl':'🇳🇱','jp':'🇯🇵','de':'🇩🇪','fr':'🇫🇷','it':'🇮🇹','pt':'🇵🇹'};
    var langNames={'en':'Angielski','es':'Hiszpański','nl':'Holenderski','jp':'Japoński','de':'Niemiecki','fr':'Francuski','it':'Włoski','pt':'Portugalski'};
    var avail=t.availability||{};
    var activeDays=DAYS_EN.filter(function(d){return avail[d]&&avail[d].active;});

    contentEl.innerHTML='';

    // ── HEADER ──
    var hdr=document.createElement('div');
    hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--border);flex-shrink:0;background:#fff';
    hdr.innerHTML='<span style="font-size:14px;font-weight:700;color:var(--navy)">Profil lektora</span>';
    var cx=document.createElement('button');
    cx.textContent='×';
    cx.style.cssText='background:none;border:none;font-size:26px;cursor:pointer;color:var(--dim2);width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:50%;line-height:1;transition:.15s';
    cx.onmouseover=function(){this.style.background='var(--paper2)';};
    cx.onmouseout=function(){this.style.background='none';};
    cx.onclick=function(){modal.style.display='none';};
    hdr.appendChild(cx);
    contentEl.appendChild(hdr);

    // ── BODY: 3-kolumnowy ──
    var body=document.createElement('div');
    body.style.cssText='display:grid;grid-template-columns:1fr 220px 280px;flex:1;overflow:hidden;min-height:0';

    // ════ KOLUMNA 1: opis lektora ════
    var col1=document.createElement('div');
    col1.style.cssText='padding:24px;overflow-y:auto;display:flex;flex-direction:column;gap:16px;border-right:1px solid var(--border)';

    // Avatar + imię + meta
    var topRow=document.createElement('div');
    topRow.style.cssText='display:flex;gap:16px;align-items:flex-start';
    var av=document.createElement('div');
    av.style.cssText='width:96px;height:96px;border-radius:50%;background:var(--navy);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;border:3px solid var(--paper2)';
    if(t.photo_url){var pi=document.createElement('img');pi.src=t.photo_url;pi.style.cssText='width:100%;height:100%;object-fit:cover';av.appendChild(pi);}
    else av.innerHTML='<span style="font-size:36px;color:#fff">👤</span>';
    topRow.appendChild(av);

    var nameBlock=document.createElement('div');
    nameBlock.style.cssText='flex:1;min-width:0';

    // Imię + cena w jednej linii
    var nameLine=document.createElement('div');
    nameLine.style.cssText='display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px;flex-wrap:wrap';
    nameLine.innerHTML='<span style="font-size:24px;font-weight:800;color:var(--navy);font-family:Syne,sans-serif">'+(t.display_name||'')+'</span>'
      +'<span style="font-size:20px;font-weight:800;color:var(--orange);font-family:Syne,sans-serif;white-space:nowrap">'+(t.price_per_hour?t.price_per_hour+' PLN/h':'Cena do ustalenia')+'</span>';
    nameBlock.appendChild(nameLine);

    // Gwiazdki + opinie
    var ratingLine=document.createElement('div');
    ratingLine.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap';
    ratingLine.innerHTML=renderStarsDisplay(t.rating_avg||0)
      +'<span style="font-size:13px;font-weight:600;color:var(--dim2)">'+(t.rating_avg||0).toFixed(1)+'</span>'
      +'<span style="font-size:13px;color:var(--dim2)">('+(t.rating_count||0)+' opinii)</span>'
      +'<span style="margin:0 4px;color:var(--border2)">·</span>'
      +(t.languages||[]).map(function(l){
        return'<span style="font-size:11px;font-weight:700;background:var(--navy);color:#fff;padding:2px 8px;border-radius:100px">'+(langFlags[l]||'')+'&nbsp;'+(langNames[l]||l)+'</span>';
      }).join('');
    nameBlock.appendChild(ratingLine);

    // Poziomy jako zakres
    if((t.levels||[]).length){
      var sorted=(t.levels||[]).sort();
      var lvlEl=document.createElement('div');
      lvlEl.style.cssText='display:flex;gap:5px;align-items:center;flex-wrap:wrap';
      sorted.forEach(function(lv,i){
        var chip=document.createElement('span');
        chip.style.cssText='font-size:11px;font-weight:700;padding:2px 10px;border-radius:6px;border:1.5px solid var(--orange);color:var(--orange)';
        chip.textContent=lv;
        lvlEl.appendChild(chip);
        if(i<sorted.length-1){var sep=document.createElement('span');sep.style.cssText='color:var(--dim2);font-size:11px';sep.textContent='→';lvlEl.appendChild(sep);}
      });
      nameBlock.appendChild(lvlEl);
    }
    topRow.appendChild(nameBlock);
    col1.appendChild(topRow);

    // Bio — pełne, bez obcinania
    if(t.bio){
      var bioEl=document.createElement('div');
      bioEl.style.cssText='font-size:14px;color:var(--dim);line-height:1.8;padding:16px;background:var(--paper2);border-radius:14px;border-left:3px solid var(--orange)';
      bioEl.textContent=t.bio;
      col1.appendChild(bioEl);
    }

    // Opinie
    var revSec=document.createElement('div');
    revSec.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:10px">Opinie ('+(reviews?reviews.length:0)+')</div>';
    if(reviews&&reviews.length){
      reviews.forEach(function(r){
        var rc=document.createElement('div');
        rc.style.cssText='padding:12px 14px;background:var(--paper2);border-radius:10px;margin-bottom:8px';
        rc.innerHTML='<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px">'
          +'<strong style="font-size:13px;color:var(--navy)">'+(r._username||'Użytkownik')+'</strong>'
          +renderStarsDisplay(r.rating)+'</div>'
          +(r.comment?'<div style="font-size:13px;color:var(--dim);line-height:1.5">'+escH(r.comment)+'</div>':'');
        revSec.appendChild(rc);
      });
    } else {
      revSec.innerHTML+='<div style="font-size:13px;color:var(--dim2);padding:12px;background:var(--paper2);border-radius:10px">Brak opinii — bądź pierwszy!</div>';
    }
    col1.appendChild(revSec);

    // Akcje na dole
    var actRow=document.createElement('div');
    actRow.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:8px';
    var msgBtn=document.createElement('button');
    msgBtn.className='btn btn-orange';msgBtn.style.flex='1';msgBtn.textContent='💬 Napisz wiadomość';
    msgBtn.onclick=function(){modal.style.display='none';openTutorChat(t.user_id||tutorId,t.display_name);};
    actRow.appendChild(msgBtn);
    if(myId&&myId!==t.user_id&&hasTutorContact&&hasTutorContact(tutorId)){
      var rateBtn=document.createElement('button');
      rateBtn.className='btn btn-navy';rateBtn.style.flexShrink='0';rateBtn.textContent='⭐ Oceń';
      rateBtn.onclick=function(){openRateModal(tutorId);};
      actRow.appendChild(rateBtn);
    }
    col1.appendChild(actRow);
    body.appendChild(col1);

    // ════ KOLUMNA 2: dostępność ════
    var col2=document.createElement('div');
    col2.style.cssText='padding:20px;border-right:1px solid var(--border);overflow-y:auto;background:var(--paper2)';

    col2.innerHTML='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--dim2);margin-bottom:14px">📅 Godziny dostępności</div>';

    // Siatka 7 dni — kafelek + godziny
    DAYS_EN.forEach(function(d,i){
      var day=avail[d];var active=day&&day.active;
      var row=document.createElement('div');
      row.style.cssText='display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;margin-bottom:6px;'
        +(active?'background:#fff;border:1.5px solid rgba(22,163,74,.25)':'background:rgba(26,35,64,.03);border:1px solid var(--border)');
      var tile=document.createElement('div');
      tile.style.cssText='width:36px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;'
        +(active?'background:rgba(22,163,74,.15);border:1.5px solid rgba(22,163,74,.4)':'background:var(--paper2);border:1px solid var(--border)');
      tile.innerHTML='<span style="font-size:10px;font-weight:800;color:'+(active?'#15803d':'var(--dim2)')+'">'+DAYS_PL[i].slice(0,3)+'</span>';
      row.appendChild(tile);
      var hrs=document.createElement('span');
      hrs.style.cssText='font-size:12px;font-weight:'+(active?'600':'400')+';color:'+(active?'#15803d':'var(--dim2)');
      hrs.textContent=active&&day.from&&day.to?day.from+' – '+day.to:'niedostępny';
      row.appendChild(hrs);
      col2.appendChild(row);
    });

    if(activeDays.length){
      var sumEl=document.createElement('div');
      sumEl.style.cssText='margin-top:10px;font-size:11px;color:var(--dim2);text-align:center;padding:8px;background:#fff;border-radius:8px';
      sumEl.innerHTML='<strong style="color:var(--navy)">'+activeDays.length+'</strong> dni/tyg dostępny';
      col2.appendChild(sumEl);
    }

    body.appendChild(col2);

    // ════ KOLUMNA 3: video + rezerwacja ════
    var col3=document.createElement('div');
    col3.style.cssText='display:flex;flex-direction:column;overflow-y:auto';

    // Video
    var vbox=document.createElement('div');
    if(t.video_url){
      var ytMatch=t.video_url.match(/(?:youtu\.be\/|[?&]v=)([^&]+)/);
      if(ytMatch&&ytMatch[1]){
        vbox.style.cssText='position:relative;padding-top:56.25%;background:#000;cursor:pointer;flex-shrink:0';
        vbox.dataset.vid=ytMatch[1];
        vbox.onclick=function(){playYTEmbed(this);};
        vbox.innerHTML='<img src="https://img.youtube.com/vi/'+ytMatch[1]+'/mqdefault.jpg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.75">'
          +'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px">'
          +'<div style="width:44px;height:44px;background:rgba(255,0,0,.9);border-radius:50%;display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"></polygon></svg></div>'
          +'<span style="font-size:11px;color:#fff;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.7)">Autoprezentacja</span>'
          +'</div>';
      }
    } else {
      vbox.style.cssText='height:100px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--paper2);border-bottom:1px solid var(--border)';
      vbox.innerHTML='<span style="font-size:24px;opacity:.2">🎬</span><span style="font-size:11px;color:var(--dim2)">Brak wideo</span>';
    }
    col3.appendChild(vbox);

    // Formularz rezerwacji
    var bookBox=document.createElement('div');
    bookBox.style.cssText='padding:18px;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px';

    bookBox.innerHTML='<div style="font-size:12px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.6px">📌 Zarezerwuj lekcję</div>';

    function addField(label, el){
      var wrap=document.createElement('div');
      var lbl=document.createElement('div');
      lbl.style.cssText='font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--dim2);margin-bottom:5px';
      lbl.textContent=label;
      wrap.appendChild(lbl);wrap.appendChild(el);
      bookBox.appendChild(wrap);
    }

    // Wybór dnia
    var daySelect=document.createElement('select');
    daySelect.style.cssText='width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);font-size:13px;font-family:"DM Sans",sans-serif;color:var(--navy);background:var(--paper)';
    var DAYS_PL_FULL=['Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota','Niedziela'];
    var hasDay=false;
    DAYS_EN.forEach(function(d,i){
      if(avail[d]&&avail[d].active){
        var opt=document.createElement('option');
        opt.value=d;opt.textContent=DAYS_PL_FULL[i]+' ('+avail[d].from+'–'+avail[d].to+')';
        daySelect.appendChild(opt);hasDay=true;
      }
    });
    if(!hasDay){var opt=document.createElement('option');opt.textContent='Brak dostępnych dni';daySelect.appendChild(opt);}
    addField('Dzień', daySelect);

    // Godzina z auto-fill
    var hourInput=document.createElement('input');
    hourInput.type='time';
    hourInput.style.cssText='width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);font-size:13px;font-family:"DM Sans",sans-serif';
    // Auto-fill pierwszego dnia
    if(daySelect.options.length>0){
      var fd=daySelect.options[0].value;
      var fda=avail[fd];
      if(fda&&fda.from) hourInput.value=fda.from;
    }
    // Auto-fill przy zmianie dnia
    daySelect.onchange=function(){
      var da=avail[daySelect.value];
      if(da&&da.from) hourInput.value=da.from;
    };
    addField('Godzina', hourInput);

    // Notatka
    var noteInput=document.createElement('textarea');
    noteInput.placeholder='Poziom, cel lekcji, tematyka...';
    noteInput.rows=3;
    noteInput.style.cssText='width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--border);font-size:13px;font-family:"DM Sans",sans-serif;resize:none';
    addField('Wiadomość (opcjonalnie)', noteInput);

    // Przycisk
    var bookBtn=document.createElement('button');
    bookBtn.className='btn btn-orange';
    bookBtn.style.cssText='width:100%;justify-content:center;font-size:14px;padding:12px;margin-top:auto';
    bookBtn.textContent='📨 Wyślij prośbę o lekcję';
    bookBtn.onclick=async function(){
      if(!hasDay){showToast&&showToast('Lektor nie podał dostępności','error');return;}
      var day=daySelect.value;
      var hour=hourInput.value;
      var note=noteInput.value.trim();
      var dayName=daySelect.options[daySelect.selectedIndex]&&daySelect.options[daySelect.selectedIndex].text||day;
      var msg='📚 Prośba o lekcję\n\n📅 '+dayName+'\n⏰ Godzina: '+hour+(note?'\n\n💬 '+note:'');
      modal.style.display='none';
      try{
        var sess2=(await db.auth.getSession()).data.session;
        if(sess2){
          await db.from('tutor_messages').insert({sender_id:sess2.user.id,receiver_id:t.user_id||tutorId,content:msg});
          showToast&&showToast('Prośba wysłana! Sprawdź wiadomości.','success');
          setTimeout(function(){
            openTutorChat(t.user_id||tutorId,t.display_name);
          },300);
        }
      }catch(e){showToast&&showToast('Błąd: '+e.message,'error');}
    };
    bookBox.appendChild(bookBtn);
    col3.appendChild(bookBox);

    body.appendChild(col3);
    contentEl.appendChild(body);

  }catch(e){
    contentEl.innerHTML='<div style="padding:40px;text-align:center;color:#c33;font-size:13px">Błąd ładowania: '+e.message+'</div>';
  }
}


// ── Photo upload functions ──
function handleTutorPhotoFile(input){
  var file=input.files&&input.files[0];
  if(!file)return;
  if(file.size>2*1024*1024){if(typeof showToast==='function')showToast('Plik za duży — max 2MB','error');return;}
  uploadTutorPhoto(file);
}

function handleTutorPhotoDrop(event){
  event.preventDefault();
  var dropEl=document.getElementById('tutor-photo-drop');
  if(dropEl)dropEl.style.borderColor='var(--border)';
  var file=event.dataTransfer&&event.dataTransfer.files&&event.dataTransfer.files[0];
  if(!file)return;
  uploadTutorPhoto(file);
}

async function uploadTutorPhoto(file){
  var label=document.getElementById('tutor-photo-label');
  var preview=document.getElementById('tutor-photo-preview');
  var img=document.getElementById('tutor-photo-img');
  var photoInput=document.getElementById('tutor-photo');
  if(label)label.textContent='⏳ Przesyłanie...';
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){if(typeof showToast==='function')showToast('Zaloguj się','error');return;}
    var ext=file.name.split('.').pop()||'jpg';
    var path='tutors/'+sess.user.id+'_'+Date.now()+'.'+ext;
    var {error}=await db.storage.from('recordings').upload(path,file,{contentType:file.type,upsert:true});
    if(error)throw error;
    var {data:urlData}=db.storage.from('recordings').getPublicUrl(path);
    var url=urlData.publicUrl;
    if(photoInput)photoInput.value=url;
    if(img)img.src=url;
    if(preview)preview.style.display='block';
    if(label)label.textContent='✅ Zdjęcie wgrane!';
    if(typeof showToast==='function')showToast('Zdjęcie dodane!','success');
  }catch(e){
    if(label)label.innerHTML='📷 Upuść zdjęcie lub kliknij<br><span style="font-size:11px">JPG, PNG · max 2MB</span>';
    if(typeof showToast==='function')showToast('Błąd przesyłania: '+e.message,'error');
  }
}

