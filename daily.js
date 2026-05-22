// Eyelingo — Porcja dnia
// ═══════════════════════════════════════
// DZISIEJSZA PORCJA
// ═══════════════════════════════════════
var _dailyLoaded = false;
var _dailyLoadedDate = '';
var _dailyDone = {word:false, read:false, quiz:false};
var _dailyXP = 0;
var _quizAnswered = false;

function getQuizDoneToday(){
  try{return localStorage.getItem('quiz_done_'+new Date().toISOString().slice(0,10))||'';}catch(e){return '';}
}
function setQuizDoneToday(lang){
  try{localStorage.setItem('quiz_done_'+new Date().toISOString().slice(0,10),lang);}catch(e){}
}

function initDaily(){
  var d = new Date();
  var today = d.toISOString().slice(0,10);
  document.getElementById('daily-date').textContent = d.toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  updateDailyCountdown();
  setInterval(updateDailyCountdown, 60000);
  // Przywróć wybrany język z localStorage
  try{var savedLang=localStorage.getItem('daily_lang');if(savedLang){var sel=document.getElementById('daily-lang-select');if(sel)sel.value=savedLang;}}catch(e){}
  // Ładuj content tylko raz dziennie (nie przy każdym wejściu na zakładkę)
  if(!_dailyLoaded || _dailyLoadedDate !== today){
    _dailyLoaded=true;
    _dailyLoadedDate=today;
    loadDailyContent();
  }
}

function reloadDailyContent(){
  try{var sel=document.getElementById('daily-lang-select');if(sel)localStorage.setItem('daily_lang',sel.value);}catch(e){}
  _dailyLoaded=true;
  _dailyLoadedDate=''; // force reload
  // Reset ALL state
  _dailyDone={word:false,read:false,quiz:false};
  _dailyXP=0;
  _inlineQuizState={step:0,done:false,words:[]};
  // Reset button states
  var btn=document.getElementById('dc-word-btn');
  if(btn){btn.textContent='✓ Zapamiętałem!';btn.disabled=false;}
  ['dc-word-done','dc-read-done','dc-quiz-done2'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.style.display='none';
  });
  var quizBox=document.getElementById('dc-quiz-inline-body');
  if(quizBox)quizBox.innerHTML='<div style="color:var(--dim2);font-size:13px;padding:12px;text-align:center"><span style="font-size:24px;display:block;margin-bottom:8px">👆</span>Kliknij "Zapamiętałem!" aby odblokować quiz</div>';
  document.getElementById('daily-xp').textContent='0 XP';
  loadDailyContent();
}

function updateDailyCountdown(){
  var now=new Date(), midnight=new Date(); midnight.setHours(24,0,0,0);
  var diff=midnight-now, h=Math.floor(diff/3600000), m=Math.floor((diff%3600000)/60000);
  document.getElementById('daily-countdown').textContent='Odnawia się za '+h+'h '+m+'min';
}

async function loadDailyContent(){
  // Słowo dnia — bierz z fiszek usera lub generuj
  loadDailyWord();
  loadDailyRead();
  loadDailyQuiz();
  updateDailyProgress();
}

function showDailyWordFallback(){
  var lang=document.getElementById('daily-lang-select')?document.getElementById('daily-lang-select').value:'en';
  var fallbacks={
    en:[{w:'serendipity',t:'szczęśliwy traf',s:'It was pure **serendipity** that we met.'},{w:'endeavor',t:'dążenie, staranie',s:'His **endeavor** paid off in the end.'}],
    es:[{w:'madrugada',t:'świt, wczesny ranek',s:'Llegué en la **madrugada**.'},{w:'añoranza',t:'tęsknota',s:'Siento **añoranza** por mi hogar.'}],
    nl:[{w:'gezellig',t:'przytulny, miły',s:'Het is zo **gezellig** hier.'},{w:'uitwaaien',t:'wyjść na świeże powietrze',s:'Ik ga even **uitwaaien**.'}],
    jp:[{w:'木漏れ日',t:'światło przebijające przez liście',s:'**木漏れ日**が美しいですね。'},{w:'侘び寂び',t:'piękno niedoskonałości',s:'**侘び寂び**の美学が好きです。'}],
    de:[{w:'Fernweh',t:'tęsknota za podróżami',s:'Ich habe starkes **Fernweh**.'},{w:'Weltschmerz',t:'ból egzystencjalny',s:'Er leidet an **Weltschmerz**.'}],
    fr:[{w:'depaysement',t:'uczucie bycia za granica',s:'Je aime le depaysement des voyages.'},{w:'flaner',t:'beztrosko spacerowac',s:'Je aime flaner dans les rues de Paris.'}]
  };
  var words=fallbacks[lang]||fallbacks['en'];
  document.getElementById('dc-word-loading').style.display='none';
  document.getElementById('dc-word-content').style.display='block';
  document.getElementById('dc-word-text').textContent=words[0].w;
  document.getElementById('dc-word-translation').textContent=words[0].t;
  var s1=words[0].s.replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--orange)">$1</strong>');
  document.getElementById('dc-word-sentence').innerHTML='"'+s1+'"';
  if(words[1]){
    document.getElementById('dc-word-text2').textContent=words[1].w;
    document.getElementById('dc-word-translation2').textContent=words[1].t;
    var s2=words[1].s.replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--orange)">$1</strong>');
    document.getElementById('dc-word-sentence2').innerHTML='"'+s2+'"';
  }
}

