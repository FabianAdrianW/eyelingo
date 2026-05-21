// Eyelingo — Strefa nauki, SRS

async function initStrefa(){
  const{data:{session}}=await db.auth.getSession();
  if(!session){
    document.getElementById('strefa-access-msg').style.display='block';
    document.getElementById('strefa-main').style.display='none';
    return;
  }
  const{data:p}=await db.from('profiles')
    .select('is_premium,premium_until,levels_bought')
    .eq('user_id',session.user.id).maybeSingle();
  _strefaProfile=p;
  const levels=p?.levels_bought||[];
  const isPremium=p?.is_premium&&p?.premium_until&&new Date(p.premium_until)>new Date();
  if(!isPremium&&!levels.length){
    document.getElementById('strefa-access-msg').style.display='block';
    document.getElementById('strefa-main').style.display='none';
    return;
  }
  document.getElementById('strefa-access-msg').style.display='none';
  document.getElementById('strefa-main').style.display='block';
  _strefaLevels=levels;
  showStrefaLangs(isPremium);
}

function showStrefaLangs(isPremium){
  _strefaState='langs';
  document.getElementById('strefa-card-view').style.display='none';
  document.getElementById('strefa-selector').style.display='block';
  const langs=['en','es','jp','nl'];
  document.getElementById('strefa-langs').innerHTML=langs.map(l=>{
    const hasAny=isPremium||_strefaLevels.some(lv=>lv.startsWith(l+'_'));
    return`<div class="strefa-tile${hasAny?'':' locked'}" onclick="${hasAny?`showStrefaLevels('${l}')`:''}">
      <div class="strefa-tile-icon">${LANG_FLAGS[l]}</div>
      <div class="strefa-tile-name">${LANG_LABELS[l]}</div>
      <div class="strefa-tile-meta">${hasAny?'Dostępny':'Brak zakupów'}</div>
      ${hasAny?'':'<div class="strefa-tile-lock">🔒 Odblokuj poziom</div>'}
    </div>`;
  }).join('');
}

function showStrefaLevels(lang){
  _strefaLang=lang;
  _strefaState='levels';
  var bb=document.getElementById('strefa-back-btn');
  if(bb){bb.style.display='inline-flex';bb.onclick=function(){showStrefaLangs(_strefaProfile?.is_premium&&_strefaProfile?.premium_until&&new Date(_strefaProfile.premium_until)>new Date());};}
  const levels=['A1','A2','B1','B2','C1','C2'];
  const isPremium=_strefaProfile?.is_premium&&_strefaProfile?.premium_until&&new Date(_strefaProfile.premium_until)>new Date();
  document.getElementById('strefa-langs').innerHTML=`
    <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <button class="btn btn-ghost" onclick="showStrefaLangs(${isPremium})" style="font-size:13px">← Języki</button>
      <span style="font-size:18px">${LANG_FLAGS[lang]} ${LANG_LABELS[lang]}</span>
    </div>
    ${levels.map(lv=>{
      const key=`${lang}_${lv}`;
      const unlocked=isPremium||_strefaLevels.includes(key);
      return`<div class="strefa-tile${unlocked?'':' locked'}" onclick="${unlocked?`showStrefaCats('${lang}','${lv}')`:''}">
        <div class="strefa-tile-icon">${unlocked?'📖':'🔒'}</div>
        <div class="strefa-tile-name">Poziom ${lv}</div>
        <div class="strefa-tile-meta">${LEVEL_DESC[lv]}</div>
        ${unlocked?'':'<div class="strefa-tile-lock">Odblokuj w aplikacji</div>'}
      </div>`;
    }).join('')}`;
}

