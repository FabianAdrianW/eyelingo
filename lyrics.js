// Eyelingo — lyrics.js
function initLyrics(){}

function lyricsReset(){
  document.getElementById('lyrics-input-panel').style.display='block';
  document.getElementById('lyrics-result').style.display='none';
  document.getElementById('lyrics-text').value='';
  document.getElementById('lyrics-title').value='';
  _lyricsWords=[];
  window._lyricsSetId=null;
}

async function analyzeLyrics(){
  var text=document.getElementById('lyrics-text').value.trim();
  if(text.length<20){alert('Wklej tekst piosenki (minimum kilka linijek).');return;}
  var title=document.getElementById('lyrics-title').value.trim();
  var lang=document.getElementById('lyrics-lang').value;
  var genre=document.getElementById('lyrics-genre').value;
  var btn=document.getElementById('lyrics-analyze-btn');
  btn.disabled=true; btn.textContent='🤖 AI analizuje...';

  // Usuń poprzedni błąd
  var prevErr=document.getElementById('lyrics-error');
  if(prevErr) prevErr.remove();

  try{
    var langNames={en:'English',es:'Spanish',fr:'French',de:'German',nl:'Dutch',jp:'Japanese',it:'Italian',pt:'Portuguese'};
    var genreNames={hiphop:'hip-hop/rap (WAŻNE: slang uliczny, double entendre, flow, rymy)',pop:'pop',rnb:'R&B/soul',rock:'rock',other:'music'};

    // Podziel tekst na bloki max 60 linii (unikamy przekroczenia tokenów)
    var allLines=text.split('\n').filter(function(l){return l.trim();});
    var CHUNK=80;
    var chunks=[];
    for(var ci=0;ci<allLines.length;ci+=CHUNK){
      chunks.push(allLines.slice(ci,ci+CHUNK).join('\n'));
    }

    var allParsedLines=[];
    var tokL=(await db.auth.getSession()).data.session?.access_token||'';

    for(var chi=0;chi<chunks.length;chi++){
      if(chunks.length>1) btn.textContent='🤖 AI analizuje tekst... ('+Math.round((chi+1)/chunks.length*100)+'%)';
      var prompt='You are a world-class linguist, cultural critic, and musicologist specializing in '+langNames[lang]+' music.\n'
        +'Your task: provide the deepest possible multi-layer analysis for each line of these song lyrics.\n'
        +'For EACH line/verse provide ALL of these layers IN POLISH:\n'
        +'1. Dosłowne znaczenie: co tekst mówi wprost\n'
        +'2. Znaczenie ukryte: metafory, podteksty emocjonalne, psychologiczne, filozoficzne, alternatywne interpretacje\n'
        +'3. Gry słowne: double meanings, homonimy, aliteracje, wieloznaczności, rymy znaczeniowe, idiomy, slang, insider language\n'
        +'4. Kontekst kulturowy: odniesienia historyczne, polityczne, internetowe, religijne, społeczne, popkulturowe, regionalne\n'
        +'5. Referencje: do innych piosenek/artystów/filmów/wydarzeń/memów — zaznacz pewność (wysoka/prawdopodobne/spekulacja)\n'
        +'6. Symbolika: symbole, motywy, archetypy, kolory, liczby, miejsca\n'
        +'7. Warstwa emocjonalna: jakie emocje, mechanizmy psychologiczne\n'
        +'8. Co łatwo przeoczyć: hidden meanings, easter eggs, subtelności\n'
        +'\nRules: Never skip lines. If something only works in the original language, explain exactly why.\n'
        +(title?'Song/Artist: '+title+'\n':'')
        +'Genre: '+genreNames[genre]+'\n'
        +(chunks.length>1?'Part '+(chi+1)+' of '+chunks.length+':\n':'')
        +'\nLyrics:\n'+chunks[chi]+'\n\n'
        +'For EACH line provide:\n'
        +'- annotation: 2-3 sentences IN POLISH explaining: slang meaning, cultural context (references to people/places/events), wordplay, double meanings, metaphors, regional dialect\n'
        +'- words: 2-4 most interesting/difficult words with Polish translation + usage note\n'
        +'Return ONLY valid JSON, no markdown, no explanation:\n'
        +'{"lines":[{"text":"exact lyric line","annotation":"Polish explanation","words":[{"word":"word","translation":"pl tłumaczenie + kontekst"}]}]}\n'
        +'Include ALL lines. Never skip empty or simple lines.';

      var res=await fetch(AI_PROXY_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+tokL,'apikey':APIKEY_CONST},
        body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:4000})
      });
      var data=await res.json();
      var raw=data?.candidates?.[0]?.content?.parts?.[0]?.text||'{}';
      var _bt='`';var clean=raw.replace(new RegExp(_bt+_bt+_bt+'json|'+_bt+_bt+_bt,'g'),'').trim();
      var chunkParsed=null;
      try{chunkParsed=JSON.parse(clean);}catch(e){}
      if(!chunkParsed){var m2=clean.match(/\{[\s\S]*\}/);if(m2){try{chunkParsed=JSON.parse(m2[0]);}catch(e){}}}
      if(chunkParsed&&chunkParsed.lines) allParsedLines=allParsedLines.concat(chunkParsed.lines);
      else {
        // Fallback: dodaj linie bez annotacji
        chunks[chi].split('\n').filter(function(l){return l.trim();}).forEach(function(l){
          allParsedLines.push({text:l,annotation:'',words:[]});
        });
      }
    } // end chunk loop

    if(!allParsedLines.length){
      allParsedLines=allLines.map(function(l){return{text:l,annotation:'Brak analizy.',words:[]};});
    }
    renderLyricsResult({lines:allParsedLines}, title, text);
  }catch(e){
    console.error('[Lyrics]',e);
    var msg='Błąd analizy: '+e.message;
    if(e.message&&(e.message.includes('CORS')||e.message.includes('fetch'))){
      msg='Nie można połączyć z AI. Sprawdź czy funkcja ai-proxy (super-endpoint) jest aktywna w Supabase.';
    }
    document.getElementById('lyrics-result').style.display='none';
    document.getElementById('lyrics-input-panel').style.display='block';
    var errEl=document.getElementById('lyrics-error');
    if(!errEl){
      errEl=document.createElement('div');
      errEl.id='lyrics-error';
      errEl.style.cssText='color:#c33;font-size:13px;margin-top:10px;padding:10px;background:#fcebeb;border-radius:8px';
      document.getElementById('lyrics-input-panel').appendChild(errEl);
    }
    errEl.textContent=msg;
  }
  btn.disabled=false; btn.textContent='🔍 Analizuj';
}