async function loadDailyWord(){
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){showDailyWordFallback();return;}

    var dailyLang=document.getElementById('daily-lang-select')?document.getElementById('daily-lang-select').value:'en';
    var pool=[];

    // Try word_progress - filter by language_id
    var langIdMap={'en':1,'es':2,'jp':3,'nl':4,'de':5,'fr':6};
    var langId=langIdMap[dailyLang]||1;
    try{
      var wp_res=await db.from('word_progress')
        .select('ease_factor,flashcards(word,translation,language_id)')
        .eq('user_id',sess.user.id)
        .order('ease_factor',{ascending:true})
        .limit(100);
      if(wp_res.data&&wp_res.data.length){
        var langFiltered=wp_res.data.filter(function(r){
          return r.flashcards&&r.flashcards.word&&r.flashcards.language_id===langId;
        });
        if(langFiltered.length>=2){
          pool=langFiltered.map(function(r){return{word:r.flashcards.word,translation:r.flashcards.translation};});
        }
        // If not enough for selected lang — fallback to all langs
        if(pool.length<2){
          pool=wp_res.data.filter(function(r){return r.flashcards&&r.flashcards.word;})
            .map(function(r){return{word:r.flashcards.word,translation:r.flashcards.translation};});
        }
      }
    }catch(e){}

    // Fallback: user_sets
    if(pool.length<2){
      try{
        // Try user_sets filtered by language name in set name
        var sets_res=await db.from('user_sets')
          .select('name,user_set_cards(word,translation)')
          .eq('user_id',sess.user.id).limit(20);
        if(sets_res.data){
          var langKeywords={'en':['english','angielski','ang'],'es':['spanish','español','hiszp'],'jp':['japanese','japoński','jap'],'nl':['dutch','niderlandzki','hol'],'de':['german','deutsch','niem'],'fr':['french','français','franc']};
          var keys=langKeywords[dailyLang]||[];
          // First try sets matching language name
          var langSets=sets_res.data.filter(function(s){
            var n=(s.name||'').toLowerCase();
            return keys.some(function(k){return n.includes(k);});
          });
          // If no language-specific sets, use all sets (last resort)
          var useSets=langSets.length>0?langSets:sets_res.data;
          useSets.forEach(function(s){if(s.user_set_cards)pool=pool.concat(s.user_set_cards);});
        }
      }catch(e){}
    }

    // If still no words — use language-specific fallback
    if(pool.length<2){showDailyWordFallback();return;}

    // Dwa deterministyczne słówka (seed = data, zmieniają się każdego dnia)
    var seed=parseInt(new Date().toISOString().slice(0,10).replace(/-/g,''));
    var i1=seed%pool.length;
    var i2=(seed*7+3)%pool.length;
    if(i1===i2) i2=(i2+1)%pool.length;
    var card=pool[i1];
    var card2=pool[i2];
    var dailyLang=document.getElementById('daily-lang-select')?document.getElementById('daily-lang-select').value:'en';

    document.getElementById('dc-word-loading').style.display='none';
    document.getElementById('dc-word-content').style.display='block';
    document.getElementById('dc-word-text').textContent=card.word;
    document.getElementById('dc-word-translation').textContent=card.translation;
    document.getElementById('dc-word-text2').textContent=card2.word;
    document.getElementById('dc-word-translation2').textContent=card2.translation;

    // Zdania z cache lub generuj przez AI
    function loadSentenceEl(w,translation,elId){
      var el=document.getElementById(elId);
      if(el) el.innerHTML='<span style="color:var(--dim2);font-style:normal;font-size:12px">⏳ Generuję zdanie...</span>';
      db.from('context_sentences').select('sentence').eq('word',w).eq('language',dailyLang).limit(1).then(function(r){
        var c=r.data&&(Array.isArray(r.data)?r.data[0]:r.data);
        if(c&&c.sentence){
          var s=c.sentence.replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--orange)">$1</strong>');
          if(el) el.innerHTML='"'+s+'"';
        } else {
          // Generuj zdanie przez AI
          db.auth.getSession().then(function(sr){
            var tok=sr.data&&sr.data.session?sr.data.session.access_token:'';
            fetch(GENERATE_SENTENCE_URL,{
              method:'POST',
              headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':SUPABASE_KEY},
              body:JSON.stringify({word:w,translation:translation,lang:dailyLang,level:'B1'})
            }).then(function(res){return res.json();}).then(function(d){
              if(d&&d.sentence){
                var s=d.sentence.replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--orange)">$1</strong>');
                if(el) el.innerHTML='"'+s+'"';
                // Zapisz do cache
                db.from('context_sentences').upsert(
                  {word:w,language:dailyLang,level:'B1',sentence:d.sentence,translation:d.translation||''},
                  {onConflict:'word,language,level'}
                ).then(function(){}).catch(function(){});
              } else {
                if(el) el.innerHTML='<span style="color:var(--dim2);font-style:normal;font-size:12px">Brak zdania — wróć po sesji nauki</span>';
              }
            }).catch(function(){
              if(el) el.innerHTML='<span style="color:var(--dim2);font-style:normal;font-size:12px">Brak zdania — wróć po sesji nauki</span>';
            });
          });
        }
      }).catch(function(){});
    }
    loadSentenceEl(card.word,card.translation,'dc-word-sentence');
    loadSentenceEl(card2.word,card2.translation,'dc-word-sentence2');

  }catch(e){showDailyWordFallback();}
}


async function loadDailyRead(){
  var dLang=document.getElementById('daily-lang-select')?document.getElementById('daily-lang-select').value:'en';
  var topics={
    en:['interesting science fact','unusual animal behavior','fascinating history','space exploration','human psychology'],
    es:['hecho cientifico curioso','historia fascinante','naturaleza increible'],
    nl:['interessant wetenschappelijk feit','bijzondere geschiedenis'],
    jp:['omoshiroi kagaku no jijitsu','fushigina dobutsu no kodo']
  };
  var topicArr=topics[dLang]||topics['en'];
  var todayIdx=new Date().getDay()%topicArr.length;
  var topic=topicArr[todayIdx];
  var today=new Date().toISOString().slice(0,10);
  var lsKey='daily_article_'+dLang+'_'+today;

  function displayArticle(title, body){
    document.getElementById('dc-read-loading').style.display='none';
    var cont=document.getElementById('dc-read-content');
    cont.style.display='flex';

    // Strip ```json wrapping if AI returned raw JSON
    var cleanBody = body||'';
    var bt='`';
    cleanBody = cleanBody.replace(new RegExp(bt+bt+bt+'json','g'),'').replace(new RegExp(bt+bt+bt,'g'),'').trim();
    // If it looks like JSON object, try to parse content field
    if(cleanBody.startsWith('{')){
      try{
        var parsed=JSON.parse(cleanBody);
        cleanBody=parsed.content||parsed.text||parsed.body||title||'';
        if(parsed.title&&parsed.title!==title) title=parsed.title;
      }catch(e){}
    }

    document.getElementById('dc-read-title').textContent=title;
    var wc=Math.ceil((cleanBody.split(' ').length||1)/200);
    document.getElementById('dc-read-time').textContent=Math.max(1,wc)+' min';
    document.getElementById('dc-read-body').innerHTML=buildArticleHTML(cleanBody, dLang);
    addArticleAudioBtn(cleanBody, dLang);
  }

  // 1. Sprawdź localStorage cache
  try{
    var lsCached=localStorage.getItem(lsKey);
    if(lsCached){var a=JSON.parse(lsCached);displayArticle(a.title,a.body);return;}
  }catch(e){}

  // 2. Sprawdź Supabase cache (permanentny dla wszystkich)
  try{
    var{data:dbCached}=await db.from('daily_articles')
      .select('title,content').eq('topic',topic).eq('language',dLang).eq('level','B1').limit(1);
    var dc=Array.isArray(dbCached)?dbCached[0]:dbCached;
    if(dc&&dc.title){
      try{localStorage.setItem(lsKey,JSON.stringify({title:dc.title,body:dc.content}));}catch(e){}
      displayArticle(dc.title,dc.content);
      return;
    }
  }catch(e){}

  // 3. Generuj nowy artykuł
  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var res=await fetch(GENERATE_ARTICLE_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':'sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8'},
      body:JSON.stringify({topic:topic,lang:dLang,level:'B1'})
    });
    if(res.status===429)throw new Error('rate_limit');
    if(!res.ok)throw new Error('HTTP '+res.status);
    var d=await res.json();
    // Strip markdown code fences if AI returned raw JSON string
    // Parse AI response — handle raw JSON, markdown fences, nested objects
    var rawText = d.content||d.text||d.body||'';
    if(typeof d === 'object' && !rawText && d.title) rawText = d.content||'';
    var bt = '`';
    rawText = rawText.replace(new RegExp(bt+bt+bt+'json','g'),'').replace(new RegExp(bt+bt+bt,'g'),'').trim();
    if(rawText.startsWith('{')){
      try{
        var parsed2=JSON.parse(rawText);
        rawText=parsed2.content||parsed2.text||parsed2.body||rawText;
        if(!d.title&&parsed2.title) d.title=parsed2.title;
      }catch(e){}
    }
    var title=d.title||topic;
    var body=rawText;
    // Zapisz do Supabase permanentnie
    try{
      await db.from('daily_articles').upsert(
        {topic:topic,language:dLang,level:'B1',title:title,content:body},
        {onConflict:'topic,language,level'}
      );
    }catch(e){}
    // Zapisz do localStorage
    try{localStorage.setItem(lsKey,JSON.stringify({title:title,body:body}));}catch(e){}
    displayArticle(title, body);
  }catch(e){
    document.getElementById('dc-read-loading').style.display='none';
    document.getElementById('dc-read-content').style.display='flex';
    var isLimit=e.message==='rate_limit';
    document.getElementById('dc-read-title').textContent=isLimit?'Spróbuj za chwilę':'Ciekawostka dnia';
    var fallbacks={
      en:'Cats purr not just when content. Scientists found that purring vibrations (25–150 Hz) promote healing in bones and tissues.',
      es:'Los gatos ronronean no solo cuando están contentos. Los científicos descubrieron que las vibraciones del ronroneo promueven la curación.',
      nl:'Katten spinnen niet alleen als ze tevreden zijn. De trillingen bevorderen genezing van botten en weefsels.',
      jp:'猫が喉を鳴らすのは満足しているときだけではありません。その振動が治癒を促進することが発見されました。'
    };
    document.getElementById('dc-read-body').textContent=isLimit?'Generator chwilowo przeciążony. Wróć za kilka minut.':fallbacks[dLang]||fallbacks['en'];
  }
}