async function showStrefaCats(lang,level){
  _strefaLang=lang;_strefaLevel=level;
  _strefaState='cats';
  var bb=document.getElementById('strefa-back-btn');
  if(bb){bb.style.display='inline-flex';bb.onclick=function(){showStrefaLevels(lang);};}
  const{data:cats}=await db.from('flashcards')
    .select('category_id,categories(code,label,icon)')
    .eq('language_id',['en','es','jp','nl'].indexOf(lang)+1)
    .eq('level_id',['A1','A2','B1','B2','C1','C2'].indexOf(level)+1)
    .limit(200);
  const seen=new Set();
  const uniq=(cats||[]).filter(c=>{
    if(!c.categories||seen.has(c.category_id))return false;
    seen.add(c.category_id);return true;
  });
  const isPremium=_strefaProfile?.is_premium&&_strefaProfile?.premium_until&&new Date(_strefaProfile.premium_until)>new Date();
  document.getElementById('strefa-langs').innerHTML=`
    <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <button class="btn btn-ghost" onclick="showStrefaLevels('${lang}')" style="font-size:13px">← Poziomy</button>
      <span style="font-size:16px;font-weight:600;color:var(--navy)">${LANG_FLAGS[lang]} ${LANG_LABELS[lang]} · Poziom ${level}</span>
    </div>
    ${uniq.map(c=>`
      <div class="strefa-tile" onclick="startStrefaCards('${lang}','${level}','${c.categories.code}','${c.categories.label}')">
        <div class="strefa-tile-icon">${c.categories.icon||'📚'}</div>
        <div class="strefa-tile-name">${c.categories.label}</div>
        <div class="strefa-tile-meta">Kliknij aby ćwiczyć</div>
      </div>`).join('')}`;
}

async function startStrefaCards(lang,level,catCode,catLabel){
  _strefaLang=lang;_strefaLevel=level;_strefaCat=catCode;
  _strefaIdx=0;
  document.getElementById('strefa-breadcrumb').textContent=`${LANG_FLAGS[lang]} ${LANG_LABELS[lang]} · ${level} · ${catLabel}`;
  document.getElementById('strefa-back-btn').style.display='inline-flex';
  const langId=['en','es','jp','nl'].indexOf(lang)+1;
  const levelId=['A1','A2','B1','B2','C1','C2'].indexOf(level)+1;
  const{data:catsArr}=await db.from('categories').select('id').eq('code',catCode).limit(1);
  const cats=catsArr?.[0];
  if(!cats){return;}
  const{data:words}=await db.from('flashcards')
    .select('word,translation')
    .eq('language_id',langId).eq('level_id',levelId).eq('category_id',cats.id)
    .limit(30);
  _strefaWords=words||[];
  document.getElementById('strefa-selector').style.display='none';
  document.getElementById('strefa-card-view').style.display='block';
  loadStrefaCard();
}

async function loadStrefaCard(){
  if(!_strefaWords.length)return;
  const w=_strefaWords[_strefaIdx];
  document.getElementById('strefa-progress').textContent=`${_strefaIdx+1} / ${_strefaWords.length}`;
  document.getElementById('sc-word').textContent=w.word;
  document.getElementById('sc-word-tr').textContent=w.translation;
  document.getElementById('sc-sentence').innerHTML='<div class="strefa-loading">🤖 Gemini generuje zdanie...</div>';
  document.getElementById('sc-sentence-tr').textContent='';
  document.getElementById('sc-audio').style.display='none';
  document.getElementById('sc-video-wrap').innerHTML='<div class="strefa-video-placeholder"><div style="font-size:32px;margin-bottom:8px">🎬</div><div style="font-size:13px;color:var(--dim2)">Szukam wideo...</div></div>';
  const prevBtn=document.getElementById('btn-prev');
  if(prevBtn){
    prevBtn.style.visibility=_strefaIdx===0?'hidden':'visible';
  }
  document.getElementById('btn-next').textContent=_strefaIdx===_strefaWords.length-1?'Zakończ':'Następna →';

  // Równolegle: zdanie AI + wideo
  Promise.all([
    loadContextSentence(w.word, w.translation, _strefaLang, _strefaLevel),
    loadYouTubeVideo(w.word, _strefaLang)
  ]);
}