function renderLyricsResult(data, title, originalText){
  document.getElementById('lyrics-input-panel').style.display='none';
  document.getElementById('lyrics-result').style.display='block';
  document.getElementById('lyrics-result-title').textContent=title||'Analiza tekstu';
  _lyricsWords=[];

  var lines=data.lines||originalText.split('\n').map(function(l){return{text:l,annotation:'',words:[]};});
  _lyricsAllLines = lines;

  var lyricsEl=document.getElementById('lyrics-lines');
  lyricsEl.innerHTML='';

  lines.filter(function(l){return l.text&&l.text.trim();}).forEach(function(l,i){
    var div=document.createElement('div');
    div.className='lyric-line-wrap';
    div.id='lyric-'+i;
    div.dataset.idx=i;

    var hasAnnotation=l.annotation&&l.annotation.length>10;

    // Linia tekstu
    var lineText=document.createElement('div');
    lineText.className='lyric-line-text';
    if(hasAnnotation){
      var arrow=document.createElement('span');
      arrow.style.cssText='color:var(--dim2);font-size:11px;margin-right:6px;transition:.2s';
      arrow.textContent='▸';
      lineText.appendChild(arrow);
    }
    lineText.appendChild(document.createTextNode(l.text));
    div.appendChild(lineText);

    // Kliknięcie → pokaż analizę po prawej (jak artykuł)
    div.onclick=function(){
      // Podświetl aktywną linię
      document.querySelectorAll('.lyric-line-wrap').forEach(function(el){
        el.classList.remove('lyric-active');
      });
      div.classList.add('lyric-active');
      showLyricAnalysis(i);
    };

    // Hover
    div.onmouseover=function(){if(!div.classList.contains('lyric-active'))div.style.background='var(--paper2)';};
    div.onmouseout=function(){if(!div.classList.contains('lyric-active'))div.style.background='';};

    lyricsEl.appendChild(div);
  });

  // Zbierz słówka
  lines.forEach(function(l){
    if(l.words) l.words.forEach(function(w){
      if(w&&w.word&&!_lyricsWords.find(function(x){return x.word===w.word;})){
        _lyricsWords.push(w);
      }
    });
  });
  renderLyricsWords();

  // Pokaż hint w prawym panelu
  var sidebar=document.getElementById('lyrics-analysis-sidebar');
  if(sidebar) sidebar.innerHTML='<div style="color:var(--dim2);font-size:13px;text-align:center;padding:20px;display:flex;flex-direction:column;align-items:center;gap:10px"><span style="font-size:28px">👆</span><span>Kliknij linię tekstu<br>aby zobaczyć analizę</span></div>';
}

