// Eyelingo — Odkryj świat

// Global helpers accessible from inline onclick
function playYTEmbed(el){
  var vid=el.dataset.vid;
  if(!vid)return;
  el.style.cursor='default';
  el.innerHTML='<iframe style="position:absolute;inset:0;width:100%;height:100%" src="https://www.youtube.com/embed/'+vid+'?autoplay=1&rel=0" frameborder="0" allowfullscreen></iframe>';
}

function initOdkryj(){
  // Szybkie tematy
  var qt=document.getElementById('odkryj-quick-topics');
  if(qt&&!qt.dataset.built){
    qt.dataset.built='1';
    QUICK_TOPICS.forEach(function(t){
      var btn=document.createElement('button');
      btn.textContent=t;
      btn.style.cssText='padding:5px 14px;border-radius:20px;border:1px solid var(--border2);background:var(--paper);font-size:12px;cursor:pointer;transition:.15s;color:var(--dim)';
      btn.onmouseover=function(){this.style.borderColor='var(--orange)';this.style.color='var(--orange)';};
      btn.onmouseout=function(){this.style.borderColor='var(--border2)';this.style.color='var(--dim)';};
      btn.onclick=function(){
        document.getElementById('odkryj-input').value=t;
        doOdkryjSearch();
      };
      qt.appendChild(btn);
    });
  }
  var btn=document.getElementById('odkryj-btn');
  if(btn)btn.onclick=doOdkryjSearch;
  var inp=document.getElementById('odkryj-input');
  if(inp)inp.onkeydown=function(e){if(e.key==='Enter')doOdkryjSearch();};
}