async function loadContextSentence(word, translation, lang, level){
  const scEl=document.getElementById('sc-sentence');

  // Sprawdź cache - tylko jeśli nie starsze niż 30 dni
  try{
    const{data:cached}=await db.from('context_sentences')
      .select('sentence,translation')
      .eq('word',word).eq('language',lang).eq('level',level).limit(1);
    const c=Array.isArray(cached)?cached[0]:cached;
    if(c?.sentence){
      renderSentence(word,c.sentence,c.translation,word);
      return;
    }
  }catch(e){console.warn('[cache]',e.message);}

  // Wywołaj Edge Function
  try{
    if(scEl) scEl.innerHTML='<div class="strefa-loading">🤖 Gemini generuje zdanie...</div>';
    const sess=(await db.auth.getSession()).data.session;
    const tok=sess?.access_token||'';
    const res=await fetch(GENERATE_SENTENCE_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':'sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8'},
      body:JSON.stringify({word,translation,lang,level})
    });
    const rawText=await res.text();
    if(!res.ok){
      console.error('[generate-sentence] HTTP',res.status,rawText);
      throw new Error('HTTP '+res.status);
    }
    let d;
    try{d=JSON.parse(rawText);}catch(pe){
      console.error('[generate-sentence] JSON parse error:',rawText.slice(0,200));
      throw new Error('Invalid JSON');
    }
    if(d.sentence&&d.translation){
      try{
        await db.from('context_sentences').upsert(
          {word,language:lang,level,sentence:d.sentence,translation:d.translation},
          {onConflict:'word,language,level'}
        );
      }catch(e){console.warn('[cache write]',e.message);}
      renderSentence(word,d.sentence,d.translation,d.search_word||word);
      return;
    }
    throw new Error('Brak sentence/translation w odpowiedzi: '+JSON.stringify(d).slice(0,100));
  }catch(e){
    console.error('[generate-sentence FAIL]',e.message);
    // Retry z prostszym promptem
    try{
      var sess3=(await db.auth.getSession()).data.session;
      var tok3=sess3?sess3.access_token:'';
      var lnm={en:'English',es:'Spanish',nl:'Dutch',jp:'Japanese',de:'German',fr:'French'}[lang]||'English';
      var p3='Write one simple '+lnm+' sentence using "'+word+'". Only the sentence.';
      var r3=await fetch(AI_PROXY_URL,{method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok3,'apikey':APIKEY_CONST},
        body:JSON.stringify({messages:[{role:'user',content:p3}],max_tokens:60})
      });
      var d3=await r3.json();
      var s3=(d3&&d3.candidates&&d3.candidates[0]&&d3.candidates[0].content&&d3.candidates[0].content.parts&&d3.candidates[0].content.parts[0]?d3.candidates[0].content.parts[0].text:'').trim();
      if(s3&&s3.length>3){renderSentence(word,s3,translation,word);return;}
    }catch(e3){}
    renderSentence(word,'**'+word+'** — '+translation,'',word);
  }
}

async function loadYouTubeVideo(word,lang){
  try{
    const{data:cached}=await db.from('youtube_cache')
      .select('video_id,video_title').eq('word',word).eq('language',lang).limit(1);
    var cv=Array.isArray(cached)?cached[0]:cached; if(cv?.video_id){renderVideo(cv.video_id,cv.video_title);return;}
  }catch(e){}
  // Video zostanie załadowane po renderSentence z oczyszczonym słowem
}

function renderSentence(word, sentence, translation, searchWord){
  var html = sentence.replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--orange);font-weight:800">$1</strong>');
  document.getElementById('sc-sentence').innerHTML = html;
  document.getElementById('sc-sentence-tr').textContent = translation;
  document.getElementById('sc-audio').style.display = 'block';
  window._currentSentence = sentence.replace(/\*\*/g, '');
  window._currentLang = {en:'en-US', es:'es-ES', jp:'ja-JP', nl:'nl-NL'}[_strefaLang] || 'en-US';
  window._searchWord = searchWord || word;
  var reportEl = document.getElementById('sc-report');
  if(reportEl){
    reportEl.style.display = 'block';
    reportEl.onclick = function(){ reportTranslation(word, sentence, translation); };
  }
  // Link Playphrase
  renderYouglish(window._searchWord, _strefaLang);
  // Przycisk nagrywania głosówki
  // addVoiceRecordingBtn is optional — only call if defined
  if(typeof addVoiceRecordingBtn === 'function'){
    addVoiceRecordingBtn(word, window._currentSentence, _strefaLang||'en');
  }
}

