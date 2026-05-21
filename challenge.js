// Eyelingo — Wyzwanie tygodnia

async function initChallenge(){
  clearInterval(_challengeTimer);
  // Oblicz koniec tygodnia (niedziela 23:59)
  var now=new Date(), day=now.getDay(), diff=(7-day)%7||7;
  var end=new Date(now); end.setDate(now.getDate()+diff); end.setHours(23,59,59,999);

  function tick(){
    var rem=end-new Date(), d=Math.floor(rem/86400000), h=Math.floor((rem%86400000)/3600000), m=Math.floor((rem%3600000)/60000);
    var el=document.getElementById('ch-countdown');
    if(el) el.textContent=d+'d '+h+'h '+m+'min';
  }
  tick(); _challengeTimer=setInterval(tick,60000);

  // Wyzwanie — dynamicznie
  var challenges=[
    {name:'Mistrz Podróży 🗺️',desc:'Naucz się 50 słów z kategorii Travel',goal:50,category:'Podróże',topic:'travel, tourism, airports, hotels, transportation, sightseeing, vacation',reward:'500 złota + odznaka Podróżnika'},
    {name:'Biznes Pro 💼',desc:'Opanuj 40 słów z języka biznesu',goal:40,category:'Business',topic:'business, finance, corporate, meetings, negotiations, management, marketing, economics',reward:'400 złota + odznaka Profesjonalisty'},
    {name:'Naukowy Umysł 🔬',desc:'Przyswój 30 słów naukowych',goal:30,category:'Science',topic:'science, biology, chemistry, physics, research, laboratory, discoveries, technology',reward:'300 złota + odznaka Naukowca'},
  ];
  var week=Math.floor(Date.now()/604800000)%challenges.length;
  var ch=challenges[week];
  document.getElementById('ch-name').textContent=ch.name;
  document.getElementById('ch-desc').textContent=ch.desc;
  document.getElementById('ch-reward').textContent='Nagroda za ukończenie: '+ch.reward;

  // Pobierz postęp usera
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(sess){
      var {data:stats}=await db.from('learning_stats').select('cards_seen').eq('user_id',sess.user.id).maybeSingle();
      var myProgress=Math.min(ch.goal, Math.floor((stats?.cards_seen||0)%ch.goal));
      document.getElementById('ch-progress-text').textContent=myProgress+' / '+ch.goal;
      document.getElementById('ch-progress-bar').style.width=Math.round(myProgress/ch.goal*100)+'%';
    }
  }catch(e){}

  loadChallengeRanking();
  document.getElementById('ch-rank-update').textContent='aktualizuje się co 5 min';
  setTimeout(loadChallengeRanking, 300000);
  loadChallengeSet(ch);
}