async function doOdkryjSearch(){
  if(_odkryjRunning)return;
  var topic=document.getElementById('odkryj-input').value.trim();
  if(!topic){document.getElementById('odkryj-input').focus();return;}
  _odkryjLang=document.getElementById('odkryj-lang').value||'en';
  _odkryjLevel=document.getElementById('odkryj-level').value||'B1';
  _odkryjRunning=true;

  var btn=document.getElementById('odkryj-btn');
  if(btn){btn.disabled=true;btn.textContent='⏳ Szukam...';}

  var res=document.getElementById('odkryj-results');
  res.innerHTML='<div style="text-align:center;padding:40px 0"><div style="font-size:32px;margin-bottom:12px">⏳</div><div style="color:var(--dim2);font-size:14px">Generuję artykuł i szukam filmów...</div></div>';

  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';

    // Uruchom równolegle: artykuł AI + filmy YT + słownictwo
    var [articleResult, videosResult, vocabResult] = await Promise.allSettled([
      fetchOdkryjArticle(topic, _odkryjLang, _odkryjLevel, tok),
      fetchOdkryjVideos(topic, _odkryjLang, _odkryjLevel, tok),
      fetchOdkryjVocab(topic, _odkryjLang, _odkryjLevel, tok)
    ]);

    res.innerHTML='';

    // LAYOUT 2-kolumnowy: artykuł (lewo) + słownictwo (prawo, sticky)
    var mainGrid=document.createElement('div');
    mainGrid.style.cssText='display:grid;grid-template-columns:1fr 300px;gap:24px;align-items:start';

    // ── LEWA KOLUMNA: artykuł + filmy pod spodem ──
    var leftCol=document.createElement('div');

    // Nagłówek artykułu
    var artHeader=document.createElement('div');
    artHeader.style.cssText='font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--dim2);margin-bottom:12px;display:flex;align-items:center;gap:8px';
    artHeader.innerHTML='📖 Czytanka <span style="font-weight:400;text-transform:none;letter-spacing:0">'+_odkryjLevel+' · '+getLangName(_odkryjLang)+'</span>';
    leftCol.appendChild(artHeader);

    if(articleResult.status==='fulfilled'&&articleResult.value){
      var art=articleResult.value;
      var card=document.createElement('div');
      card.style.cssText='background:#fff;border:2px solid var(--border);border-radius:20px;padding:24px;cursor:pointer;transition:.25s;margin-bottom:24px';
      card.onmouseover=function(){this.style.borderColor='var(--orange)';this.style.boxShadow='0 8px 32px rgba(201,106,42,.1)';};
      card.onmouseout=function(){this.style.borderColor='var(--border)';this.style.boxShadow='none';};
      card.innerHTML='<div style="font-size:20px;font-weight:700;color:var(--navy);margin-bottom:10px;font-family:Syne,sans-serif">'+art.title+'</div>'
        +'<div style="font-size:14px;color:var(--dim);line-height:1.8;margin-bottom:16px">'+art.preview+'</div>'
        +'<button class="btn btn-orange" style="font-size:13px">📖 Czytaj dalej</button>';
      card.onclick=function(){openOdkryjArticle(art);};
      leftCol.appendChild(card);
    } else {
      var errDiv=document.createElement('div');
      errDiv.style.cssText='color:var(--dim2);font-size:13px;padding:20px;background:var(--paper2);border-radius:12px;margin-bottom:24px';
      errDiv.textContent='Nie udało się wygenerować artykułu. Spróbuj ponownie.';
      leftCol.appendChild(errDiv);
    }

    // Filmy pod artykułem
    // Pokaż tagi semantyczne
    var tags = window._odkryjCurrentTags||[];
    if(tags.length){
      var tagsWrap=document.createElement('div');
      tagsWrap.style.cssText='margin-bottom:14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
      tagsWrap.innerHTML='<span style="font-size:11px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.6px;margin-right:4px">🏷️ Tagi:</span>'
        +tags.map(function(tag){
          return'<span style="background:var(--navy);color:#fff;font-size:11px;font-weight:600;padding:3px 10px;border-radius:100px">'+tag+'</span>';
        }).join('');
      leftCol.appendChild(tagsWrap);
    }

    var vidHeader=document.createElement('div');
    vidHeader.style.cssText='font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--dim2);margin-bottom:12px';
    vidHeader.innerHTML='🎙️ Podcasty · <span style="font-weight:400;text-transform:none;letter-spacing:0">poziom '+_odkryjLevel+'</span>';
    leftCol.appendChild(vidHeader);

    if(videosResult.status==='fulfilled'&&videosResult.value&&videosResult.value.length){
      var vGrid=document.createElement('div');
      vGrid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px';
      videosResult.value.forEach(function(v){
        var vCard=document.createElement('div');
        vCard.style.cssText='background:#fff;border:2px solid var(--border);border-radius:16px;overflow:hidden;transition:.2s;cursor:pointer';
        vCard.onmouseover=function(){this.style.borderColor='var(--orange)';};
        vCard.onmouseout=function(){this.style.borderColor='var(--border)';};
        // Thumbnail zamiast iframe (żeby nie ładować wszystkiego od razu)
        vCard.innerHTML='<div style="position:relative;padding-top:56.25%;background:#1a2340;overflow:hidden;cursor:pointer" data-vid="'+v.id+'" onclick="playYTEmbed(this)">'
          +(v.thumbnail?'<img src="'+v.thumbnail+'" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">':'')
          +'<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:48px;height:48px;background:rgba(255,0,0,.85);border-radius:50%;display:flex;align-items:center;justify-content:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"></polygon></svg></div></div>'
          +'</div>'
          +'<div style="padding:12px">'
          +'<div style="font-size:13px;font-weight:600;color:var(--navy);line-height:1.4;margin-bottom:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">'+v.title+'</div>'
          +'<div style="font-size:12px;color:var(--dim2)">'+v.channelTitle+'</div>'
          +'</div>';
        vGrid.appendChild(vCard);
      });
      leftCol.appendChild(vGrid);
    } else {
      var noVid=document.createElement('div');
      noVid.style.cssText='color:var(--dim2);font-size:13px;padding:16px;background:var(--paper2);border-radius:12px';
      noVid.textContent='Brak podcastów dla tego tematu — spróbuj innego słowa kluczowego lub zmień poziom.';
      leftCol.appendChild(noVid);
    }
    mainGrid.appendChild(leftCol);

    // ── PRAWA KOLUMNA: słownictwo (sticky) ──
    var rightCol=document.createElement('div');
    rightCol.style.cssText='position:sticky;top:90px';

    var vocabWrap=document.createElement('div');
    vocabWrap.style.cssText='background:#fff;border:2px solid var(--border);border-radius:20px;overflow:hidden';

    var vocabHead=document.createElement('div');
    vocabHead.style.cssText='padding:16px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between';
    vocabHead.innerHTML='<div><div style="font-size:14px;font-weight:700;color:var(--navy)">📝 Słownictwo</div>'
      +'<div style="font-size:11px;color:var(--dim2);margin-top:2px">'+topic+' · '+_odkryjLevel+'</div></div>';

    if(vocabResult.status==='fulfilled'&&vocabResult.value&&vocabResult.value.length){
      var saveBtn=document.createElement('button');
      saveBtn.className='btn btn-orange';
      saveBtn.style.cssText='font-size:12px;padding:7px 14px';
      saveBtn.textContent='💾 Zapisz zestaw';
      saveBtn.onclick=function(){addVocabToFlashcards(vocabResult.value,topic,_odkryjLang);};
      vocabHead.appendChild(saveBtn);
    }
    vocabWrap.appendChild(vocabHead);

    if(vocabResult.status==='fulfilled'&&vocabResult.value&&vocabResult.value.length){
      var vocabList=document.createElement('div');
      vocabList.style.cssText='padding:12px;display:flex;flex-direction:column;gap:6px;max-height:65vh;overflow-y:auto';
      vocabResult.value.forEach(function(w){
        var row=document.createElement('div');
        row.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:var(--paper2);border-radius:10px;border:1px solid var(--border);gap:8px';
        row.innerHTML='<span style="font-size:13px;font-weight:600;color:var(--navy)">'+w.word+'</span>'
          +'<span style="font-size:12px;color:var(--orange);text-align:right">'+w.translation+'</span>';
        vocabList.appendChild(row);
      });
      vocabWrap.appendChild(vocabList);
    } else {
      var noVocab=document.createElement('div');
      noVocab.style.cssText='padding:20px;color:var(--dim2);font-size:13px;text-align:center';
      noVocab.textContent='Generuję słownictwo...';
      vocabWrap.appendChild(noVocab);
    }
    rightCol.appendChild(vocabWrap);
    mainGrid.appendChild(rightCol);
    res.appendChild(mainGrid);

    // Responsywność — na małych ekranach jedna kolumna
    if(window.innerWidth<768){mainGrid.style.gridTemplateColumns='1fr';}

  }catch(e){
    res.innerHTML='<div style="color:#c33;padding:20px;text-align:center">Błąd: '+e.message+'</div>';
  }

  if(btn){btn.disabled=false;btn.textContent='🔍 Odkryj';}
  _odkryjRunning=false;
}