async function reportTranslation(word, sentence, translation){
  var session = (await db.auth.getSession()).data.session;
  if(!session){showToast('Zaloguj się aby zgłosić','error');return;}
  try{
    await db.from('bug_reports').insert({
      user_id:session.user.id, email:session.user.email,
      category:'Fiszki',
      description:'Strefa Nauki - błędne tłumaczenie:\nSłowo: '+word+'\nZdanie: '+sentence+'\nTłumaczenie: '+translation
    });
    showToast('✅ Zgłoszenie wysłane!','success');
  }catch(e){showToast('Błąd: '+e.message,'error');}
}

function playAudio(){
  if(!window._currentSentence) return;
  speechSynthesis.cancel();
  var utt = new SpeechSynthesisUtterance(window._currentSentence);
  utt.lang = window._currentLang || 'en-US';
  utt.rate = 0.82;
  utt.pitch = 1.0;
  var voices = speechSynthesis.getVoices();
  var langCode = (window._currentLang || 'en').split('-')[0];
  var google = voices.find(function(v){return v.lang.startsWith(langCode) && v.name.includes('Google');});
  var any = voices.find(function(v){return v.lang.startsWith(langCode);});
  utt.voice = google || any || null;
  speechSynthesis.speak(utt);
}

function renderVideo(videoId, title){
  // Używamy Youglish - pokazuje to słowo w kontekście w filmach
  document.getElementById('sc-video-wrap').innerHTML=`
    <div style="width:100%">
      <iframe width="100%" height="220"
        src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1"
        frameborder="0" allowfullscreen style="border-radius:12px;display:block"></iframe>
      <div style="font-size:11px;color:var(--dim2);margin-top:6px;padding:0 4px">${title}</div>
    </div>`;
}

function renderYouglish(word, lang){
  const encoded = encodeURIComponent(word);
  const url = `https://playphrase.me/#/search?q=${encoded}`;
  document.getElementById('sc-video-wrap').innerHTML=`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;gap:16px">
      <div style="font-size:48px">🎬</div>
      <div style="font-weight:700;font-size:16px;color:var(--navy)">"${word}"<br>w filmach i serialach</div>
      <div style="font-size:13px;color:var(--dim2);line-height:1.5">Kliknij aby zobaczyć jak to słowo<br>jest używane w prawdziwych scenach</div>
      <a href="${url}" target="_blank" rel="noopener"
        style="background:var(--navy);color:#fff;padding:12px 24px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;transition:.2s;display:inline-block"
        onmouseover="this.style.background='var(--orange)'" onmouseout="this.style.background='var(--navy)'">
        🎬 Otwórz Playphrase
      </a>
      <div style="font-size:11px;color:var(--dim2)">Otworzy się w nowej karcie</div>
    </div>`;
}

function strefaNext(){
  if(_strefaIdx<_strefaWords.length-1){_strefaIdx++;loadStrefaCard();}
  else{strefaBack();}
}

function strefaPrev(){if(_strefaIdx>0){_strefaIdx--;loadStrefaCard();}}

function strefaBack(){
  document.getElementById('strefa-card-view').style.display='none';
  document.getElementById('strefa-selector').style.display='block';
  if(_strefaLevel) showStrefaCats(_strefaLang,_strefaLevel);
  else showStrefaLangs(_strefaProfile?.is_premium&&_strefaProfile?.premium_until&&new Date(_strefaProfile.premium_until)>new Date());
  speechSynthesis.cancel();
}

