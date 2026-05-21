// Eyelingo — AI Partner konwersacyjny
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