function getLangName(lang){
  return{en:'Angielski',es:'Hiszpański',nl:'Holenderski',jp:'Japoński'}[lang]||lang;
}

async function fetchOdkryjArticle(topic, lang, level, tok){
  // Sprawdź Supabase cache
  try{
    var{data:cached}=await db.from('daily_articles')
      .select('title,content').eq('topic',topic).eq('language',lang).eq('level',level).limit(1);
    var c=Array.isArray(cached)?cached[0]:cached;
    if(c&&c.title){
      var preview=c.content.slice(0,280)+'...';
      return{title:c.title,content:c.content,preview:preview};
    }
  }catch(e){}

  var res=await fetch(ODKRYJ_ARTICLE_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':ODKRYJ_APIKEY},
    body:JSON.stringify({topic:topic,lang:lang,level:level})
  });
  if(!res.ok)throw new Error('HTTP '+res.status);
  var d=await res.json();
  var title=d.title||topic;
  var body=d.content||d.text||'';
  // Zapisz do Supabase
  try{
    await db.from('daily_articles').upsert(
      {topic:topic,language:lang,level:level,title:title,content:body},
      {onConflict:'topic,language,level'}
    );
  }catch(e){}
  return{title:title,content:body,preview:body.slice(0,280)+'...'};
}