async function loadChallengeSet(ch){
  var setDesc=document.getElementById('ch-set-desc');
  var setPreview=document.getElementById('ch-set-preview');
  var importBtn=document.getElementById('ch-import-btn');
  var setStatus=document.getElementById('ch-set-status');
  if(!setDesc)return;

  // Check if set already exists in Supabase (public set for this challenge)
  try{
    var {data:existing}=await db.from('user_sets')
      .select('id,name,user_set_cards(word,translation)')
      .eq('name','🏆 '+ch.name)
      .eq('is_public',true)
      .limit(1);
    var ex=existing&&existing[0];
    if(ex&&ex.user_set_cards&&ex.user_set_cards.length>=10){
      renderChallengeSet(ex, ch);
      return;
    }
  }catch(e){}

  // Check cache
  if(_challengeSetCache&&_challengeSetCache.name===ch.name){
    renderChallengeSet(_challengeSetCache, ch);
    return;
  }

  // Generate set via AI
  if(setDesc) setDesc.textContent='Generuję zestaw '+ch.goal+' słówek...';
  if(setStatus) setStatus.textContent='Pierwsze wejście — AI generuje zestaw raz dla wszystkich użytkowników';

  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var res=await fetch(AI_PROXY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':APIKEY_CONST},
      body:JSON.stringify({
        messages:[{role:'user',content:'Generate exactly '+ch.goal+' English vocabulary flashcards strictly about this topic: "'+ch.topic+'". All words must be ONLY from this topic domain. Return ONLY a JSON array with exactly '+ch.goal+' items, no other text: [{"word":"example","translation":"przykład"},...]'}],
        max_tokens:3000
      })
    });
    var data=await res.json();
    var raw=data?.candidates?.[0]?.content?.parts?.[0]?.text||'[]';
    var _bt='`';var clean=raw.replace(new RegExp(_bt+_bt+_bt+'json|'+_bt+_bt+_bt,'g'),'').trim();
    var cards=null;
    try{cards=JSON.parse(clean);}catch(e){var m=clean.match(/\[[\s\S]+\]/);if(m)try{cards=JSON.parse(m[0]);}catch(e2){}}
    if(!cards||!cards.length)throw new Error('Brak fiszek');

    // Save as public set (shared for all)
    if(sess){
      var {data:newSet}=await db.from('user_sets').insert({
        user_id:sess.user.id,name:'🏆 '+ch.name,is_public:true
      }).select('id').single();
      if(newSet){
        var rows=cards.map(function(c,i){return{set_id:newSet.id,word:c.word||c.front,translation:c.translation||c.back,sort_order:i};});
        await db.from('user_set_cards').insert(rows);
        var setObj={id:newSet.id,name:'🏆 '+ch.name,user_set_cards:rows};
        _challengeSetCache=setObj;
        renderChallengeSet(setObj,ch);
        return;
      }
    }
    // No session - show preview only
    var setObj={id:null,name:'🏆 '+ch.name,user_set_cards:cards.map(function(c){return{word:c.word,translation:c.translation};})};
    _challengeSetCache=setObj;
    renderChallengeSet(setObj,ch);
  }catch(e){
    if(setDesc) setDesc.textContent='Błąd ładowania zestawu: '+e.message;
    if(setStatus) setStatus.textContent='Zaloguj się i odśwież aby wygenerować zestaw';
  }
}

function renderChallengeSet(set, ch){
  var setDesc=document.getElementById('ch-set-desc');
  var setPreview=document.getElementById('ch-set-preview');
  var importBtn=document.getElementById('ch-import-btn');
  var setStatus=document.getElementById('ch-set-status');
  var cards=set.user_set_cards||[];
  if(setDesc) setDesc.textContent=cards.length+' słówek z tematu: '+ch.category;
  if(setStatus) setStatus.textContent='Bezpłatny zestaw dla wszystkich · Tylko słownictwo tematyczne';
  window._challengeSetToImport=set;

  // Pokaż podgląd (wszystkie karty) zamiast od razu przycisku importu
  if(setPreview){
    var isExpanded=false;
    var previewCount=8;
    function renderPreviewCards(showAll){
      var visible=showAll?cards:cards.slice(0,previewCount);
      return visible.map(function(c){
        return'<div style="padding:6px 14px;background:var(--paper2);border-radius:20px;border:1px solid var(--border);font-size:12px;color:var(--navy);display:inline-flex;align-items:center;gap:8px;margin:2px">'
          +'<span style="font-weight:600">'+c.word+'</span>'
          +'<span style="color:var(--dim2)">→</span>'
          +'<span style="color:var(--orange)">'+c.translation+'</span>'
          +'</div>';
      }).join('');
    }
    var showMoreBtn=cards.length>previewCount
      ?'<button id="ch-preview-toggle" onclick="(function(){'
        +'var el=document.getElementById(\'ch-preview-cards\');'
        +'var btn=document.getElementById(\'ch-preview-toggle\');'
        +'var exp=el.dataset.expanded===\'1\';'
        +'el.dataset.expanded=exp?\'0\':\'1\';'
        +'el.innerHTML=window._challengeAllCards&&!exp?window._challengeAllCards:window._challengePreviewCards;'
        +'btn.textContent=exp?\'▼ Pokaż wszystkie ('+cards.length+')\':\'▲ Zwiń\';'
        +'})()" style="margin-top:6px;background:transparent;border:1px dashed var(--border2);border-radius:8px;padding:5px 14px;cursor:pointer;font-size:12px;color:var(--dim2)">▼ Pokaż wszystkie ('+cards.length+')</button>'
      :'';
    window._challengePreviewCards=renderPreviewCards(false);
    window._challengeAllCards=renderPreviewCards(true);
    setPreview.innerHTML='<div id="ch-preview-cards" data-expanded="0" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">'+window._challengePreviewCards+'</div>'+showMoreBtn;
  }

  // Przycisk importu pojawia się zawsze po podglądzie
  if(importBtn) importBtn.style.display='flex';
}