// Buduje HTML artykułu z klikalnymi zdaniami i hoverowanymi słowami
function buildArticleHTML(text, lang){
  // Strip ```json if present
  var bt='`';
  text=(text||'').replace(new RegExp(bt+bt+bt+'json','g'),'').replace(new RegExp(bt+bt+bt,'g'),'').trim();
  if(text.startsWith('{')){try{var _p=JSON.parse(text);text=_p.content||_p.text||text;}catch(e){}}
  // Override hover to use sidebar instead of tooltip
  window._articleLang = lang;
  // Podziel na zdania
  var sentences=text.match(/[^.!?]+[.!?]+/g)||[text];
  return sentences.map(function(sent,idx){
    var trimmed=sent.trim();
    if(!trimmed)return'';
    // Opakuj każde słowo w span z hover
    var words=trimmed.split(/(\s+)/);
    var wordsHtml=words.map(function(w){
      if(/^\s+$/.test(w))return w;
      var clean=w.replace(/[^a-zA-ZÀ-žа-яА-Яぁ-ん一-龯]/g,'');
      if(clean.length<2)return w;
      return'<span class="hover-word" data-word="'+clean+'" data-lang="'+lang+'">'+w+'</span>';
    }).join('');
    var safeS2=trimmed.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    return'<span class="sent" data-idx="'+idx+'" data-sentence="'+safeS2+'" onclick="analyzeSentence(this,this.dataset.sentence)" title="Kliknij aby przetłumaczyć zdanie">'+wordsHtml+'</span> ';
  }).join('');
}

// Kliknięcie w zdanie → tłumaczenie po prawej w sidebarze
var _sentCache={};
async function analyzeSentence(el, sentence){
  // Podświetl aktywne zdanie
  document.querySelectorAll('.sent.active-sent').forEach(function(s){s.classList.remove('active-sent');});
  el.classList.add('active-sent');

  var lang=window._articleLang||'en';
  var sb=document.getElementById('dc-read-sidebar');
  if(!sb)return;

  // Cache
  var cKey='sent_'+lang+'_'+sentence.slice(0,30);
  if(_sentCache[cKey]){
    renderSentenceSidebar(sb, sentence, _sentCache[cKey], lang);
    return;
  }

  sb.innerHTML='<div style="font-size:13px;color:var(--dim2);display:flex;align-items:center;gap:8px">'
    +'<div style="width:14px;height:14px;border:2px solid var(--orange);border-top-color:transparent;border-radius:50%;animation:spin .7s linear infinite"></div>'
    +'Tłumaczę zdanie...</div>';

  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var langName={en:'English',es:'Spanish',nl:'Dutch',jp:'Japanese',de:'German',fr:'French'}[lang]||'English';
    var prompt='Translate this '+langName+' sentence to Polish. Return ONLY the Polish translation, nothing else.\nSentence: "'+sentence+'"';
    var res=await fetch(AI_PROXY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':APIKEY_CONST},
      body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:150})
    });
    var d=await res.json();
    var tr=(d&&d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts&&d.candidates[0].content.parts[0]?d.candidates[0].content.parts[0].text:'').trim().replace(/^["']|["']$/g,'');
    _sentCache[cKey]=tr;
    renderSentenceSidebar(sb, sentence, tr, lang);
  }catch(e){
    sb.innerHTML='<div style="font-size:12px;color:#c33">Błąd tłumaczenia — spróbuj ponownie</div>';
  }
}