async function getSemanticTags(topic, lang, tok){
  var cacheKey = topic.toLowerCase()+'_'+lang;
  // Sprawdź localStorage cache
  try{
    var cached = JSON.parse(localStorage.getItem('odkryj_tags_'+cacheKey)||'null');
    if(cached && Date.now()-cached.ts < 7*24*3600*1000) return cached.tags; // 7 dni
  }catch(e){}

  // Sprawdź Supabase cache
  try{
    var {data:dbTag} = await db.from('odkryj_tag_cache')
      .select('tags').eq('topic', topic.toLowerCase()).eq('lang', lang).maybeSingle();
    if(dbTag&&dbTag.tags){
      localStorage.setItem('odkryj_tags_'+cacheKey, JSON.stringify({tags:dbTag.tags, ts:Date.now()}));
      return dbTag.tags;
    }
  }catch(e){}

  // Generuj przez AI
  try{
    var langNames={en:'English',es:'Spanish',nl:'Dutch',jp:'Japanese',de:'German',fr:'French'};
    var res = await fetch(ODKRYJ_AI_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':ODKRYJ_APIKEY},
      body: JSON.stringify({
        messages:[{role:'user',content:
          'Given the search topic "'+topic+'", generate 4-6 semantic category tags for finding podcasts about this topic. '
          +'If the topic is a person name, include their profession/field. If it is specific, include broader categories. '
          +'Return ONLY a JSON array of short English tags (2-3 words max each): ["tag1","tag2","tag3"]. No other text.'
        }],
        max_tokens:120
      })
    });
    var d = await res.json();
    var raw = (d?.candidates?.[0]?.content?.parts?.[0]?.text||'[]');
    var _bt='`';var clean = raw.replace(new RegExp(_bt+_bt+_bt+'json|'+_bt+_bt+_bt,'g'),'').trim();
    var tags = [];
    try{ tags = JSON.parse(clean); }catch(e){ var m=clean.match(/\[[\s\S]*\]/); if(m) try{tags=JSON.parse(m[0]);}catch(e2){} }
    if(!tags.length) tags = [topic];
    // Zapisz do Supabase cache
    try{ await db.from('odkryj_tag_cache').upsert({topic:topic.toLowerCase(),lang:lang,tags:tags},{onConflict:'topic,lang'}); }catch(e){}
    // Zapisz do localStorage
    localStorage.setItem('odkryj_tags_'+cacheKey, JSON.stringify({tags:tags, ts:Date.now()}));
    return tags;
  }catch(e){ return [topic]; }
}

async function fetchOdkryjVideos(topic, lang, level, tok){
  var YT_KEY='AIzaSyCUQJksAT-HtZ3GBBMr3__b19nNlHqxajI';
  var langNames={en:'English',es:'Spanish',nl:'Dutch',jp:'Japanese',de:'German',fr:'French'};
  var langCodes={en:'en',es:'es',nl:'nl',jp:'ja',de:'de',fr:'fr'};
  var levelKeywords={A1:'beginner simple',A2:'elementary easy',B1:'intermediate',B2:'upper intermediate',C1:'advanced',C2:'native fluent'};
  var levelKw = levelKeywords[level]||'intermediate';

  // 1. Pobierz tagi semantyczne
  var tags = await getSemanticTags(topic, lang, tok);
  window._odkryjCurrentTags = tags; // do wyświetlenia w UI

  // 2. Buduj zapytania: najpierw dokładny temat, potem tagi
  var queries = [
    topic+' podcast '+langNames[lang]+' '+levelKw,
    tags.slice(0,2).join(' ')+' podcast '+langNames[lang]+' '+levelKw,
    tags[0]+' podcast education'
  ];

  var allResults = [];
  for(var qi=0; qi<queries.length && allResults.length<4; qi++){
    try{
      var q = encodeURIComponent(queries[qi]);
      var url='https://www.googleapis.com/youtube/v3/search?part=snippet&q='+q
        +'&type=video&maxResults=4&relevanceLanguage='+(langCodes[lang]||'en')
        +'&videoDuration=medium&videoEmbeddable=true&key='+YT_KEY;
      var res = await fetch(url);
      if(!res.ok) continue;
      var d = await res.json();
      if(!d.items||!d.items.length) continue;
      var items = d.items
        .filter(function(item){
          // Filtruj tylko podcasty/edukacyjne (wykluczaj klipy muzyczne itp.)
          var title = (item.snippet.title||'').toLowerCase();
          var hasPodcast = title.includes('podcast')||title.includes('episode')||title.includes('ep.')||title.includes('interview')||title.includes('learn')||title.includes('lesson')||title.includes('discussion');
          return item.id.videoId && hasPodcast;
        })
        .map(function(item){
          return{
            id:item.id.videoId,
            title:item.snippet.title,
            channelTitle:item.snippet.channelTitle,
            thumbnail:item.snippet.thumbnails&&item.snippet.thumbnails.medium?item.snippet.thumbnails.medium.url:'',
            queryUsed: queries[qi]
          };
        });
      // Dodaj unikalne (bez duplikatów)
      items.forEach(function(item){
        if(!allResults.find(function(r){return r.id===item.id;})){
          allResults.push(item);
        }
      });
    }catch(e){ console.warn('[YT podcast]', e.message); }
  }

  // Jeśli zero wyników po filtrowaniu — wróć bez filtra
  if(!allResults.length){
    try{
      var fallbackQ = encodeURIComponent(tags[0]+' '+langNames[lang]+' '+levelKw);
      var url2='https://www.googleapis.com/youtube/v3/search?part=snippet&q='+fallbackQ
        +'&type=video&maxResults=3&relevanceLanguage='+(langCodes[lang]||'en')
        +'&videoDuration=medium&videoEmbeddable=true&key='+YT_KEY;
      var res2 = await fetch(url2);
      var d2 = await res2.json();
      allResults = (d2.items||[]).filter(function(i){return i.id.videoId;}).map(function(item){
        return{id:item.id.videoId,title:item.snippet.title,channelTitle:item.snippet.channelTitle,
          thumbnail:item.snippet.thumbnails&&item.snippet.thumbnails.medium?item.snippet.thumbnails.medium.url:''};
      });
    }catch(e){}
  }

  return allResults.slice(0,3);
}