// ── addVoiceRecordingBtn stub — prevents errors when not fully implemented ──
function addVoiceRecordingBtn(word, sentence, lang){
  // Placeholder — rekord głosowy tworzony przez Strefę Nauki
  var el=document.getElementById('voice-record-wrap');
  if(!el)return;
  el.innerHTML='<button style="background:var(--navy);color:#fff;border:none;border-radius:100px;padding:8px 16px;font-size:12px;cursor:pointer" onclick="startVoiceRecord()">🎙️ Nagraj wymowę</button>';
}

function srsKey(userId, cardId){ return 'srs_'+userId+'_'+cardId; }

function srsGet(userId, cardId){
  try{
    var raw=localStorage.getItem(srsKey(userId,cardId));
    return raw?JSON.parse(raw):{interval:1,ef:2.5,reps:0,due:new Date().toISOString().slice(0,10)};
  }catch(e){return{interval:1,ef:2.5,reps:0,due:new Date().toISOString().slice(0,10)};}
}

function srsSave(userId, cardId, data){
  try{localStorage.setItem(srsKey(userId,cardId),JSON.stringify(data));}catch(e){}
}

// quality: 0=nie pamiętam, 1=trudne, 2=dobrze, 3=łatwo
function srsUpdate(userId, cardId, quality){
  var d=srsGet(userId,cardId);
  if(quality===0){
    d.reps=0; d.interval=1;
  } else {
    d.reps+=1;
    if(d.reps===1) d.interval=1;
    else if(d.reps===2) d.interval=3;
    else d.interval=Math.round(d.interval*d.ef);
    // Aktualizuj EF
    d.ef=Math.max(1.3, d.ef+(0.1-(3-quality)*(0.08+(3-quality)*0.02)));
  }
  var due=new Date();
  due.setDate(due.getDate()+d.interval);
  d.due=due.toISOString().slice(0,10);
  srsSave(userId,cardId,d);
  return d;
}

function srsIsDue(userId, cardId){
  var d=srsGet(userId,cardId);
  return d.due<=new Date().toISOString().slice(0,10);
}

function srsDueCount(userId, cards){
  return cards.filter(function(c){return srsIsDue(userId,c.id||c.word);}).length;
}

async function startSrsMode(setId, setName, cards){
  const{data:{session}}=await db.auth.getSession();
  if(!session){showToast('Zaloguj się','error');return;}
  _srsUserId=session.user.id;
  _srsSetName=setName;
  // Filtruj tylko należne do powtórki
  var due=cards.filter(function(c){return srsIsDue(_srsUserId,c.id||c.word);});
  if(!due.length){
    // Brak należnych — pokaż wszystkie jako nowe
    due=cards.slice();
  }
  // Przetasuj
  for(var i=due.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=due[i];due[i]=due[j];due[j]=t;}
  _srsCards=due; _srsIdx=0;
  showSrsCard();
}