async function importChallengeSet(){
  var sess=(await db.auth.getSession()).data.session;
  if(!sess){showToast('Zaloguj się aby importować','error');return;}
  var set=window._challengeSetToImport;
  if(!set||!set.user_set_cards||!set.user_set_cards.length){showToast('Brak zestawu do importu','error');return;}
  var btn=document.getElementById('ch-import-btn');
  if(btn){btn.disabled=true;btn.textContent='Importuję...';}
  try{
    var {data:newSet}=await db.from('user_sets').insert({
      user_id:sess.user.id,name:set.name+' (mój)',is_public:false
    }).select('id').single();
    var rows=set.user_set_cards.map(function(c,i){return{set_id:newSet.id,word:c.word,translation:c.translation,sort_order:i};});
    await db.from('user_set_cards').insert(rows);
    // Oznacz zestaw jako zaimportowany (nie może być publiczny)
    await db.from('user_sets').update({is_public:false,name:set.name+' (mój)'}).eq('id',newSet.id);
    showToast('Zestaw zaimportowany do Materiałów! ✅','success');
    if(btn){btn.textContent='✓ Zaimportowano';btn.disabled=true;}
  }catch(e){
    showToast('Błąd importu: '+e.message,'error');
    if(btn){btn.disabled=false;btn.textContent='+ Importuj do Moich zestawów';}
  }
}

// ── loadChallengeRanking ──
async function loadChallengeRanking(){
  var el=document.getElementById('ch-ranking');
  if(!el) return;
  try{
    var {data}=await db.from('learning_stats')
      .select('user_id,cards_seen')
      .order('cards_seen',{ascending:false})
      .limit(10);
    if(!data||!data.length){el.innerHTML='<div style="color:var(--dim2);font-size:13px;padding:10px">Brak danych</div>';return;}
    // Fetch usernames separately
    var uids=data.map(function(r){return r.user_id;});
    var lbNameMap={};
    try{
      var {data:lbProfs}=await db.from('profiles').select('user_id,username').in('user_id',uids);
      (lbProfs||[]).forEach(function(p){if(p.username)lbNameMap[p.user_id]=p.username;});
    }catch(e){}
    el.innerHTML=data.map(function(r,i){
      var name=lbNameMap[r.user_id]||'Użytkownik';
      var medals=['🥇','🥈','🥉'];
      return'<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">'
        +'<span style="font-size:16px;width:24px">'+(medals[i]||i+1)+'</span>'
        +'<span style="flex:1;font-size:13px;font-weight:600;color:var(--navy)">'+name+'</span>'
        +'<span style="font-size:13px;color:var(--orange);font-weight:700">'+(r.cards_seen||0)+' słów</span>'
        +'</div>';
    }).join('');
  }catch(e){el.innerHTML='<div style="color:var(--dim2);font-size:13px;padding:10px">Błąd ładowania rankingu</div>';}
}