async function addVocabToFlashcards(words, topic, lang){
  var sess=(await db.auth.getSession()).data.session;
  if(!sess){showToast('Zaloguj się aby dodać fiszki','error');return;}
  try{
    var setName='🌍 Odkryj: '+topic;
    var{data:newSet}=await db.from('user_sets').insert({user_id:sess.user.id,name:setName,is_public:false}).select('id').single();
    if(!newSet)throw new Error('Błąd tworzenia zestawu');
    var rows=words.map(function(w,i){return{set_id:newSet.id,word:w.word,translation:w.translation,sort_order:i};});
    await db.from('user_set_cards').insert(rows);
    showToast('Dodano zestaw "'+setName+'" ('+rows.length+' fiszek) ✓','success');
  }catch(e){showToast('Błąd: '+e.message,'error');}
}

function openOdkryjArticle(art){
  var modal=document.getElementById('article-modal');
  var content=document.getElementById('article-modal-content');
  if(!modal||!content)return;
  content.innerHTML='<div style="padding:28px">'
    +'<h2 style="font-family:Syne,sans-serif;font-size:24px;font-weight:700;color:var(--navy);margin-bottom:20px">'+art.title+'</h2>'
    +'<div class="article-reader" id="odkryj-article-body">'+buildOdkryjArticleHTML(art.content,_odkryjLang)+'</div>'
    +'<div id="odkryj-sent-analysis"></div>'
    +'<div id="odkryj-audio-wrap"></div>'
    +'</div>';
  modal.style.display='flex';
  document.body.style.overflow='hidden';
  // Dodaj audio
  addOdkryjAudioBtn(art.content, _odkryjLang);
}

function buildOdkryjArticleHTML(text, lang){
  // Strip ```json wrapping
  var bt='`';
  text=(text||'').replace(new RegExp(bt+bt+bt+'json','g'),'').replace(new RegExp(bt+bt+bt,'g'),'').trim();
  if(text.startsWith('{')){try{var p=JSON.parse(text);text=p.content||p.text||text;}catch(e){}}
  var sentences=text.match(/[^.!?]+[.!?]+/g)||[text];
  return sentences.map(function(sent,idx){
    var trimmed=sent.trim();
    if(!trimmed)return'';
    var words=trimmed.split(/(\s+)/);
    var wordsHtml=words.map(function(w){
      if(/^\s+$/.test(w))return w;
      var clean=w.replace(/[^a-zA-ZÀ-žа-яА-Я]/g,'');
      if(clean.length<2)return w;
      return'<span class="hover-word" data-word="'+clean+'" data-lang="'+lang+'">'+w+'</span>';
    }).join('');
    var safeS=trimmed.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    return'<span class="sent" data-sentence="'+safeS+'" onclick="analyzeOdkryjSentence(this,this.dataset.sentence)" title="Kliknij aby przeanalizować">'+wordsHtml+'</span> ';
  }).join('');
}