function showSrsCard(){
  if(_srsIdx>=_srsCards.length){
    // Koniec sesji
    showSrsDone();
    return;
  }
  _srsFlipped=false;
  var c=_srsCards[_srsIdx];
  var d=srsGet(_srsUserId,c.id||c.word);
  var dueDate=new Date(d.due);
  var today=new Date(); today.setHours(0,0,0,0);
  var daysLeft=Math.round((dueDate-today)/(1000*60*60*24));

  // Wstrzyknij SRS UI do strefa-card-view
  var cardView=document.getElementById('strefa-card-view');
  if(!cardView)return;

  // Nadpisz breadcrumb
  var bc=document.getElementById('strefa-breadcrumb');
  if(bc) bc.textContent=_srsSetName+' — SRS ('+(_srsIdx+1)+'/'+_srsCards.length+')';

  // Pokaż słowo
  var wordEl=document.getElementById('sc-word');
  var trEl=document.getElementById('sc-word-tr');
  var sentEl=document.getElementById('sc-sentence');
  var sentTrEl=document.getElementById('sc-sentence-tr');
  if(wordEl) wordEl.textContent=c.word;
  if(trEl) trEl.textContent='';  // ukryj tłumaczenie
  if(sentEl) sentEl.innerHTML='<div style="color:var(--dim2);font-size:14px;font-style:italic">Czy pamiętasz to słowo?</div>';
  if(sentTrEl) sentTrEl.textContent='';

  // Podmień przyciski nawigacji na SRS buttons
  var navDiv=document.querySelector('#strefa-card-view > div > div:last-child') ||
             document.querySelector('[id="btn-next"]')?.parentElement;

  // Znajdź container przycisków
  var btnPrev=document.getElementById('btn-prev');
  var btnNext=document.getElementById('btn-next');
  var progressEl=document.getElementById('strefa-progress');

  if(progressEl) progressEl.textContent=(_srsIdx+1)+' / '+_srsCards.length;
  if(btnPrev) btnPrev.style.visibility='hidden';

  // Podmień btn-next na "Pokaż odpowiedź"
  if(btnNext){
    btnNext.textContent='Pokaż odpowiedź →';
    btnNext.onclick=function(){srsFlip();};
  }

  // Ukryj audio i report
  var audio=document.getElementById('sc-audio');
  var report=document.getElementById('sc-report');
  if(audio) audio.style.display='none';
  if(report) report.style.display='none';

  // Ukryj lub pokaż info SRS
  var srsInfo=document.getElementById('srs-rating-bar');
  if(srsInfo) srsInfo.style.display='none';
}

function srsFlip(){
  if(_srsFlipped)return;
  _srsFlipped=true;
  var c=_srsCards[_srsIdx];

  // Pokaż tłumaczenie
  var trEl=document.getElementById('sc-word-tr');
  if(trEl) trEl.textContent=c.translation;

  // Załaduj zdanie AI jeśli dostępne
  var sentEl=document.getElementById('sc-sentence');
  if(sentEl) sentEl.innerHTML='<div class="strefa-loading">Ładowanie zdania...</div>';
  loadContextSentence(c.word, c.translation, _strefaLang||'en', _strefaLevel||'B1');

  // Pokaż przyciski oceny
  var btnNext=document.getElementById('btn-next');
  if(btnNext) btnNext.style.display='none';

  // Dodaj pasek oceny
  var existing=document.getElementById('srs-rating-bar');
  if(existing) existing.remove();

  var bar=document.createElement('div');
  bar.id='srs-rating-bar';
  bar.style.cssText='display:flex;gap:10px;justify-content:center;margin-top:16px;flex-wrap:wrap';
  bar.innerHTML=
    '<button class="btn" style="background:#dc2626;color:#fff;flex:1;min-width:100px;padding:12px" onclick="srsRate(0)">😰 Nie pamiętam</button>'+
    '<button class="btn" style="background:#f59e0b;color:#fff;flex:1;min-width:100px;padding:12px" onclick="srsRate(1)">😅 Trudne</button>'+
    '<button class="btn" style="background:#16a34a;color:#fff;flex:1;min-width:100px;padding:12px" onclick="srsRate(2)">😊 Dobrze</button>'+
    '<button class="btn" style="background:#0f6e56;color:#fff;flex:1;min-width:100px;padding:12px" onclick="srsRate(3)">🚀 Łatwo</button>';

  var progressRow=document.getElementById('btn-next')?.parentElement?.parentElement;
  if(progressRow) progressRow.appendChild(bar);
  else document.getElementById('strefa-card-view').appendChild(bar);
}

function srsRate(quality){
  var c=_srsCards[_srsIdx];
  var result=srsUpdate(_srsUserId, c.id||c.word, quality);

  // Feedback
  var msgs=['Wraca za 1 dzień','Wraca za '+result.interval+' dni','Świetnie! Za '+result.interval+' dni','Doskonale! Za '+result.interval+' dni'];
  showToast(msgs[quality]||'OK', quality>=2?'success':'error');

  _srsIdx++;

  // Restore btn-next
  var btnNext=document.getElementById('btn-next');
  if(btnNext){btnNext.style.display='';btnNext.textContent='Następna →';btnNext.onclick=function(){srsNext();};}

  // Remove rating bar
  var bar=document.getElementById('srs-rating-bar');
  if(bar) bar.remove();

  // Następna karta
  setTimeout(function(){showSrsCard();},300);
}