function renderSentenceSidebar(sb, sentence, translation, lang){
  sb.innerHTML='';
  sb.dataset.lang=lang||'en';

  var h1=document.createElement('div');
  h1.style.cssText='font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--dim2);margin-bottom:10px';
  h1.textContent='📌 Wybrane zdanie';
  sb.appendChild(h1);

  var sq=document.createElement('div');
  sq.style.cssText='font-size:14px;color:var(--navy);line-height:1.6;margin-bottom:10px;font-style:italic;border-left:3px solid var(--orange);padding-left:10px';
  sq.textContent=sentence;
  sb.appendChild(sq);

  var audioBtn=document.createElement('button');
  audioBtn.style.cssText='width:100%;padding:8px 12px;border-radius:10px;border:1.5px solid var(--border);background:var(--paper2);font-size:12px;font-weight:600;color:var(--navy);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:12px;transition:.15s;font-family:"DM Sans",sans-serif';
  audioBtn.textContent='🔊 Odtwórz zdanie';
  audioBtn.onmouseover=function(){this.style.borderColor='var(--orange)';};
  audioBtn.onmouseout=function(){this.style.borderColor='var(--border)';};
  audioBtn.onclick=(function(s,l){return function(){playSentenceAudio(s,l);};})(sentence, lang);
  sb.appendChild(audioBtn);

  var h2=document.createElement('div');
  h2.style.cssText='font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--dim2);margin-bottom:6px';
  h2.textContent='🇵🇱 Tłumaczenie';
  sb.appendChild(h2);

  var trEl=document.createElement('div');
  trEl.style.cssText='font-size:15px;color:var(--orange);font-weight:600;line-height:1.5';
  trEl.textContent=translation;
  sb.appendChild(trEl);
}
// Odtwórz audio tylko jednego zdania (zatrzymuje główne TTS)
function playSentenceAudio(sentence, lang){
  if(typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();

  var btn=document.getElementById('sent-audio-btn');
  var sb=document.getElementById('dc-read-sidebar');
  if(!lang) lang=sb?sb.dataset.lang||'en':'en';
  var langCodes={en:'en-GB',es:'es-ES',nl:'nl-NL',jp:'ja-JP',de:'de-DE',fr:'fr-FR'};
  var langCode=langCodes[lang]||'en-GB';

  if(btn) btn.innerHTML='⏹️ Zatrzymaj';
  if(btn) btn.onclick=function(){speechSynthesis.cancel();if(btn){btn.innerHTML='🔊 Odtwórz zdanie';btn.onclick=function(){playSentenceAudio(sentence);};}};

  var voices=speechSynthesis.getVoices();
  var preferred=voices.find(function(v){return v.lang===langCode&&v.name.includes('Google');})
    ||voices.find(function(v){return v.lang===langCode;})
    ||voices.find(function(v){return v.lang.startsWith(lang);});

  var utt=new SpeechSynthesisUtterance(sentence);
  utt.lang=langCode;utt.rate=0.9;utt.pitch=1.0;
  if(preferred)utt.voice=preferred;
  utt.onend=function(){if(btn){btn.innerHTML='🔊 Odtwórz zdanie';btn.onclick=function(){playSentenceAudio(sentence);};} };
  utt.onerror=function(){if(btn){btn.innerHTML='🔊 Odtwórz zdanie';btn.onclick=function(){playSentenceAudio(sentence);};}};
  speechSynthesis.speak(utt);
}

// Tooltip hover na słowach
document.addEventListener('mouseover',function(e){
  var el=e.target;
  if(!el.classList||!el.classList.contains('hover-word'))return;
  var word=el.dataset.word;
  var lang=el.dataset.lang;
  if(!word||word.length<2)return;
  showWordTooltip(el, word, lang);
});
document.addEventListener('mouseout',function(e){
  if(e.target.classList&&e.target.classList.contains('hover-word')){
    _ttHideTimer=setTimeout(function(){
      var tt=document.getElementById('hover-tooltip');
      if(tt)tt.style.display='none';
    },400);
  }
});

var _ttCache={};
var _ttHideTimer=null;

async function showWordTooltip(el, word, lang){
  clearTimeout(_ttHideTimer);
  var tt=document.getElementById('hover-tooltip');
  if(!tt)return;
  var rect=el.getBoundingClientRect();
  tt.style.position='fixed';
  tt.style.display='block';
  // Position above the word, centered
  tt.style.left=Math.max(8,Math.min(rect.left+rect.width/2-60,window.innerWidth-200))+'px';
  tt.style.top=Math.max(8,rect.top-48)+'px';
  tt.style.minWidth='120px';
  tt.innerHTML='<span style="opacity:.5;font-size:11px">...</span>';

  var sentence='';
  try{var ps=el.closest('.sent');if(ps)sentence=ps.dataset.sentence||'';}catch(e){}
  var cKey=lang+'_'+word.toLowerCase()+'_'+sentence.slice(0,20);
  if(_ttCache[cKey]){tt.innerHTML=_ttCache[cKey];return;}

  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var langName={en:'English',es:'Spanish',nl:'Dutch',jp:'Japanese',de:'German',fr:'French'}[lang]||'English';
    var prompt='Translate the '+langName+' word "'+word+'" to Polish.'
      +(sentence?' Context: "'+sentence.slice(0,80)+'". Give the translation that fits this context.':'')
      +' Reply ONLY with the Polish translation, max 5 words, nothing else.';
    var res=await fetch(AI_PROXY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':APIKEY_CONST},
      body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:20})
    });
    var d=await res.json();
    var raw=d&&d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts&&d.candidates[0].content.parts[0]?d.candidates[0].content.parts[0].text:'';
    var tr=raw.trim().replace(/["""]/g,'');
    if(tr&&tt.style.display==='block'){
      var html='<strong style="font-size:13px">'+word+'</strong><br><span style="font-size:14px;color:#f5c842">'+tr+'</span>';
      _ttCache[cKey]=html;
      tt.innerHTML=html;
      // sidebar reserved for sentence clicks only — no hover update
    }
  }catch(e){
    tt.style.display='none';
  }
}

// Audio TTS - czytanie artykułu
function addArticleAudioBtn(text, lang){
  var existing=document.getElementById('dc-read-audio-wrap');
  if(existing)existing.remove();
  var wrap=document.createElement('div');
  wrap.id='dc-read-audio-wrap';
  wrap.style.cssText='display:flex;align-items:center;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)';

  var langCode={en:'en-GB',es:'es-ES',nl:'nl-NL',jp:'ja-JP'}[lang]||'en-GB';
  var isPlaying=false;
  var utt=null;
  var _stopped=false;

  var btn=document.createElement('button');
  btn.className='btn btn-navy';
  btn.style.cssText='font-size:13px;padding:8px 16px;display:flex;align-items:center;gap:6px';
  btn.innerHTML='🔊 Przeczytaj artykuł';

  var progress=document.createElement('div');
  progress.style.cssText='font-size:12px;color:var(--dim2)';

  btn.onclick=function(){
    if(isPlaying){
      _stopped=true;
      speechSynthesis.cancel();
      isPlaying=false;
      btn.innerHTML='🔊 Przeczytaj artykuł';
      progress.textContent='';
      return;
    }
    // Wybierz najlepszy głos
    var voices=speechSynthesis.getVoices();
    var preferred=voices.find(function(v){return v.lang===langCode&&v.name.includes('Google');})
      ||voices.find(function(v){return v.lang===langCode&&v.localService;})
      ||voices.find(function(v){return v.lang.startsWith(langCode.split('-')[0]);});

    // Podziel tekst na fragmenty (przeglądarka ma limit ~200 słów)
    var cleanText=text.replace(/<[^>]+>/g,'').replace(/&\w+;/g,' ');
    var chunks=cleanText.match(/[^.!?]+[.!?]+\s*/g)||[cleanText];
    var chunkIdx=0;
    _stopped=false;

    function speakNext(){
      if(_stopped){
        isPlaying=false;
        btn.innerHTML='🔊 Przeczytaj artykuł';
        progress.textContent='';
        return;
      }
      if(chunkIdx>=chunks.length){
        isPlaying=false;
        btn.innerHTML='🔊 Przeczytaj artykuł';
        progress.textContent='Ukończono ✓';
        return;
      }
      utt=new SpeechSynthesisUtterance(chunks[chunkIdx].trim());
      utt.lang=langCode;
      utt.rate=0.88;
      utt.pitch=1.0;
      if(preferred)utt.voice=preferred;
      utt.onend=function(){
        if(_stopped)return;
        chunkIdx++;
        progress.textContent=(chunkIdx)+'/'+chunks.length+' zdań';
        speakNext();
      };
      utt.onerror=function(){
        if(_stopped)return;
        chunkIdx++;
        speakNext();
      };
      speechSynthesis.speak(utt);
      chunkIdx++;
    }

    isPlaying=true;
    btn.innerHTML='⏹️ Zatrzymaj';
    progress.textContent='Czytam...';
    speechSynthesis.cancel();
    setTimeout(speakNext,100);
  };

  wrap.appendChild(btn);
  wrap.appendChild(progress);
  document.getElementById('dc-read-body').parentElement.appendChild(wrap);
}


async function loadDailyQuiz(){
  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var res=await fetch('https://sntlgkhktscezxpxrchl.supabase.co/functions/v1/generate-sentence',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':'sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8'},
      body:JSON.stringify({word:'quiz',translation:'quiz',lang:document.getElementById('daily-lang-select')?document.getElementById('daily-lang-select').value:'en',level:'B1',mode:'quiz'})
    });
    // fallback to hardcoded quiz
    throw new Error('use fallback');
  }catch(e){
    var qLang=document.getElementById('daily-lang-select')?document.getElementById('daily-lang-select').value:'en';
    // Sprawdź czy quiz już zrobiony dziś
    if(getQuizDoneToday()===qLang){
      // Old quiz DOM removed — use inline quiz panel
      _dailyDone.quiz=true;
      var dqdEl=document.getElementById('dc-quiz-done2');
      if(dqdEl) dqdEl.style.display='inline';
      var iqb=document.getElementById('dc-quiz-inline-body');
      if(iqb) iqb.innerHTML='<div style="text-align:center;padding:16px"><div style="font-size:32px;margin-bottom:8px">✅</div><div style="font-size:14px;font-weight:700;color:var(--navy)">Quiz ukończony!</div><div style="font-size:12px;color:var(--dim2)">Wróć jutro</div></div>';
      updateDailyProgress();
      return;
    }
    var allQuizzes={
      en:[
        {q:'Jak powiedzieć po angielsku: <em>"mieć ciarki"</em>?',opts:['to have goosebumps','to get chills','to feel shivers','to be frozen'],correct:1,explain:'"Get chills" to idiom oznaczający uczucie dreszczu z ekscytacji lub strachu.'},
        {q:'Co oznacza angielski idiom: <em>"break the ice"</em>?',opts:['złamać lód','przełamać pierwsze lody','zepsuć coś','ochłodzić sytuację'],correct:1,explain:'"Break the ice" oznacza przełamanie barier w nowym towarzystwie.'},
        {q:'Które słowo NIE jest synonimem słowa <em>"happy"</em>?',opts:['joyful','content','elated','gloomy'],correct:3,explain:'"Gloomy" oznacza przygnębiony — to antonym. Pozostałe są synonimami.'},
        {q:'Jak powiedzieć po angielsku: <em>"na dłuższą metę"</em>?',opts:['in the long run','for a long time','at long last','in the end'],correct:0,explain:'"In the long run" = w perspektywie długoterminowej.'}
      ],
      es:[
        {q:'Co oznacza hiszpański idiom: <em>"no hay mal que por bien no venga"</em>?',opts:['nie ma złego bez dobrego','nigdy nie wiadomo','każdy ma swój czas','lepiej późno niż wcale'],correct:0,explain:'Dosłownie "nie ma zła, z którego nie wynika dobro" — odpowiednik polskiego "nie ma złego co by na dobre nie wyszło".'},
        {q:'Jak powiedzieć po hiszpańsku <em>"tęsknię za tobą"</em>?',opts:['Te quiero','Te echo de menos','Me gustas','Te necesito'],correct:1,explain:'"Te echo de menos" to dosłownie "brakuje mi cię" — najczęstszy sposób wyrażenia tęsknoty w hiszpańskim.'},
        {q:'Które słowo oznacza <em>"szybko"</em> po hiszpańsku?',opts:['despacio','rápido','tarde','pronto'],correct:1,explain:'"Rápido" = szybko. "Despacio" = wolno, "tarde" = późno, "pronto" = wkrótce.'}
      ],
      nl:[
        {q:'Co oznacza holenderski idiom: <em>"nu komt de aap uit de mouw"</em>?',opts:['małpa uciekła','prawdziwe intencje wychodzą na jaw','coś nieoczekiwanego','zabawna sytuacja'],correct:1,explain:'Dosłownie "teraz małpa wychodzi z rękawa" — oznacza moment gdy ktoś zdradza swoje prawdziwe zamiary.'},
        {q:'Jak powiedzieć po holendersku <em>"dziękuję"</em>?',opts:['Alsjeblieft','Dank je wel','Goedemorgen','Tot ziens'],correct:1,explain:'"Dank je wel" = dziękuję (nieformalnie). "Dank u wel" to forma grzecznościowa.'}
      ],
      jp:[
        {q:'Co oznacza japońskie słowo <em>"木漏れ日" (komorebi)</em>?',opts:['wschód słońca','światło słońca przebijające przez liście','odbicie w wodzie','wieczorny zmierzch'],correct:1,explain:'"Komorebi" to unikalne japońskie słowo na grę światła słonecznego między liśćmi drzew. Nie ma odpowiednika w innych językach.'},
        {q:'Jak po japońsku wyrazić <em>"itadakimasu"</em>?',opts:['smacznego','dziękuję','przepraszam','do widzenia'],correct:0,explain:'"Itadakimasu" mówi się przed jedzeniem. Dosłownie "z pokorą otrzymuję" — wyraz wdzięczności za posiłek.'}
      ]
    };
    var quizzes=allQuizzes[qLang]||allQuizzes['en'];
    var qz=quizzes[Math.floor(Math.random()*quizzes.length)];
    window._currentQuiz={correct:qz.correct,explain:qz.explain};
    _quizAnswered=false;
    var box=document.getElementById('dc-quiz-inline-body');
    if(!box)return;
    // Build quiz using DOM — pytanie + opcje w jednym miejscu
    box.innerHTML='';
    box.style.cssText='display:flex;flex-direction:column;gap:8px';
    // Pytanie
    var qDiv=document.createElement('div');
    qDiv.style.cssText='font-size:13px;font-weight:600;color:var(--navy);padding:10px 12px;background:var(--paper2);border-radius:10px;border-left:3px solid var(--orange);line-height:1.5';
    qDiv.innerHTML=qz.q;
    box.appendChild(qDiv);
    // Opcje w gridzie 2x2
    var grid=document.createElement('div');
    grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:8px';
    qz.opts.forEach(function(o,i){
      var div=document.createElement('div');
      div.className='quiz-opt';
      div.dataset.idx=String(i);
      div.style.cssText='padding:10px 14px;border:1.5px solid var(--border);border-radius:10px;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px;transition:.15s;background:#fff';
      var letter=document.createElement('span');
      letter.style.cssText='width:22px;height:22px;border-radius:50%;border:1.5px solid var(--border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;color:var(--dim2)';
      letter.textContent=String.fromCharCode(65+i);
      div.appendChild(letter);
      div.appendChild(document.createTextNode(o));
      div.addEventListener('mouseenter',function(){if(!_quizAnswered)this.style.borderColor='var(--orange)';this.style.background='rgba(201,106,42,.05)';});
      div.addEventListener('mouseleave',function(){if(!_quizAnswered){this.style.borderColor='var(--border)';this.style.background='#fff';}});
      div.addEventListener('click',function(){quizAnswer(parseInt(this.dataset.idx),window._currentQuiz.correct,window._currentQuiz.explain,this);});
      grid.appendChild(div);
    });
    box.appendChild(grid);
    // Miejsce na wyjaśnienie
    var expl=document.createElement('div');
    expl.id='dc-quiz-explain-inline';
    expl.style.cssText='display:none;font-size:13px;color:var(--dim);line-height:1.6;padding:10px 12px;background:var(--paper2);border-radius:10px;margin-top:4px';
    box.appendChild(expl);
  }
}

function quizAnswer(idx, correct, explain, el){
  if(_quizAnswered)return;
  _quizAnswered=true;
  var opts=document.querySelectorAll('.quiz-opt');
  opts[correct].style.background='#e1f5ee';
  opts[correct].style.borderColor='#0f6e56';
  opts[correct].style.color='#085041';
  if(idx!==correct){
    el.style.background='#fcebeb';
    el.style.borderColor='#a32d2d';
    el.style.color='#501313';
  }
  var expl=document.getElementById('dc-quiz-explain-inline')||(document.getElementById('dc-quiz-explain')||{});
  expl.style.display='block';
  expl.innerHTML='<strong style="color:'+(idx===correct?'#16a34a':'#dc2626')+'">'+(idx===correct?'✅ Świetnie!':'❌ Nie tym razem')+'</strong> '+explain;
  if(!_dailyDone.quiz){
    _dailyDone.quiz=true;
    var qLangNow=document.getElementById('daily-lang-select')?document.getElementById('daily-lang-select').value:'en';
    setQuizDoneToday(qLangNow);
    addDailyXP(30);
    var _dqd=document.getElementById('dc-quiz-done2');if(_dqd)_dqd.style.display='inline';
    updateDailyProgress();
  }
}


function loadInlineQuiz(){
  var box=document.getElementById('dc-quiz-inline-body');
  if(!box)return;
  var w1El=document.getElementById('dc-word-text');
  var t1El=document.getElementById('dc-word-translation');
  var w2El=document.getElementById('dc-word-text2');
  var t2El=document.getElementById('dc-word-translation2');
  var w1=w1El&&w1El.textContent;
  var t1=t1El&&t1El.textContent;
  var w2=w2El&&w2El.textContent;
  var t2=t2El&&t2El.textContent;
  if(!w1||!t1){
    box.innerHTML='<div style="color:var(--dim2);font-size:13px;padding:12px;text-align:center">'
      +'<span style="font-size:24px;display:block;margin-bottom:8px">👆</span>'
      +'Kliknij "Zapamiętałem!" aby odblokować quiz</div>';
    return;
  }
  var words=[{w:w1,t:t1}];
  if(w2&&t2)words.push({w:w2,t:t2});
  _inlineQuizState={step:0,done:false,words:words};
  renderInlineQuizStep(0);
}

function renderInlineQuizStep(step){
  var box=document.getElementById('dc-quiz-inline-body');
  if(!box||_inlineQuizState.done)return;
  var words=_inlineQuizState.words.filter(function(x){return x.w&&x.t;});
  if(!words.length)return;
  if(step===0){
    var target=words[0];
    var otherT=words.slice(1).map(function(x){return x.t;});
    // Polish fallbacks (translation is always Polish in Eyelingo)
    var plFallbacks=['dom','czas','dobry','praca','życie','dzień','woda','ogień','ziemia','niebo','miłość','wiedzieć'];
    var fakes=otherT.concat(plFallbacks).filter(function(x){return x&&x.toLowerCase()!==target.t.toLowerCase();}).slice(0,3);
    var opts=[target.t].concat(fakes).sort(function(){return Math.random()-.5;});
    var html='<div style="font-size:12px;color:var(--dim2);margin-bottom:8px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Co znaczy:</div>'
      +'<div style="font-size:24px;font-weight:800;color:var(--navy);font-family:Syne,sans-serif;margin-bottom:14px;padding:10px;background:var(--paper2);border-radius:10px;text-align:center">'+target.w+'</div>'
      +'<div style="font-size:11px;color:var(--dim2);margin-bottom:8px">Wybierz poprawne tłumaczenie:</div>'
      +'<div style="display:flex;flex-direction:column;gap:6px" id="iq-opts">';
    opts.forEach(function(o){
      html+='<button style="padding:8px 14px;border-radius:10px;border:1.5px solid var(--border);background:var(--paper2);font-size:13px;cursor:pointer;text-align:left" onclick="checkInlineOpt(this,this.textContent)">'+o+'</button>';
    });
    html+='</div>';
    box.innerHTML=html;
  } else if(step===1&&words.length>=2){
    var target2=words[1];
    // DOM approach - no quote escaping issues
    box.innerHTML='';
    var lbl2=document.createElement('div');
    lbl2.style.cssText='font-size:12px;color:var(--dim2);margin-bottom:10px;font-weight:600';
    lbl2.textContent='Wpisz po angielsku:';
    box.appendChild(lbl2);
    var hint2=document.createElement('div');
    hint2.style.cssText='font-size:14px;color:var(--dim);margin-bottom:10px;font-style:italic';
    hint2.textContent='"'+target2.t+'"';
    box.appendChild(hint2);
    var row2=document.createElement('div');
    row2.style.cssText='display:flex;gap:6px';
    var inp2=document.createElement('input');
    inp2.id='iq-fill';inp2.type='text';inp2.placeholder='Odpowiedź...';
    inp2.style.cssText='flex:1;padding:8px 12px;border-radius:10px;border:1.5px solid var(--border);font-size:13px';
    (function(w){inp2.onkeydown=function(e){if(e.key==='Enter')checkInlineFill(w,1);};})(target2.w);
    var btn2=document.createElement('button');
    btn2.className='btn btn-orange';btn2.style.cssText='padding:8px 14px;font-size:13px';
    btn2.textContent='✓';
    (function(w){btn2.onclick=function(){checkInlineFill(w,1);};})(target2.w);
    row2.appendChild(inp2);row2.appendChild(btn2);
    box.appendChild(row2);
    setTimeout(function(){inp2.focus();},100);
  } else {
    _inlineQuizState.done=true;
    var doneEl=document.getElementById('dc-quiz-done2');
    if(doneEl)doneEl.style.display='inline';
    box.innerHTML='<div style="text-align:center;padding:16px"><div style="font-size:36px;margin-bottom:8px">🎉</div><div style="font-size:14px;font-weight:700;color:var(--navy)">Quiz ukończony!</div></div>';
    if(typeof addDailyXP==='function')addDailyXP(10);
  }
}

function checkInlineOpt(btn, chosen){
  chosen=chosen||btn.textContent||'';
  var target=_inlineQuizState.words[0];
  var isOk=chosen.trim().toLowerCase()===target.t.trim().toLowerCase();
  document.querySelectorAll('#iq-opts button').forEach(function(b){
    b.disabled=true;
    if(b.textContent.trim().toLowerCase()===target.t.trim().toLowerCase())b.style.cssText=b.style.cssText+'background:#dcfce7;border-color:#86efac';
    else if(b===btn&&!isOk)b.style.cssText=b.style.cssText+'background:#fee2e2;border-color:#fca5a5';
  });
  setTimeout(function(){renderInlineQuizStep(1);},800);
}

function checkInlineFill(correct,step){
  var inp=document.getElementById('iq-fill');
  if(!inp)return;
  var ok=inp.value.trim().toLowerCase()===correct.trim().toLowerCase();
  inp.style.borderColor=ok?'#86efac':'#fca5a5';
  inp.style.background=ok?'#dcfce7':'#fee2e2';
  setTimeout(function(){renderInlineQuizStep(step+1);},700);
}

function dailyWordDone(){
  if(_dailyDone.word)return;
  _dailyDone.word=true;
  addDailyXP(20);
  document.getElementById('dc-word-btn').textContent='✓ Dodano!';
  document.getElementById('dc-word-btn').disabled=true;
  document.getElementById('dc-word-done').style.display='inline';
  updateDailyProgress();
  // Aktywuj quiz inline obok słówek
  setTimeout(loadInlineQuiz, 300);
}

function dailyReadDone(){
  if(_dailyDone.read)return;
  _dailyDone.read=true;
  addDailyXP(25);
  document.getElementById('dc-read-btn').textContent='✓ Ukończone!';
  document.getElementById('dc-read-btn').disabled=true;
  document.getElementById('dc-read-done').style.display='inline';
  updateDailyProgress();
}

function addDailyXP(xp){
  _dailyXP+=xp;
  document.getElementById('daily-xp').textContent=_dailyXP+' XP';
}

function updateDailyProgress(){
  var done=Object.values(_dailyDone).filter(Boolean).length;
  var total=Object.keys(_dailyDone).length;
  document.getElementById('daily-progress-label').textContent=done+' z '+total+' aktywności ukończone';
  document.getElementById('daily-progress-bar').style.width=Math.round(done/total*100)+'%';
}

// ═══════════════════════════════════════
// WYZWANIE TYGODNIA
// ═══════════════════════════════════════
var _challengeTimer=null;

var _challengeSetCache = null;

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

// ═══════════════════════════════════════
// AI CONVERSATION PARTNER
// ═══════════════════════════════════════
var _chatHistory=[];
var _chatLang='en';
var _chatPersonas={
  en:{name:'Alex',desc:'Native speaker · New York',greeting:"Hey! I'm Alex. Let's have a conversation in English. What would you like to talk about today?"},
  es:{name:'Sofía',desc:'Hablante nativa · Madrid',greeting:'¡Hola! Soy Sofía. Vamos a practicar el español juntos. ¿De qué quieres hablar?'},
  nl:{name:'Daan',desc:'Moedertaalspreker · Amsterdam',greeting:'Hallo! Ik ben Daan. Laten we Nederlands oefenen. Waar wil je het over hebben?'},
  jp:{name:'Yuki',desc:'ネイティブスピーカー · 東京',greeting:'こんにちは！ゆきです。一緒に日本語を練習しましょう。何について話したいですか？'}
};

function chatUpdatePersona(){
  _chatLang=document.getElementById('chat-lang').value;
  var p=_chatPersonas[_chatLang]||_chatPersonas['en'];
  document.getElementById('chat-persona-name').textContent=p.name;
  document.getElementById('chat-persona-desc').textContent=p.desc;
  var langTag={en:'EN · B1→B2',es:'ES · A2→B1',nl:'NL · A1→A2',jp:'JP · N5→N4'}[_chatLang]||'EN';
  document.getElementById('chat-persona-tags').innerHTML=
    '<span style="font-size:11px;padding:3px 10px;border-radius:20px;background:#e6f1fb;color:#0c447c;font-weight:600">'+langTag+'</span>';
  var langPlaceholder={en:'Napisz po angielsku...',es:'Escribe en español...',nl:'Schrijf in het Nederlands...',jp:'日本語で書いてください...'};
  var inp=document.getElementById('chat-input');
  if(inp) inp.placeholder=langPlaceholder[_chatLang]||'Napisz...';
  // Przeładuj słabe słowa dla nowego języka
  loadChatWeakWords();
  // Reset rozmowy przy zmianie języka
  chatReset();
}

async function initChat(){
  chatUpdatePersona();
  await loadChatWeakWords();
  if(!_chatHistory.length) chatReset();
  updateChatLimitUI();
}

async function loadChatWeakWords(){
  var lang=document.getElementById('chat-lang')?document.getElementById('chat-lang').value:'en';
  var words=[];
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){renderWeakWords([]);return;}
    // Najpierw word_progress filtrowany po języku
    try{
      var{data:wp}=await db.from('word_progress')
        .select('ease_factor,flashcards(word,languages(code))')
        .eq('user_id',sess.user.id)
        .order('ease_factor',{ascending:true})
        .limit(30);
      if(wp&&wp.length){
        var filtered=wp.filter(function(r){
          return r.flashcards&&r.flashcards.word&&r.flashcards.languages&&r.flashcards.languages.code===lang;
        });
        var pool=filtered.length?filtered:wp.filter(function(r){return r.flashcards&&r.flashcards.word;});
        words=pool.slice(0,8).map(function(r){return r.flashcards.word;});
      }
    }catch(e){}
    // Fallback - zestawy webowe
    if(!words.length){
      var{data:sets2}=await db.from('user_sets').select('user_set_cards(word)').eq('user_id',sess.user.id).limit(5);
      var allW=[];
      if(sets2)sets2.forEach(function(s){if(s.user_set_cards)allW=allW.concat(s.user_set_cards);});
      words=allW.slice(0,8).map(function(c){return c.word;});
    }
  }catch(e){}
  renderWeakWords(words, lang);
}

function renderWeakWords(words, lang){
  var el=document.getElementById('chat-weak-words');
  var label=document.getElementById('chat-weak-label');
  if(!el)return;
  var langNames={en:'angielski',es:'hiszpański',nl:'holenderski',jp:'japoński'};
  if(label) label.textContent='Partner użyje tych słów ('+(langNames[lang]||lang)+')';
  if(words.length){
    el.innerHTML=words.map(function(w){
      return'<span style="display:inline-block;padding:2px 8px;border-radius:6px;background:var(--paper2);border:1px solid var(--border);font-size:12px;color:var(--navy)">'+w+'</span>';
    }).join('');
  } else {
    el.innerHTML='<span style="font-size:12px;color:var(--dim2)">Ucz się więcej aby personalizować rozmowę</span>';
  }
}
var _chatLevel='beginner';

function setChatLevel(level, el){
  _chatLevel=level;
  // Update UI
  ['beginner','intermediate','advanced'].forEach(function(l){
    var btn=document.getElementById('lvl-'+l);
    if(!btn)return;
    if(l===level){
      btn.style.borderColor='var(--orange)';
      btn.style.background='#faeeda';
      btn.style.color='var(--orange)';
    } else {
      btn.style.borderColor='var(--border2)';
      btn.style.background='transparent';
      btn.style.color='var(--dim2)';
    }
  });
  // Dla zaawansowanych - auto-włącz tryb odwagi
  if(level==='advanced'){
    var brave=document.querySelector('input[name="chat-mode"][value="brave"]');
    if(brave) brave.checked=true;
  } else if(level==='beginner'){
    var hints=document.querySelector('input[name="chat-mode"][value="hints"]');
    if(hints) hints.checked=true;
  }
}

function chatReset(){
  _chatHistory=[];
  var msgs=document.getElementById('chat-messages');
  msgs.innerHTML='';
  var p=_chatPersonas[_chatLang]||_chatPersonas['en'];
  _chatHistory.push({role:'assistant',content:p.greeting});
  appendChatMsg('ai',p.greeting);
  showChatHints();
}

function appendChatMsg(who, text, info){
  var msgs=document.getElementById('chat-messages');
  if(info){
    var d=document.createElement('div');
    d.className='chat-info';
    d.textContent=info;
    msgs.appendChild(d);
  }
  var d=document.createElement('div');
  d.className=who==='user'?'chat-msg-user':'chat-msg-ai';
  d.style.cssText='max-width:75%;align-self:'+(who==='user'?'flex-end':'flex-start');
  d.innerHTML=text.replace(/\*\*(.*?)\*\*/g,'<strong style="color:'+(who==='user'?'#f5c842':'var(--orange)')+'">$1</strong>');
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
}

function showChatHints(){
  var hintsWrap=document.getElementById('chat-hints-wrap');
  var mode=document.querySelector('input[name="chat-mode"]:checked')?.value||'hints';
  if(mode==='brave'){hintsWrap.innerHTML='';return;}
  var hints={
    en:['Tell me more about that','I totally agree with you','That\'s an interesting point','Actually, I think...'],
    es:['Cuéntame más sobre eso','Totalmente de acuerdo','Es un punto interesante','En realidad, creo que...'],
    nl:['Vertel me daar meer over','Ik ben het ermee eens','Dat is een interessant punt','Eigenlijk denk ik dat...'],
    jp:['もっと教えてください','そうですね','面白い考えですね','実は、私は...']
  };
  var arr=hints[_chatLang]||hints['en'];
  hintsWrap.innerHTML=arr.map(function(h){
    return '<span class="chat-hint" onclick="chatUseHint(\''+h.replace(/'/g,"\\'")+'\')">'+(h.length>30?h.slice(0,28)+'…':h)+'</span>';
  }).join('');
}

function chatUseHint(text){
  document.getElementById('chat-input').value=text;
  document.getElementById('chat-input').focus();
}


function getChatUsageToday(){
  try{
    var key='chat_usage_'+new Date().toISOString().slice(0,10);
    return parseInt(localStorage.getItem(key)||'0');
  }catch(e){return 0;}
}

function incrementChatUsage(){
  try{
    var key='chat_usage_'+new Date().toISOString().slice(0,10);
    var n=getChatUsageToday()+1;
    localStorage.setItem(key,String(n));
    return n;
  }catch(e){return 1;}
}

function updateChatLimitUI(){
  var used=getChatUsageToday();
  var left=Math.max(0,CHAT_DAILY_LIMIT-used);
  var el=document.getElementById('chat-limit-info');
  if(el){
    el.textContent=left>0?(left+' wiadomości pozostało dziś'):'Limit dzienny wyczerpany';
    el.style.color=left<=3?'#c96a2a':left===0?'#dc2626':'var(--dim2)';
  }
}

async function chatSend(){
  var input=document.getElementById('chat-input');
  var text=input.value.trim();
  if(!text)return;
  if(getChatUsageToday()>=CHAT_DAILY_LIMIT){
    appendChatMsg('ai','Osiągnąłeś dzienny limit '+CHAT_DAILY_LIMIT+' wiadomości. Wróć jutro lub odblokuj premium! 🌟');
    return;
  }
  var btn=document.getElementById('chat-send-btn');
  btn.disabled=true; input.value='';

  appendChatMsg('user',text);
  _chatHistory.push({role:'user',content:text});

  // Typing indicator
  var typing=document.createElement('div');
  typing.className='chat-msg-ai';
  typing.style.cssText='max-width:75%;align-self:flex-start;color:var(--dim2);font-size:13px';
  typing.textContent='pisze...';
  document.getElementById('chat-messages').appendChild(typing);
  document.getElementById('chat-messages').scrollTop=99999;

  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';

    // Pobierz słabe słowa usera
    var weakWords=[];
    if(sess){
      try{
        try{
          var {data:wp2}=await db.from('word_progress')
            .select('flashcard_id,ease_factor,flashcards(word)')
            .eq('user_id',sess.user.id)
            .order('ease_factor',{ascending:true})
            .limit(5);
          if(wp2&&wp2.length) weakWords=wp2.filter(function(r){return r.flashcards&&r.flashcards.word;}).map(function(r){return r.flashcards.word;});
        }catch(e){}
        if(!weakWords.length){
          try{
            var {data:sets3}=await db.from('user_sets').select('user_set_cards(word)').eq('user_id',sess.user.id).limit(3);
            var allW3=[];if(sets3)sets3.forEach(function(s){if(s.user_set_cards)allW3=allW3.concat(s.user_set_cards);});
            weakWords=allW3.slice(0,5).map(function(c){return c.word;});
          }catch(e){}
        }
      }catch(e){}
    }

    var mode=document.querySelector('input[name="chat-mode"]:checked')?.value||'hints';
    var topic=document.getElementById('chat-topic').value;
    var p=_chatPersonas[_chatLang]||_chatPersonas['en'];
    var langNames={en:'English',es:'Spanish',nl:'Dutch',jp:'Japanese'};
    var topicNames={daily:'everyday life',travel:'travel and trips',work:'work and career',tech:'technology and gadgets',movies:'movies and TV series',music:'music and artists',games:'video games',anime:'anime and manga',sport:'sports',food:'cooking and food',fashion:'fashion and style',science:'science and discoveries',nature:'environment and nature',relationships:'relationships and feelings',health:'health and fitness',history:'history',culture:'culture and traditions',money:'money and finance',art:'art and creativity',free:'any topic'};
    var levelInstructions={
      beginner:'Use very simple vocabulary (A1-A2 level). Short sentences max 10 words. Speak slowly and clearly. If user makes a mistake, gently correct them in a friendly way. Add Polish translations in parentheses for difficult words.',
      intermediate:'Use natural B1-B2 vocabulary. Normal sentence length. Occasionally use idioms and explain them. Correct major errors only.',
      advanced:'Use sophisticated C1 vocabulary, idioms, complex structures. Challenge the user. Correct errors naturally within your response. No Polish unless absolutely necessary.'
    };

    var levelInst=levelInstructions[_chatLevel]||levelInstructions['intermediate'];
    var systemPrompt='You are '+p.name+', a friendly native '+langNames[_chatLang]+' speaker from '+p.desc.split('·')[1].trim()+'. '
      +'You are having a conversation about '+topicNames[topic]+'. '
      +'LEVEL: '+levelInst+' '
      +(weakWords.length?'Naturally weave these words into your responses when possible (the user is learning them): '+weakWords.join(', ')+'. When you use one, bold it like **word**. ':'' )
      +(mode==='brave'?'Respond ONLY in '+langNames[_chatLang]+'. Do not use Polish at all. If the user writes in Polish, gently ask them to try in '+langNames[_chatLang]+'.':'Respond in '+langNames[_chatLang]+'. ')
      +' Keep responses conversational, 2-4 sentences. Be warm and encouraging.';

    var tok2=(await db.auth.getSession()).data.session?.access_token||'';
    var res=await fetch(AI_PROXY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok2,'apikey':APIKEY_CONST},
      body:JSON.stringify({
        systemPrompt:systemPrompt,
        messages:_chatHistory.slice(-10),
        max_tokens:400
      })
    });
    var data=await res.json();
    // Gemini response format
    var reply=data?.candidates?.[0]?.content?.parts?.[0]?.text||'Sorry, something went wrong. Try again!';
    _chatHistory.push({role:'assistant',content:reply});
    typing.remove();
    appendChatMsg('ai',reply);
    incrementChatUsage();
    updateChatLimitUI();
    showChatHints();
  }catch(e){
    typing.remove();
    console.error('[AI Partner]',e);
    var errMsg='Błąd połączenia z AI. ';
    if(e.message&&e.message.includes('CORS')) errMsg+='Problem z CORS - sprawdz czy funkcja ai-proxy jest wdrozona i ma wylaczony JWT.';
    else if(e.message&&e.message.includes('fetch')) errMsg+='Nie można połączyć z serwerem.';
    else errMsg+=e.message||'Spróbuj ponownie.';
    appendChatMsg('ai',errMsg);
  }
  btn.disabled=false;
}

// ═══════════════════════════════════════
// ANALIZA LYRICS
// ═══════════════════════════════════════
var _lyricsWords=[];

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

var _lyricsAllLines = [];

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