async function analyzeOdkryjSentence(el, sentence){
  var panel=document.getElementById('odkryj-sent-analysis');
  if(!panel)return;
  el.style.background='rgba(201,106,42,.15)';
  panel.innerHTML='<div style="padding:12px;color:var(--dim2);font-size:13px">🤖 Analizuję...</div>';
  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var res=await fetch(ODKRYJ_AI_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':ODKRYJ_APIKEY},
      body:JSON.stringify({
        messages:[{role:'user',content:'Analyze this sentence for a Polish speaker: "'+sentence+'". Give: Polish translation, grammar note, key words. Be brief.'}],
        max_tokens:250
      })
    });
    var d=await res.json();
    var analysis=d?.candidates?.[0]?.content?.parts?.[0]?.text||'';
    panel.innerHTML='<div style="margin-top:12px;padding:14px;background:var(--paper2);border-radius:10px;font-size:13px;color:var(--dim);line-height:1.7">'
      +'<div style="font-size:11px;font-weight:700;color:var(--dim2);margin-bottom:6px">ANALIZA ZDANIA</div>'
      +analysis.replace(/\n/g,'<br>')

      +'<button onclick="this.parentElement.style.display=&quot;none&quot;" style="margin-top:8px;font-size:11px;color:var(--dim2);background:none;border:none;cursor:pointer">Zamknij ×</button>'
      +'</div>';
  }catch(e){panel.innerHTML='';}
  setTimeout(function(){el.style.background='';},1500);
}

function addOdkryjAudioBtn(text, lang){
  var wrap=document.getElementById('odkryj-audio-wrap');
  if(!wrap)return;
  var langCode={en:'en-GB',es:'es-ES',nl:'nl-NL',jp:'ja-JP'}[lang]||'en-GB';
  var isPlaying=false;
  var btn=document.createElement('button');
  btn.className='btn btn-navy';
  btn.style.cssText='font-size:13px;padding:8px 16px;margin-top:16px;display:flex;align-items:center;gap:6px';
  btn.innerHTML='🔊 Przeczytaj artykuł';
  btn.onclick=function(){
    if(isPlaying){speechSynthesis.cancel();isPlaying=false;btn.innerHTML='🔊 Przeczytaj artykuł';return;}
    var cleanText=text.replace(/<[^>]+>/g,'');
    var chunks=cleanText.match(/[^.!?]+[.!?]+\s*/g)||[cleanText];
    var voices=speechSynthesis.getVoices();
    var preferred=voices.find(function(v){return v.lang===langCode&&v.name.includes('Google');})||voices.find(function(v){return v.lang.startsWith(lang);});
    var idx=0;
    function next(){
      if(idx>=chunks.length){isPlaying=false;btn.innerHTML='🔊 Przeczytaj artykuł';return;}
      var u=new SpeechSynthesisUtterance(chunks[idx].trim());
      u.lang=langCode;u.rate=0.88;if(preferred)u.voice=preferred;
      u.onend=function(){idx++;next();};
      speechSynthesis.speak(u);idx++;
    }
    isPlaying=true;btn.innerHTML='⏹️ Zatrzymaj';
    speechSynthesis.cancel();next();
  };
  wrap.appendChild(btn);
}

async function addVocabToFlashcards(words, topic, lang){
  var sess=(await db.auth.getSession()).data.session;
  if(!sess){showToast('Zaloguj się aby dodać fiszki','error');return;}
  try{
    var setName='🌍 Odkryj: '+topic;
    var{data:newSet}=await db.from('user_sets').insert({user_id:sess.user.id,name:setName,is_public:false}).select('id').single();
    if(!newSet)throw new Error('Błąd tworzenia zestawu');
    var rows=words.map(function(w,i){return{set_id:newSet.id,word:w.word,translation:w.translation,sort_order:i};});
    await db.from('user_set_cards').insert(rows);
    showToast('Dodano zestaw "'+setName+'" ('+rows.length+' fiszek) ✓','success');
  }catch(e){showToast('Błąd: '+e.message,'error');}
}