function showLyricAnalysis(idx){
  var line=_lyricsAllLines[idx];
  if(!line)return;
  var sidebar=document.getElementById('lyrics-analysis-sidebar');
  if(!sidebar)return;

  var html='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--dim2);margin-bottom:10px">📌 Wybrana linia</div>'
    +'<div style="font-size:15px;font-weight:600;color:var(--navy);font-style:italic;margin-bottom:16px;padding:10px 14px;background:var(--paper2);border-radius:10px;border-left:3px solid var(--orange)">"'+(line.text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'"</div>';

  if(line.annotation&&line.annotation.length>5){
    html+='<div style="font-size:13px;color:var(--dim);line-height:1.75;margin-bottom:16px">'+line.annotation.replace(/\n/g,'<br>')+'</div>';
  } else {
    html+='<div style="font-size:13px;color:var(--dim2);margin-bottom:16px;padding:10px;background:var(--paper2);border-radius:8px">Brak szczegółowej analizy tej linii.</div>';
  }

  if(line.words&&line.words.length){
    html+='<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--dim2);margin-bottom:8px">🔑 Kluczowe słowa</div>'
      +'<div style="display:flex;flex-direction:column;gap:8px">'
      +line.words.map(function(w){
        return'<div style="padding:10px 12px;background:#fff;border:1px solid var(--border);border-radius:10px">'
          +'<div style="font-size:13px;font-weight:700;color:var(--navy)">'+(w.word||''||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>'
          +'<div style="font-size:12px;color:var(--orange);margin-top:2px">'+(w.translation||''||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>'
          +'</div>';
      }).join('')
      +'</div>';
  }
  sidebar.innerHTML=html;
}

function toggleLyric(i){
  var el=document.getElementById('lyric-'+i);
  if(el) el.classList.toggle('open');
}

function renderLyricsWords(){
  var panel=document.getElementById('lyrics-words-panel');
  var addBtn=document.getElementById('lyrics-add-all-btn');
  if(!_lyricsWords.length){panel.innerHTML='<div style="color:var(--dim2);font-size:13px">Brak słów do dodania</div>';return;}
  addBtn.style.display='flex';
  panel.innerHTML=_lyricsWords.map(function(w,i){
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">'
      +'<div style="flex:1">'
        +'<div style="font-size:13px;font-weight:600;color:var(--navy)">'+w.word+'</div>'
        +'<div style="font-size:12px;color:var(--dim2)">'+w.translation+'</div>'
      +'</div>'
      +'<span class="word-badge" id="wb-'+i+'" onclick="lyricsAddWord('+i+')">+ Fiszka</span>'
      +'</div>';
  }).join('');
}

async function lyricsEnsureSet(userId){
  if(window._lyricsSetId)return;
  var title=document.getElementById('lyrics-title').value.trim()||'Analiza tekstu';
  var {data:existing}=await db.from('user_sets').select('id').eq('user_id',userId).eq('name','📝 '+title).limit(1);
  var ex=Array.isArray(existing)?existing[0]:existing;
  if(ex&&ex.id){window._lyricsSetId=ex.id;return;}
  var {data:newSet}=await db.from('user_sets').insert({user_id:userId,name:'📝 '+title,is_public:false}).select('id').single();
  if(newSet)window._lyricsSetId=newSet.id;
}

async function lyricsAddWord(i){
  var w=_lyricsWords[i];
  if(!w)return;
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){showToast('Zaloguj się aby dodać fiszkę','error');return;}
    var lang=document.getElementById('lyrics-lang').value;
    await lyricsEnsureSet(sess.user.id);
    await db.from('user_set_cards').insert({set_id:window._lyricsSetId,word:w.word,translation:w.translation,sort_order:Date.now()});
    var badge=document.getElementById('wb-'+i);
    if(badge){badge.textContent='✓ Dodano';badge.className='word-badge added';badge.onclick=null;}
    showToast('Dodano: '+w.word,'success');
  }catch(e){showToast('Błąd: '+e.message,'error');}
}

async function lyricsAddAll(){
  var sess=(await db.auth.getSession()).data.session;
  if(!sess){showToast('Zaloguj się aby dodać fiszki','error');return;}
  var lang=document.getElementById('lyrics-lang').value;
  var rows=_lyricsWords.map(function(w){return{user_id:sess.user.id,word:w.word,translation:w.translation,language:lang,level:'B1',source:'lyrics'};});
  try{
    await lyricsEnsureSet(sess.user.id);
    var rowsMapped=_lyricsWords.map(function(w,i){return{set_id:window._lyricsSetId,word:w.word,translation:w.translation,sort_order:i};});
    await db.from('user_set_cards').insert(rowsMapped);
    _lyricsWords.forEach(function(w,i){
      var badge=document.getElementById('wb-'+i);
      if(badge){badge.textContent='✓ Dodano';badge.className='word-badge added';badge.onclick=null;}
    });
    showToast('Dodano '+rows.length+' fiszek!','success');
  }catch(e){showToast('Błąd: '+e.message,'error');}
}