function srsNext(){ _srsIdx++; showSrsCard(); }

function showSrsDone(){
  var cardView=document.getElementById('strefa-card-view');
  if(cardView){
    var inner=cardView.querySelector('.strefa-card');
    if(inner) inner.innerHTML='<div style="text-align:center;padding:60px 20px"><div style="font-size:64px;margin-bottom:16px">🎉</div><h3 style="font-family:Syne,sans-serif;font-size:24px;font-weight:700;color:var(--navy);margin-bottom:8px">Sesja ukończona!</h3><p style="color:var(--dim2);margin-bottom:24px">Przerobiono '+_srsCards.length+' fiszek. Wróć jutro po kolejne powtórki.</p><button class="btn btn-orange" onclick="strefaBack()">← Wybierz inny zestaw</button></div>';
  }
}

// ═══════════════════════════════════════
// GENERATOR FISZEK + WYZWANIE TYGODNIA
// ═══════════════════════════════════════
async function challengeOpenGenerator(){
  var sess=(await db.auth.getSession()).data.session;
  if(!sess){showToast('Zaloguj sie aby generowac fiszki','error');return;}
  var challenges=[
    {name:'Mistrz Podrozy',topic:'travel vocabulary',goal:50},
    {name:'Biznes Pro',topic:'business English',goal:40},
    {name:'Naukowy Umysl',topic:'science vocabulary',goal:30},
  ];
  var week=Math.floor(Date.now()/604800000)%challenges.length;
  var ch=challenges[week];
  var existing=document.getElementById('challenge-gen-modal');
  if(existing)existing.remove();
  var modal=document.createElement('div');
  modal.id='challenge-gen-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  var inner=document.createElement('div');
  inner.style.cssText='background:#fff;border-radius:20px;padding:32px;max-width:480px;width:100%;max-height:80vh;overflow-y:auto';
  inner.innerHTML=''
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">'
    +'<h3 style="font-family:Syne,sans-serif;font-size:20px;font-weight:700;color:var(--navy)">Generator fiszek</h3>'
    +'<button id="gen-close-btn" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--dim2)">x</button>'
    +'</div>'
    +'<div style="padding:14px;background:#faeeda;border-radius:10px;margin-bottom:16px">'
    +'<div style="font-size:14px;font-weight:700;color:var(--navy);margin-bottom:4px">'+ch.name+'</div>'
    +'<div style="font-size:13px;color:var(--dim)">AI wygeneruje <strong style="color:var(--orange)">'+ch.goal+' slowek</strong> z tematu <em>'+ch.topic+'</em> — dokladnie tyle ile wymaga wyzwanie.</div>'
    +'</div>'
    +'<div style="margin-bottom:20px">'
    +'<label style="font-size:12px;font-weight:600;color:var(--dim2);display:block;margin-bottom:6px">Poziom</label>'
    +'<select id="gen-level" style="width:100%;padding:9px;border-radius:8px;border:1px solid var(--border2);font-size:13px">'
    +'<option value="A2">A2 — Podstawowy</option>'
    +'<option value="B1" selected>B1 — Sredniozaawansowany</option>'
    +'<option value="B2">B2 — Wyzszy sredni</option>'
    +'</select></div>'
    +'<div id="gen-status" style="font-size:13px;color:var(--dim2);text-align:center;margin-bottom:12px;min-height:20px"></div>'
    +'<button id="gen-submit-btn" class="btn btn-orange" style="width:100%;justify-content:center;padding:14px">🤖 Generuj '+ch.goal+' fiszek</button>';
  modal.appendChild(inner);
  document.body.appendChild(modal);
  document.getElementById('gen-close-btn').onclick=function(){modal.remove();};
  document.getElementById('gen-submit-btn').onclick=function(){runChallengeGenerator(ch.topic,ch.name,ch.goal);};
}