async function analyzeOdkryjSentence(el, sentence){
  var panel=document.getElementById('odkryj-sent-analysis');
  if(!panel)return;
  el.style.background='rgba(201,106,42,.15)';
  panel.innerHTML='<div style="padding:12px;color:var(--dim2);font-size:13px">🤖 Analizuję...</div>';
  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var res=await fetch(ODKRYJ_AI_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':ODKRYJ_APIKEY},
      body:JSON.stringify({
        messages:[{role:'user',content:'Analyze this sentence for a Polish speaker: "'+sentence+'". Give: Polish translation, grammar note, key words. Be brief.'}],
        max_tokens:250
      })
    });
    var d=await res.json();
    var analysis=d?.candidates?.[0]?.content?.parts?.[0]?.text||'';
    panel.innerHTML='<div style="margin-top:12px;padding:14px;background:var(--paper2);border-radius:10px;font-size:13px;color:var(--dim);line-height:1.7">'
      +'<div style="font-size:11px;font-weight:700;color:var(--dim2);margin-bottom:6px">ANALIZA ZDANIA</div>'
      +analysis.replace(/\n/g,'<br>')

      +'<button onclick="this.parentElement.style.display=&quot;none&quot;" style="margin-top:8px;font-size:11px;color:var(--dim2);background:none;border:none;cursor:pointer">Zamknij ×</button>'
      +'</div>';
  }catch(e){panel.innerHTML='';}
  setTimeout(function(){el.style.background='';},1500);
}

function addOdkryjAudioBtn(text, lang){
  var wrap=document.getElementById('odkryj-audio-wrap');
  if(!wrap)return;
  var langCode={en:'en-GB',es:'es-ES',nl:'nl-NL',jp:'ja-JP'}[lang]||'en-GB';
  var isPlaying=false;
  var btn=document.createElement('button');
  btn.className='btn btn-navy';
  btn.style.cssText='font-size:13px;padding:8px 16px;margin-top:16px;display:flex;align-items:center;gap:6px';
  btn.innerHTML='🔊 Przeczytaj artykuł';
  btn.onclick=function(){
    if(isPlaying){speechSynthesis.cancel();isPlaying=false;btn.innerHTML='🔊 Przeczytaj artykuł';return;}
    var cleanText=text.replace(/<[^>]+>/g,'');
    var chunks=cleanText.match(/[^.!?]+[.!?]+\s*/g)||[cleanText];
    var voices=speechSynthesis.getVoices();
    var preferred=voices.find(function(v){return v.lang===langCode&&v.name.includes('Google');})||voices.find(function(v){return v.lang.startsWith(lang);});
    var idx=0;
    function next(){
      if(idx>=chunks.length){isPlaying=false;btn.innerHTML='🔊 Przeczytaj artykuł';return;}
      var u=new SpeechSynthesisUtterance(chunks[idx].trim());
      u.lang=langCode;u.rate=0.88;if(preferred)u.voice=preferred;
      u.onend=function(){idx++;next();};
      speechSynthesis.speak(u);idx++;
    }
    isPlaying=true;btn.innerHTML='⏹️ Zatrzymaj';
    speechSynthesis.cancel();next();
  };
  wrap.appendChild(btn);
}

async function fetchOdkryjVocab(topic, lang, level, tok){
  try{
    var langNames={en:'English',es:'Spanish',nl:'Dutch',jp:'Japanese'};
    var res=await fetch(ODKRYJ_AI_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':ODKRYJ_APIKEY},
      body:JSON.stringify({
        messages:[{role:'user',content:'Generate 12 key '+langNames[lang]+' vocabulary words related to "'+topic+'" for '+level+' level learners. Return ONLY JSON array: [{"word":"example","translation":"przykład"}]. No other text.'}],
        max_tokens:400
      })
    });
    var d=await res.json();
    var raw=d?.candidates?.[0]?.content?.parts?.[0]?.text||'[]';
    var _bt='`';var clean=raw.replace(new RegExp(_bt+_bt+_bt+'json|'+_bt+_bt+_bt,'g'),'').trim();
    var parsed=null;
    try{parsed=JSON.parse(clean);}catch(e){var m=clean.match(/\[[\s\S]*\]/);if(m)try{parsed=JSON.parse(m[0]);}catch(e){}}
    return parsed||[];
  }catch(e){return[];}
}
