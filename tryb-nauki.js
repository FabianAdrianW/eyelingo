// Eyelingo — Tryb nauki SM-2
var RewardSystem={
  _key:'tryb_nauki_v1',
  _state:null,
  load:function(){
    try{this._state=JSON.parse(localStorage.getItem(this._key)||'null');}catch(e){}
    if(!this._state)this._state={xp:0,level:1,streak:0,lastStudyDate:'',streakFreezes:2,totalCards:0,totalSessions:0,badges:{},perfectStreak:0,etymologyUses:0,weeklyXP:0,weekDate:''};
    return this._state;
  },
  save:function(){localStorage.setItem(this._key,JSON.stringify(this._state));},
  addXP:function(amount){this._state.xp+=amount;this._state.weeklyXP=(this._state.weeklyXP||0)+amount;this._state.level=Math.min(20,Math.floor(this._state.xp/100)+1);this.save();updateXPBar();},
  getStreak:function(){return this._state.streak||0;},
  updateStreak:function(){
    var today=new Date().toISOString().slice(0,10);
    var last=this._state.lastStudyDate;
    if(last===today)return;
    var yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    if(last===yesterday){this._state.streak++;}
    else if(last&&last!==yesterday){if(this._state.streakFreezes>0)this._state.streakFreezes--;else this._state.streak=1;}
    else{this._state.streak=Math.max(1,(this._state.streak||0)+1);}
    this._state.lastStudyDate=today;this.save();
  },
  checkMilestones:function(sd){
    var earned=[];var s=this._state;
    var defs=[
      {id:'first',icon:'🌱',name:'Pierwszy krok',desc:'Ukończ pierwszą sesję',check:function(){return s.totalSessions>=1;}},
      {id:'streak7',icon:'🔥',name:'Tydzień ognia',desc:'7-dniowy streak',check:function(){return s.streak>=7;}},
      {id:'perfect10',icon:'💯',name:'Perfekcjonista',desc:'10 kart z rzędu z oceną 4',check:function(){return s.perfectStreak>=10;}},
      {id:'speed',icon:'⚡',name:'Błyskawica',desc:'10 kart w < 2 minuty',check:function(){return sd&&sd.cards>=10&&sd.time<120;}}
    ];
    defs.forEach(function(d){if(!s.badges[d.id]&&d.check()){s.badges[d.id]={earned:true,date:new Date().toISOString()};earned.push(d);}});
    this.save();return earned;
  },
  getBadgeDefs:function(){return[
    {id:'first',icon:'🌱',name:'Pierwszy krok',desc:'Ukończ pierwszą sesję'},
    {id:'streak7',icon:'🔥',name:'Tydzień ognia',desc:'7-dniowy streak'},
    {id:'perfect10',icon:'💯',name:'Perfekcjonista',desc:'10 kart z rzędu ocena 4'},
    {id:'speed',icon:'⚡',name:'Błyskawica',desc:'10 kart w < 2 min'}
  ];}
};


function sm2Local(card,quality){
  var ef=card.ease_factor||2.5,reps=card.repetitions||0,interval=card.interval_days||1;
  if(quality>=3){if(reps===0)interval=1;else if(reps===1)interval=3;else interval=Math.round(interval*ef);reps++;}
  else{reps=0;interval=1;}
  ef=ef+(0.1-(5-quality)*(0.08+(5-quality)*0.02));if(ef<1.3)ef=1.3;
  return{ease_factor:parseFloat(ef.toFixed(3)),repetitions:reps,interval_days:interval,next_review:new Date(Date.now()+interval*86400000).toISOString().slice(0,10)};
}

async function initTrybNauki(){
  RewardSystem.load();
  _trybExternalCards=null;
  showTrybView('lobby');
  updateXPBar();updateStreakBadge();renderTrybBadges();
  await loadTrybStats();
}

function startTrybNauki(cardsRaw,setName){
  try{var c=typeof cardsRaw==='string'?JSON.parse(cardsRaw.replace(/&quot;/g,'"')):cardsRaw;_trybExternalCards=c;_trybExternalName=typeof setName==='string'?setName.replace(/&quot;/g,'"'):setName;}
  catch(e){_trybExternalCards=null;}
  RewardSystem.load();showPage('tryb');setTimeout(function(){startSession('set_external');},150);
}

function showTrybView(v){
  var lobby=document.getElementById('tryb-lobby');
  var session=document.getElementById('tryb-session');
  var summary=document.getElementById('tryb-summary');
  if(lobby)lobby.style.display=v==='lobby'?'block':'none';
  if(session)session.style.display=v==='session'?'block':'none';
  if(summary)summary.style.display=v==='summary'?'block':'none';
}

async function loadTrybStats(){
  try{
    var sess=(await db.auth.getSession()).data.session;if(!sess)return;
    var {data:due}=await db.rpc('get_due_cards_all',{p_lang:'en',p_limit:200});
    var el=document.getElementById('tryb-due-count');if(el)el.textContent=due?due.length:'0';
  }catch(e){}
}

async function startSession(mode){
  showTrybView('session');
  _trybSessionStats={correct:0,total:0,xpGained:0,startTime:Date.now()};
  _trybIdx=0;_trybPerfectStreak=0;_trybSessionXPToday=0;
  _trybChallengeMode=document.getElementById('tryb-challenge-toggle')&&document.getElementById('tryb-challenge-toggle').checked;
  var hdr=document.getElementById('tryb-session-header');
  if(hdr)hdr.textContent=_trybChallengeMode?'🔀 Tryb Wyzwania aktywny':'Sesja nauki';
  if(mode==='set_external'&&_trybExternalCards){
    _trybSetCards=_trybExternalCards.slice();
    _trybCards=shuffleArr(_trybExternalCards.slice()).map(function(c){return{word:c.word||c.front||'',translation:c.translation||c.back||'',emoji:'',example:'',etymology:'',ease_factor:2.5,repetitions:0,interval_days:1,id:null};});
    if(hdr)hdr.textContent=(_trybExternalName||'Zestaw')+(_trybChallengeMode?' · 🔀':'');
  }else{
    _trybCards=await loadDueCardsForTryb();_trybSetCards=_trybCards.slice();
  }
  if(_trybChallengeMode){var hard=_trybCards.filter(function(c){return(c.ease_factor||2.5)<1.8;});_trybCards=shuffleArr(_trybCards.concat(hard));}
  if(!_trybCards.length){showTrybView('lobby');if(typeof showToast==='function')showToast('Brak słów do nauki — wybierz zestaw!','success');return;}
  var tot=document.getElementById('tryb-card-total');if(tot)tot.textContent=_trybCards.length;
  loadTrybCard();
}

function shuffleArr(arr){for(var i=arr.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}

async function loadDueCardsForTryb(){
  try{
    var sess=(await db.auth.getSession()).data.session;if(!sess)return[];
    var {data}=await db.rpc('get_due_cards_all',{p_lang:'en',p_limit:50});
    if(!data||!data.length)return[];
    return data.map(function(d){return{id:d.flashcard_id||d.id,word:d.word||d.front||'',translation:d.translation||d.back||'',emoji:d.emoji||'',example:d.example_sentence||d.example||'',etymology:d.etymology||'',ease_factor:d.ease_factor||2.5,repetitions:d.repetitions||0,interval_days:d.interval_days||1};});
  }catch(e){return[];}
}

function loadTrybCard(){
  var card=_trybCards[_trybIdx];
  if(!card){showTrybSessionSummary();return;}
  _trybHintLevel=0;_trybHintPenalty=0;
  var qs=document.getElementById('tryb-q-side');
  var as=document.getElementById('tryb-a-side');
  var inp=document.getElementById('tryb-answer-input');
  var ht=document.getElementById('tryb-hint-text');
  var hl=document.getElementById('tryb-hint-level');
  var fb=document.getElementById('tryb-feedback');
  if(qs){qs.style.display='flex';qs.style.flexDirection='column';qs.style.alignItems='center';}
  if(as)as.style.display='none';
  if(inp)inp.value='';
  if(ht)ht.textContent='';
  if(hl)hl.textContent='3';
  if(fb)fb.style.opacity='0';
  var emoji=document.getElementById('tryb-card-emoji');
  var word=document.getElementById('tryb-card-word');
  var example=document.getElementById('tryb-card-example');
  var etWrap=document.getElementById('tryb-etymology-wrap');
  if(emoji)emoji.textContent=card.emoji||'📝';
  if(word)word.textContent=card.word||'';
  if(example)example.textContent=card.example?'"'+card.example+'"':'';
  if(etWrap)etWrap.style.display=card.etymology?'block':'none';
  var num=document.getElementById('tryb-card-num');
  var prog=document.getElementById('tryb-progress-bar');
  var done=document.getElementById('tryb-session-done');
  if(num)num.textContent=_trybIdx+1;
  var pct=Math.round(_trybIdx/_trybCards.length*100);
  if(prog)prog.style.width=pct+'%';
  if(done)done.textContent=_trybIdx;
  var mnKey='mnem_'+encodeURIComponent(card.word||'');
  var mn=document.getElementById('tryb-mnemonic-input');
  if(mn)mn.value=localStorage.getItem(mnKey)||'';
  var storyBtn=document.getElementById('tryb-story-btn');
  var storyBox=document.getElementById('tryb-story-box');
  if(storyBtn)storyBtn.style.display=_trybSetCards.length>=5?'inline-block':'none';
  if(storyBox)storyBox.style.display='none';
  setTimeout(function(){var i=document.getElementById('tryb-answer-input');if(i)i.focus();},100);
}

function levenshteinDist(a,b){
  var m=a.length,n=b.length,dp=[];
  for(var i=0;i<=m;i++){dp[i]=[i];for(var j=1;j<=n;j++)dp[i][j]=i===0?j:0;}
  for(var i=1;i<=m;i++)for(var j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

function checkAnswer(){
  var card=_trybCards[_trybIdx];if(!card)return;
  var userAns=(document.getElementById('tryb-answer-input').value||'').trim().toLowerCase();
  var correct=(card.translation||'').trim().toLowerCase();
  function norm(s){return s.replace(/[(),.!?]/g,' ').replace(/\s+/g,' ').trim();}
  var userN=norm(userAns),correctN=norm(correct);
  var alts=correctN.split(/[\/,]| lub /).map(function(a){return a.trim();});
  var isCorrect=alts.some(function(a){return userN===a||userN.includes(a)||a.includes(userN);});
  var isTypo=false;
  if(!isCorrect&&userAns.length>0){var best=alts.reduce(function(min,a){return Math.min(min,levenshteinDist(userN,a));},Infinity);isTypo=best<=2&&best<correctN.length*0.3;if(isTypo)isCorrect=true;}
  revealTrybAnswer(userAns,isCorrect,isTypo);
}

function dontKnow(){revealTrybAnswer('',false,false);}

function revealTrybAnswer(userAns,isCorrect,isTypo){
  var card=_trybCards[_trybIdx];
  _trybSessionStats.total++;if(isCorrect)_trybSessionStats.correct++;
  var fb=document.getElementById('tryb-feedback');
  if(fb){fb.textContent=isCorrect?(isTypo?'⚠️':'✅'):'❌';fb.style.animation='none';fb.offsetHeight;fb.style.animation='feedbackPop .6s ease forwards';}
  var qs=document.getElementById('tryb-q-side');var as=document.getElementById('tryb-a-side');
  if(qs)qs.style.display='none';
  if(as){as.style.display='flex';as.style.flexDirection='column';as.style.alignItems='center';}
  var wordAns=document.getElementById('tryb-card-word-ans');var cardAns=document.getElementById('tryb-card-answer');
  var resIcon=document.getElementById('tryb-result-icon');var userWrote=document.getElementById('tryb-user-wrote');
  var etText=document.getElementById('tryb-etymology-text');
  if(wordAns)wordAns.textContent=card.word||'';
  if(cardAns)cardAns.textContent=card.translation||'';
  if(resIcon)resIcon.textContent=isCorrect?(isTypo?'⚠️ Literówka':'✅'):'❌';
  if(userWrote)userWrote.textContent=!userAns?'Nie wpisałeś odpowiedzi':isTypo?'Twoja odpowiedź: "'+userAns+'" — literówka, ale zaliczam!':!isCorrect?'Twoja odpowiedź: "'+userAns+'"':'';
  if(etText&&card.etymology)etText.textContent=card.etymology;
  if(isTypo){document.querySelectorAll('.tryb-rate-btn').forEach(function(b){if(parseInt(b.dataset.q)>3)b.style.opacity='0.5';});}
}

async function rateCard(btnRating){
  var card=_trybCards[_trybIdx];if(!card)return;
  var isTypo=document.getElementById('tryb-result-icon')&&document.getElementById('tryb-result-icon').textContent.includes('⚠️');
  var eff=isTypo?Math.min(btnRating,3):btnRating;
  var qMap={1:0,2:2,3:4,4:5};
  var quality=Math.max(0,(qMap[eff]||0)-_trybHintPenalty);
  var newSRS=sm2Local(card,quality);
  await saveTrybSRS(card,newSRS);
  var xpTable={1:0,2:3,3:7,4:10};
  var xp=xpTable[eff]||0;
  if(_trybChallengeMode)xp=Math.round(xp*1.25);
  if((card.ease_factor||2.5)<1.8)xp*=2;
  _trybSessionStats.xpGained+=xp;_trybSessionXPToday+=xp;
  if(eff===4)_trybPerfectStreak++;else _trybPerfectStreak=0;
  RewardSystem._state.perfectStreak=Math.max(RewardSystem._state.perfectStreak,_trybPerfectStreak);
  var xpTodayEl=document.getElementById('tryb-xp-today');
  if(xpTodayEl)xpTodayEl.textContent=_trybSessionXPToday;
  _trybIdx++;loadTrybCard();
}

async function saveTrybSRS(card,newSRS){
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess||!card.id)return;
    await db.from('word_progress').upsert({user_id:sess.user.id,flashcard_id:card.id,ease_factor:newSRS.ease_factor,repetitions:newSRS.repetitions,interval_days:newSRS.interval_days,next_review:newSRS.next_review},{onConflict:'user_id,flashcard_id'});
  }catch(e){}
}

function showTrybHint(){
  var card=_trybCards[_trybIdx];if(!card)return;
  var ans=card.translation||'';_trybHintLevel++;_trybHintPenalty=Math.min(3,_trybHintLevel);
  var hintText='';
  if(_trybHintLevel===1)hintText='📏 Liczba liter: '+ans.replace(/ /g,'_').length;
  else if(_trybHintLevel===2)hintText='🔤 Pierwsza litera: '+ans[0].toUpperCase()+'...';
  else hintText='💡 Pierwsze litery: '+ans.slice(0,Math.ceil(ans.length/3))+'...';
  var ht=document.getElementById('tryb-hint-text');var hl=document.getElementById('tryb-hint-level');
  if(ht)ht.textContent=hintText;if(hl)hl.textContent=Math.max(0,3-_trybHintLevel);
  if(_trybHintLevel>=3){var hb=document.getElementById('tryb-hint-btn');if(hb)hb.disabled=true;}
  document.querySelectorAll('.tryb-rate-btn').forEach(function(b){var max=Math.max(1,4-_trybHintPenalty);b.style.opacity=parseInt(b.dataset.q)>max?'0.45':'1';});
}

function saveTrybMnemonic(){
  var card=_trybCards[_trybIdx];if(!card)return;
  var val=(document.getElementById('tryb-mnemonic-input')||{}).value||'';
  localStorage.setItem('mnem_'+encodeURIComponent(card.word||''),val);
}

function showTrybMiniStory(){
  var box=document.getElementById('tryb-story-box');if(!box)return;
  if(box.style.display==='block'){box.style.display='none';return;}
  // Generate AI mini-story using current word in context
  var currentCard=_trybCards[_trybIdx];
  if(!currentCard){box.style.display='none';return;}
  box.innerHTML='<div style="color:var(--dim2);font-size:12px">⏳ Generuję historyjkę...</div>';
  box.style.display='block';
  db.auth.getSession().then(function(r){
    var tok=r.data.session?r.data.session.access_token:'';
    var w=currentCard.word||'';
    var t=currentCard.translation||'';
    var prompt='Write a short story (3-4 sentences) in English that naturally uses the word "'+w+'" (meaning: "'+t+'"). '
      +'Bold the target word every time it appears like **'+w+'**. '
      +'Make the story interesting and the meaning of the word clear from context. '
      +'Then add a Polish translation of the story in italics on a new line.';
    fetch(AI_PROXY_URL,{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':APIKEY_CONST},
      body:JSON.stringify({messages:[{role:'user',content:prompt}],max_tokens:300})
    }).then(function(res){return res.json();}).then(function(d){
      var text=(d&&d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts&&d.candidates[0].content.parts[0]?d.candidates[0].content.parts[0].text:'').trim();
      if(!text){box.style.display='none';return;}
      // Format: bold **word** and italics for Polish
      var html=text.replace(/\*\*([^*]+)\*\*/g,'<strong style="color:var(--gold)">$1</strong>').replace(/
/g,'<br>');
      box.innerHTML='<div style="font-size:13px;line-height:1.7;color:rgba(255,255,255,.9)">📖 '+html+'</div>';
    }).catch(function(){box.style.display='none';});
  });
  box.style.display='block';
}

function endSession(){
  if(_trybSessionStats.total>0)showTrybSessionSummary();
  else showTrybView('lobby');
}

async function showTrybSessionSummary(){
  showTrybView('summary');
  var stats=_trybSessionStats;
  var timeS=Math.round((Date.now()-stats.startTime)/1000);
  var pct=stats.total>0?Math.round(stats.correct/stats.total*100):0;
  var sc=document.getElementById('sum-cards');var sp=document.getElementById('sum-pct');var sx=document.getElementById('sum-xp');
  if(sc)sc.textContent=stats.total;if(sp)sp.textContent=pct+'%';if(sx)sx.textContent=stats.xpGained;
  RewardSystem.load();
  RewardSystem._state.totalCards+=stats.total;RewardSystem._state.totalSessions++;
  RewardSystem.updateStreak();RewardSystem.addXP(stats.xpGained);
  var newBadges=RewardSystem.checkMilestones({cards:stats.total,time:timeS});
  RewardSystem.save();
  var nba=document.getElementById('tryb-new-badge-announce');
  if(nba){if(newBadges.length){var b=newBadges[0];nba.style.display='block';var nbi=document.getElementById('tryb-new-badge-icon');var nbn=document.getElementById('tryb-new-badge-name');var nbd=document.getElementById('tryb-new-badge-desc');if(nbi)nbi.textContent=b.icon;if(nbn)nbn.textContent=b.name;if(nbd)nbd.textContent=b.desc;fireConfetti();}else{nba.style.display='none';}}
  var icon=pct>=80?'🎉':pct>=50?'👍':'💪';
  var si=document.getElementById('tryb-summary-icon');var ss=document.getElementById('tryb-summary-sub');
  if(si)si.textContent=icon;if(ss)ss.textContent=pct>=80?'Niesamowita sesja!':pct>=50?'Niezłe, ćwicz dalej!':'Trudne słowa — wróć do nich jutro!';
  updateXPBar();updateStreakBadge();
  // Gold bonus
  if(stats.xpGained>0){var lvl=RewardSystem._state.level||1;var goldBonus=Math.round(stats.xpGained*(1+lvl*0.01));awardGoldBonus(goldBonus);}
}

function updateXPBar(){
  RewardSystem.load();var s=RewardSystem._state;
  var fill=document.getElementById('tryb-xp-fill');var lbl=document.getElementById('tryb-xp-label');var lvl=document.getElementById('tryb-level-badge');
  if(fill)fill.style.width=(s.xp%100)+'%';if(lbl)lbl.textContent=s.xp+' XP';if(lvl)lvl.textContent='Lv.'+s.level;
}

function updateStreakBadge(){RewardSystem.load();var el=document.getElementById('tryb-streak-badge');if(el)el.textContent='🔥 '+(RewardSystem._state.streak||0);}

function updateChallengeMode(on){var sl=document.getElementById('tryb-toggle-slider');var kn=document.getElementById('tryb-toggle-knob');if(sl)sl.style.background=on?'var(--orange)':'rgba(255,255,255,.2)';if(kn)kn.style.left=on?'25px':'3px';}

function renderTrybBadges(){
  RewardSystem.load();var defs=RewardSystem.getBadgeDefs();var s=RewardSystem._state;
  var el=document.getElementById('tryb-badges-row');if(!el)return;
  el.innerHTML=defs.map(function(d){var earned=s.badges&&s.badges[d.id];return'<div class="tryb-badge'+(earned?' earned':'')+'" title="'+d.desc+'"><div class="tryb-badge-icon">'+(earned?d.icon:'🔒')+'</div><div class="tryb-badge-name">'+d.name+'</div></div>';}).join('');
}

async function showTrybSetPicker(){
  var picker=document.getElementById('tryb-set-picker');var list=document.getElementById('tryb-set-list');
  if(!picker)return;
  picker.style.display=picker.style.display==='none'?'block':'none';
  if(picker.style.display==='none')return;
  if(list)list.innerHTML='<div style="color:var(--dim2);font-size:13px">Ładowanie...</div>';
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){if(list)list.innerHTML='<div style="color:var(--dim2);font-size:13px">Zaloguj się</div>';return;}
    var {data}=await db.from('user_sets').select('id,name,user_set_cards(word,translation)').eq('user_id',sess.user.id).order('created_at',{ascending:false}).limit(30);
    if(!data||!data.length){if(list)list.innerHTML='<div style="color:var(--dim2);font-size:13px">Brak zestawów</div>';return;}
    if(list)list.innerHTML='';
    data.forEach(function(s){
      var btn=document.createElement('button');
      btn.style.cssText='background:var(--paper2);border:1.5px solid var(--border);border-radius:12px;padding:12px 16px;cursor:pointer;text-align:left;font-size:14px;font-weight:600;color:var(--navy);width:100%;margin-bottom:6px;transition:.2s';
      btn.onmouseover=function(){this.style.borderColor='var(--orange)';};
      btn.onmouseout=function(){this.style.borderColor='var(--border)';};
      var cards=s.user_set_cards||[];
      btn.innerHTML=(window.escH?escH(s.name):s.name)+' <span style="font-size:12px;color:var(--dim2);font-weight:400">· '+cards.length+' fiszek</span>';
      btn.onclick=function(){_trybExternalCards=cards;_trybExternalName=s.name;picker.style.display='none';startSession('set_external');};
      if(list)list.appendChild(btn);
    });
  }catch(e){if(list)list.innerHTML='<div style="color:#c33;font-size:13px">Błąd: '+e.message+'</div>';}
}

function fireConfetti(){
  var canvas=document.getElementById('tryb-confetti');if(!canvas)return;
  canvas.style.display='block';canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  var ctx=canvas.getContext('2d');var pieces=[];
  for(var i=0;i<120;i++)pieces.push({x:Math.random()*canvas.width,y:-20,w:Math.random()*8+4,h:Math.random()*12+6,color:['#c96a2a','#f5c842','#1a2340','#fff','#e07830'][Math.floor(Math.random()*5)],vx:(Math.random()-.5)*4,vy:Math.random()*4+2,rot:Math.random()*360,rotV:(Math.random()-.5)*8});
  var frames=0;
  function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);pieces.forEach(function(p){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot*Math.PI/180);ctx.fillStyle=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();p.x+=p.vx;p.y+=p.vy;p.rot+=p.rotV;p.vy+=.05;});frames++;if(frames<120)requestAnimationFrame(draw);else{canvas.style.display='none';}}
  draw();
}

async function awardGoldBonus(amount){
  try{var sess=(await db.auth.getSession()).data.session;if(!sess)return;await db.rpc('increment_gold',{p_user_id:sess.user.id,p_amount:amount});}
  catch(e){try{var sess2=(await db.auth.getSession()).data.session;if(!sess2)return;var {data:ls}=await db.from('learning_stats').select('gold').eq('user_id',sess2.user.id).maybeSingle();var ng=((ls&&ls.gold)||0)+amount;await db.from('learning_stats').update({gold:ng}).eq('user_id',sess2.user.id);}catch(e2){}}
}


(function(){startSession('set_external');},150);
}
window.startTrybNauki=startTrybNauki;

function showTrybView(v){
  var lobby=document.getElementById('tryb-lobby');
  var session=document.getElementById('tryb-session');
  var summary=document.getElementById('tryb-summary');
  if(lobby)lobby.style.display=v==='lobby'?'block':'none';
  if(session)session.style.display=v==='session'?'block':'none';
  if(summary)summary.style.display=v==='summary'?'block':'none';
}

async function loadTrybStats(){
  try{
    var sess=(await db.auth.getSession()).data.session;if(!sess)return;
    var {data:due}=await db.rpc('get_due_cards_all',{p_lang:'en',p_limit:200});
    var el=document.getElementById('tryb-due-count');if(el)el.textContent=due?due.length:'0';
  }catch(e){}
}

async function startSession(mode){
  showTrybView('session');
  _trybSessionStats={correct:0,total:0,xpGained:0,startTime:Date.now()};
  _trybIdx=0;_trybPerfectStreak=0;_trybSessionXPToday=0;
  _trybChallengeMode=document.getElementById('tryb-challenge-toggle')&&document.getElementById('tryb-challenge-toggle').checked;
  var hdr=document.getElementById('tryb-session-header');
  if(hdr)hdr.textContent=_trybChallengeMode?'🔀 Tryb Wyzwania aktywny':'Sesja nauki';
  if(mode==='set_external'&&_trybExternalCards){
    _trybSetCards=_trybExternalCards.slice();
    _trybCards=shuffleArr(_trybExternalCards.slice()).map(function(c){return{word:c.word||c.front||'',translation:c.translation||c.back||'',emoji:'',example:'',etymology:'',ease_factor:2.5,repetitions:0,interval_days:1,id:null};});
    if(hdr)hdr.textContent=(_trybExternalName||'Zestaw')+(_trybChallengeMode?' · 🔀':'');
  }else{
    _trybCards=await loadDueCardsForTryb();_trybSetCards=_trybCards.slice();
  }
  if(_trybChallengeMode){var hard=_trybCards.filter(function(c){return(c.ease_factor||2.5)<1.8;});_trybCards=shuffleArr(_trybCards.concat(hard));}
  if(!_trybCards.length){showTrybView('lobby');if(typeof showToast==='function')showToast('Brak słów do nauki — wybierz zestaw!','success');return;}
  var tot=document.getElementById('tryb-card-total');if(tot)tot.textContent=_trybCards.length;
  loadTrybCard();
}

function shuffleArr(arr){for(var i=arr.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}return arr;}

async function loadDueCardsForTryb(){
  try{
    var sess=(await db.auth.getSession()).data.session;if(!sess)return[];
    var {data}=await db.rpc('get_due_cards_all',{p_lang:'en',p_limit:50});
    if(!data||!data.length)return[];
    return data.map(function(d){return{id:d.flashcard_id||d.id,word:d.word||d.front||'',translation:d.translation||d.back||'',emoji:d.emoji||'',example:d.example_sentence||d.example||'',etymology:d.etymology||'',ease_factor:d.ease_factor||2.5,repetitions:d.repetitions||0,interval_days:d.interval_days||1};});
  }catch(e){return[];}
}

function loadTrybCard(){
  var card=_trybCards[_trybIdx];
  if(!card){showTrybSessionSummary();return;}
  _trybHintLevel=0;_trybHintPenalty=0;
  var qs=document.getElementById('tryb-q-side');
  var as=document.getElementById('tryb-a-side');
  var inp=document.getElementById('tryb-answer-input');
  var ht=document.getElementById('tryb-hint-text');
  var hl=document.getElementById('tryb-hint-level');
  var fb=document.getElementById('tryb-feedback');
  if(qs){qs.style.display='flex';qs.style.flexDirection='column';qs.style.alignItems='center';}
  if(as)as.style.display='none';
  if(inp)inp.value='';
  if(ht)ht.textContent='';
  if(hl)hl.textContent='3';
  if(fb)fb.style.opacity='0';
  var emoji=document.getElementById('tryb-card-emoji');
  var word=document.getElementById('tryb-card-word');
  var example=document.getElementById('tryb-card-example');
  var etWrap=document.getElementById('tryb-etymology-wrap');
  if(emoji)emoji.textContent=card.emoji||'📝';
  if(word)word.textContent=card.word||'';
  if(example)example.textContent=card.example?'"'+card.example+'"':'';
  if(etWrap)etWrap.style.display=card.etymology?'block':'none';
  var num=document.getElementById('tryb-card-num');
  var prog=document.getElementById('tryb-progress-bar');
  var done=document.getElementById('tryb-session-done');
  if(num)num.textContent=_trybIdx+1;
  var pct=Math.round(_trybIdx/_trybCards.length*100);
  if(prog)prog.style.width=pct+'%';
  if(done)done.textContent=_trybIdx;
  var mnKey='mnem_'+encodeURIComponent(card.word||'');
  var mn=document.getElementById('tryb-mnemonic-input');
  if(mn)mn.value=localStorage.getItem(mnKey)||'';
  var storyBtn=document.getElementById('tryb-story-btn');
  var storyBox=document.getElementById('tryb-story-box');
  if(storyBtn)storyBtn.style.display=_trybSetCards.length>=5?'inline-block':'none';
  if(storyBox)storyBox.style.display='none';
  setTimeout(function(){var i=document.getElementById('tryb-answer-input');if(i)i.focus();},100);
}

function levenshteinDist(a,b){
  var m=a.length,n=b.length,dp=[];
  for(var i=0;i<=m;i++){dp[i]=[i];for(var j=1;j<=n;j++)dp[i][j]=i===0?j:0;}
  for(var i=1;i<=m;i++)for(var j=1;j<=n;j++)dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

function checkAnswer(){
  var card=_trybCards[_trybIdx];if(!card)return;
  var userAns=(document.getElementById('tryb-answer-input').value||'').trim().toLowerCase();
  var correct=(card.translation||'').trim().toLowerCase();
  function norm(s){return s.replace(/[(),.!?]/g,' ').replace(/\s+/g,' ').trim();}
  var userN=norm(userAns),correctN=norm(correct);
  var alts=correctN.split(/[\/,]| lub /).map(function(a){return a.trim();});
  var isCorrect=alts.some(function(a){return userN===a||userN.includes(a)||a.includes(userN);});
  var isTypo=false;
  if(!isCorrect&&userAns.length>0){var best=alts.reduce(function(min,a){return Math.min(min,levenshteinDist(userN,a));},Infinity);isTypo=best<=2&&best<correctN.length*0.3;if(isTypo)isCorrect=true;}
  revealTrybAnswer(userAns,isCorrect,isTypo);
}

function dontKnow(){revealTrybAnswer('',false,false);}

function revealTrybAnswer(userAns,isCorrect,isTypo){
  var card=_trybCards[_trybIdx];
  _trybSessionStats.total++;if(isCorrect)_trybSessionStats.correct++;
  var fb=document.getElementById('tryb-feedback');
  if(fb){fb.textContent=isCorrect?(isTypo?'⚠️':'✅'):'❌';fb.style.animation='none';fb.offsetHeight;fb.style.animation='feedbackPop .6s ease forwards';}
  var qs=document.getElementById('tryb-q-side');var as=document.getElementById('tryb-a-side');
  if(qs)qs.style.display='none';
  if(as){as.style.display='flex';as.style.flexDirection='column';as.style.alignItems='center';}
  var wordAns=document.getElementById('tryb-card-word-ans');var cardAns=document.getElementById('tryb-card-answer');
  var resIcon=document.getElementById('tryb-result-icon');var userWrote=document.getElementById('tryb-user-wrote');
  var etText=document.getElementById('tryb-etymology-text');
  if(wordAns)wordAns.textContent=card.word||'';
  if(cardAns)cardAns.textContent=card.translation||'';
  if(resIcon)resIcon.textContent=isCorrect?(isTypo?'⚠️ Literówka':'✅'):'❌';
  if(userWrote)userWrote.textContent=!userAns?'Nie wpisałeś odpowiedzi':isTypo?'Twoja odpowiedź: "'+userAns+'" — literówka, ale zaliczam!':!isCorrect?'Twoja odpowiedź: "'+userAns+'"':'';
  if(etText&&card.etymology)etText.textContent=card.etymology;
  if(isTypo){document.querySelectorAll('.tryb-rate-btn').forEach(function(b){if(parseInt(b.dataset.q)>3)b.style.opacity='0.5';});}
}

async function rateCard(btnRating){
  var card=_trybCards[_trybIdx];if(!card)return;
  var isTypo=document.getElementById('tryb-result-icon')&&document.getElementById('tryb-result-icon').textContent.includes('⚠️');
  var eff=isTypo?Math.min(btnRating,3):btnRating;
  var qMap={1:0,2:2,3:4,4:5};
  var quality=Math.max(0,(qMap[eff]||0)-_trybHintPenalty);
  var newSRS=sm2Local(card,quality);
  await saveTrybSRS(card,newSRS);
  var xpTable={1:0,2:3,3:7,4:10};
  var xp=xpTable[eff]||0;
  if(_trybChallengeMode)xp=Math.round(xp*1.25);
  if((card.ease_factor||2.5)<1.8)xp*=2;
  _trybSessionStats.xpGained+=xp;_trybSessionXPToday+=xp;
  if(eff===4)_trybPerfectStreak++;else _trybPerfectStreak=0;
  RewardSystem._state.perfectStreak=Math.max(RewardSystem._state.perfectStreak,_trybPerfectStreak);
  var xpTodayEl=document.getElementById('tryb-xp-today');
  if(xpTodayEl)xpTodayEl.textContent=_trybSessionXPToday;
  _trybIdx++;loadTrybCard();
}

async function saveTrybSRS(card,newSRS){
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess||!card.id)return;
    await db.from('word_progress').upsert({user_id:sess.user.id,flashcard_id:card.id,ease_factor:newSRS.ease_factor,repetitions:newSRS.repetitions,interval_days:newSRS.interval_days,next_review:newSRS.next_review},{onConflict:'user_id,flashcard_id'});
  }catch(e){}
}

function showTrybHint(){
  var card=_trybCards[_trybIdx];if(!card)return;
  var ans=card.translation||'';_trybHintLevel++;_trybHintPenalty=Math.min(3,_trybHintLevel);
  var hintText='';
  if(_trybHintLevel===1)hintText='📏 Liczba liter: '+ans.replace(/ /g,'_').length;
  else if(_trybHintLevel===2)hintText='🔤 Pierwsza litera: '+ans[0].toUpperCase()+'...';
  else hintText='💡 Pierwsze litery: '+ans.slice(0,Math.ceil(ans.length/3))+'...';
  var ht=document.getElementById('tryb-hint-text');var hl=document.getElementById('tryb-hint-level');
  if(ht)ht.textContent=hintText;if(hl)hl.textContent=Math.max(0,3-_trybHintLevel);
  if(_trybHintLevel>=3){var hb=document.getElementById('tryb-hint-btn');if(hb)hb.disabled=true;}
  document.querySelectorAll('.tryb-rate-btn').forEach(function(b){var max=Math.max(1,4-_trybHintPenalty);b.style.opacity=parseInt(b.dataset.q)>max?'0.45':'1';});
}

function saveTrybMnemonic(){
  var card=_trybCards[_trybIdx];if(!card)return;
  var val=(document.getElementById('tryb-mnemonic-input')||{}).value||'';
  localStorage.setItem('mnem_'+encodeURIComponent(card.word||''),val);
}

function showTrybMiniStory(){
  var box=document.getElementById('tryb-story-box');if(!box)return;
  if(box.style.display==='block'){box.style.display='none';return;}
  var words=_trybSetCards.slice(0,5).map(function(c){return'<strong style="color:var(--gold)">'+(c.word||'')+'</strong>';});
  box.innerHTML='📖 <em>Krótka historia łącząca słowa: '+words.join(', ')+'.<br>Użyj ich wszystkich w rozmowie!</em>';
  box.style.display='block';
}

function endSession(){
  if(_trybSessionStats.total>0)showTrybSessionSummary();
  else showTrybView('lobby');
}

async function showTrybSessionSummary(){
  showTrybView('summary');
  var stats=_trybSessionStats;
  var timeS=Math.round((Date.now()-stats.startTime)/1000);
  var pct=stats.total>0?Math.round(stats.correct/stats.total*100):0;
  var sc=document.getElementById('sum-cards');var sp=document.getElementById('sum-pct');var sx=document.getElementById('sum-xp');
  if(sc)sc.textContent=stats.total;if(sp)sp.textContent=pct+'%';if(sx)sx.textContent=stats.xpGained;
  RewardSystem.load();
  RewardSystem._state.totalCards+=stats.total;RewardSystem._state.totalSessions++;
  RewardSystem.updateStreak();RewardSystem.addXP(stats.xpGained);
  var newBadges=RewardSystem.checkMilestones({cards:stats.total,time:timeS});
  RewardSystem.save();
  var nba=document.getElementById('tryb-new-badge-announce');
  if(nba){if(newBadges.length){var b=newBadges[0];nba.style.display='block';var nbi=document.getElementById('tryb-new-badge-icon');var nbn=document.getElementById('tryb-new-badge-name');var nbd=document.getElementById('tryb-new-badge-desc');if(nbi)nbi.textContent=b.icon;if(nbn)nbn.textContent=b.name;if(nbd)nbd.textContent=b.desc;fireConfetti();}else{nba.style.display='none';}}
  var icon=pct>=80?'🎉':pct>=50?'👍':'💪';
  var si=document.getElementById('tryb-summary-icon');var ss=document.getElementById('tryb-summary-sub');
  if(si)si.textContent=icon;if(ss)ss.textContent=pct>=80?'Niesamowita sesja!':pct>=50?'Niezłe, ćwicz dalej!':'Trudne słowa — wróć do nich jutro!';
  updateXPBar();updateStreakBadge();
  // Gold bonus
  if(stats.xpGained>0){var lvl=RewardSystem._state.level||1;var goldBonus=Math.round(stats.xpGained*(1+lvl*0.01));awardGoldBonus(goldBonus);}
}

function updateXPBar(){
  RewardSystem.load();var s=RewardSystem._state;
  var fill=document.getElementById('tryb-xp-fill');var lbl=document.getElementById('tryb-xp-label');var lvl=document.getElementById('tryb-level-badge');
  if(fill)fill.style.width=(s.xp%100)+'%';if(lbl)lbl.textContent=s.xp+' XP';if(lvl)lvl.textContent='Lv.'+s.level;
}
function updateStreakBadge(){RewardSystem.load();var el=document.getElementById('tryb-streak-badge');if(el)el.textContent='🔥 '+(RewardSystem._state.streak||0);}
function updateChallengeMode(on){var sl=document.getElementById('tryb-toggle-slider');var kn=document.getElementById('tryb-toggle-knob');if(sl)sl.style.background=on?'var(--orange)':'rgba(255,255,255,.2)';if(kn)kn.style.left=on?'25px':'3px';}

function renderTrybBadges(){
  RewardSystem.load();var defs=RewardSystem.getBadgeDefs();var s=RewardSystem._state;
  var el=document.getElementById('tryb-badges-row');if(!el)return;
  el.innerHTML=defs.map(function(d){var earned=s.badges&&s.badges[d.id];return'<div class="tryb-badge'+(earned?' earned':'')+'" title="'+d.desc+'"><div class="tryb-badge-icon">'+(earned?d.icon:'🔒')+'</div><div class="tryb-badge-name">'+d.name+'</div></div>';}).join('');
}

async function showTrybSetPicker(){
  var picker=document.getElementById('tryb-set-picker');var list=document.getElementById('tryb-set-list');
  if(!picker)return;
  picker.style.display=picker.style.display==='none'?'block':'none';
  if(picker.style.display==='none')return;
  if(list)list.innerHTML='<div style="color:var(--dim2);font-size:13px">Ładowanie...</div>';
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){if(list)list.innerHTML='<div style="color:var(--dim2);font-size:13px">Zaloguj się</div>';return;}
    var {data}=await db.from('user_sets').select('id,name,user_set_cards(word,translation)').eq('user_id',sess.user.id).order('created_at',{ascending:false}).limit(30);
    if(!data||!data.length){if(list)list.innerHTML='<div style="color:var(--dim2);font-size:13px">Brak zestawów</div>';return;}
    if(list)list.innerHTML='';
    data.forEach(function(s){
      var btn=document.createElement('button');
      btn.style.cssText='background:var(--paper2);border:1.5px solid var(--border);border-radius:12px;padding:12px 16px;cursor:pointer;text-align:left;font-size:14px;font-weight:600;color:var(--navy);width:100%;margin-bottom:6px;transition:.2s';
      btn.onmouseover=function(){this.style.borderColor='var(--orange)';};
      btn.onmouseout=function(){this.style.borderColor='var(--border)';};
      var cards=s.user_set_cards||[];
      btn.innerHTML=(window.escH?escH(s.name):s.name)+' <span style="font-size:12px;color:var(--dim2);font-weight:400">· '+cards.length+' fiszek</span>';
      btn.onclick=function(){_trybExternalCards=cards;_trybExternalName=s.name;picker.style.display='none';startSession('set_external');};
      if(list)list.appendChild(btn);
    });
  }catch(e){if(list)list.innerHTML='<div style="color:#c33;font-size:13px">Błąd: '+e.message+'</div>';}
}

function fireConfetti(){
  var canvas=document.getElementById('tryb-confetti');if(!canvas)return;
  canvas.style.display='block';canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  var ctx=canvas.getContext('2d');var pieces=[];
  for(var i=0;i<120;i++)pieces.push({x:Math.random()*canvas.width,y:-20,w:Math.random()*8+4,h:Math.random()*12+6,color:['#c96a2a','#f5c842','#1a2340','#fff','#e07830'][Math.floor(Math.random()*5)],vx:(Math.random()-.5)*4,vy:Math.random()*4+2,rot:Math.random()*360,rotV:(Math.random()-.5)*8});
  var frames=0;
  function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);pieces.forEach(function(p){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot*Math.PI/180);ctx.fillStyle=p.color;ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h);ctx.restore();p.x+=p.vx;p.y+=p.vy;p.rot+=p.rotV;p.vy+=.05;});frames++;if(frames<120)requestAnimationFrame(draw);else{canvas.style.display='none';}}
  draw();
}

async function awardGoldBonus(amount){
  try{var sess=(await db.auth.getSession()).data.session;if(!sess)return;await db.rpc('increment_gold',{p_user_id:sess.user.id,p_amount:amount});}
  catch(e){try{var sess2=(await db.auth.getSession()).data.session;if(!sess2)return;var {data:ls}=await db.from('learning_stats').select('gold').eq('user_id',sess2.user.id).maybeSingle();var ng=((ls&&ls.gold)||0)+amount;await db.from('learning_stats').update({gold:ng}).eq('user_id',sess2.user.id);}catch(e2){}}
}

// Tryb Nauki page HTML injection
document.addEventListener('DOMContentLoaded', function(){
(function(){
  if(document.getElementById('page-tryb'))return;
  var div=document.createElement('div');
  div.id='page-tryb';div.className='page';
  div.style.cssText='min-height:100vh;background:var(--paper);padding:100px 20px 60px';
  div.innerHTML='<div style="max-width:860px;margin:0 auto">'
    +'<div id="tryb-lobby">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px;padding-top:8px">'
    +'<div><h2 style="font-family:Syne,sans-serif;font-size:32px;font-weight:800;color:var(--navy);margin-bottom:4px">📚 Tryb Nauki</h2>'
    +'<p style="color:var(--dim2);font-size:14px">Spaced repetition · Active recall · SM-2</p></div>'
    +'<div style="display:flex;gap:10px;align-items:center">'
    +'<div style="background:var(--paper2);border:1px solid var(--border);border-radius:100px;padding:6px 16px;display:flex;align-items:center;gap:10px;min-width:180px">'
    +'<span style="font-size:12px;font-weight:700;color:var(--orange)" id="tryb-level-badge">Lv.1</span>'
    +'<div style="flex:1;height:6px;background:rgba(26,35,64,.1);border-radius:3px;overflow:hidden"><div id="tryb-xp-fill" style="height:100%;background:linear-gradient(90deg,var(--orange),var(--gold));border-radius:3px;transition:width .5s;width:0%"></div></div>'
    +'<span style="font-size:11px;color:var(--dim2)" id="tryb-xp-label">0 XP</span></div>'
    +'<div id="tryb-streak-badge" style="background:var(--navy);color:#fff;border-radius:100px;padding:6px 14px;font-size:13px;font-weight:700">🔥 0</div>'
    +'</div></div>'
    // Stats
    +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">'
    +'<div class="dstat"><div class="dstat-l">📅 Do powtórki</div><div class="dstat-v gold" id="tryb-due-count">—</div><div class="dstat-s">słów dziś</div></div>'
    +'<div class="dstat"><div class="dstat-l">✅ Sesja</div><div class="dstat-v green" id="tryb-session-done">0</div><div class="dstat-s">ukończonych</div></div>'
    +'<div class="dstat"><div class="dstat-l">🏆 XP dziś</div><div class="dstat-v" id="tryb-xp-today">0</div><div class="dstat-s">punktów</div></div>'
    +'<div class="dstat"><div class="dstat-l">📚 Nowe</div><div class="dstat-v" id="tryb-new-count">—</div><div class="dstat-s">do nauki</div></div>'
    +'</div>'
    // Mode selection
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:24px">'
    +'<div onclick="startSession(\'due\')" style="background:#fff;border:2px solid var(--border);border-radius:20px;padding:24px;cursor:pointer;transition:.2s" onmouseover="this.style.borderColor=\'var(--orange)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
    +'<div style="font-size:32px;margin-bottom:10px">🔁</div><div style="font-weight:700;font-size:16px;color:var(--navy);margin-bottom:6px">Powtórki na dziś</div>'
    +'<div style="font-size:13px;color:var(--dim2)">Algorytm SM-2 wybrał słowa dla Ciebie</div></div>'
    +'<div onclick="showTrybSetPicker()" style="background:#fff;border:2px solid var(--border);border-radius:20px;padding:24px;cursor:pointer;transition:.2s" onmouseover="this.style.borderColor=\'var(--orange)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
    +'<div style="font-size:32px;margin-bottom:10px">📋</div><div style="font-weight:700;font-size:16px;color:var(--navy);margin-bottom:6px">Wybierz zestaw</div>'
    +'<div style="font-size:13px;color:var(--dim2)">Ucz się z wybranego zestawu</div></div>'
    +'</div>'
    // Challenge toggle
    +'<div style="background:var(--navy);border-radius:16px;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">'
    +'<div><div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:3px">🔀 Tryb Wyzwania</div>'
    +'<div style="font-size:12px;color:rgba(255,255,255,.5)">Trudniejsze słowa 2× częściej · +25% XP</div></div>'
    +'<label style="position:relative;display:inline-block;width:48px;height:26px;cursor:pointer">'
    +'<input type="checkbox" id="tryb-challenge-toggle" style="opacity:0;width:0;height:0" onchange="updateChallengeMode(this.checked)">'
    +'<span id="tryb-toggle-slider" style="position:absolute;inset:0;background:rgba(255,255,255,.2);border-radius:26px;transition:.3s">'
    +'<span id="tryb-toggle-knob" style="position:absolute;left:3px;top:3px;width:20px;height:20px;background:#fff;border-radius:50%;transition:.3s"></span>'
    +'</span></label></div>'
    // Set picker
    +'<div id="tryb-set-picker" style="display:none;background:#fff;border:1.5px solid var(--border);border-radius:20px;padding:20px;margin-bottom:24px">'
    +'<div style="font-weight:700;font-size:15px;color:var(--navy);margin-bottom:14px">Wybierz zestaw:</div>'
    +'<div id="tryb-set-list" style="max-height:280px;overflow-y:auto"></div></div>'
    // Badges
    +'<div style="background:#fff;border:1.5px solid var(--border);border-radius:20px;padding:20px">'
    +'<div style="font-size:13px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">🎖️ Odznaki</div>'
    +'<div id="tryb-badges-row" style="display:flex;flex-wrap:wrap;gap:10px"></div></div>'
    +'</div>'
    // Session view
    +'<div id="tryb-session" style="display:none">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:10px">'
    +'<button onclick="endSession()" style="background:transparent;border:1.5px solid var(--border);border-radius:100px;padding:8px 18px;cursor:pointer;font-size:13px;color:var(--dim2)">← Zakończ</button>'
    +'<div id="tryb-session-header" style="font-size:13px;font-weight:600;color:var(--dim2)">Sesja nauki</div>'
    +'<div style="display:flex;align-items:center;gap:12px">'
    +'<div style="font-size:13px;color:var(--dim2)"><span id="tryb-card-num">1</span> / <span id="tryb-card-total">?</span></div>'
    +'<div style="width:100px;height:6px;background:var(--paper2);border-radius:3px;overflow:hidden"><div id="tryb-progress-bar" style="height:100%;background:linear-gradient(90deg,var(--orange),var(--gold));border-radius:3px;transition:width .4s;width:0%"></div></div>'
    +'</div></div>'
    // Card
    +'<div id="tryb-card" style="background:#fff;border:2px solid var(--border);border-radius:24px;padding:40px;text-align:center;margin-bottom:20px;min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;box-shadow:0 8px 40px rgba(26,35,64,.08)">'
    +'<div id="tryb-q-side" style="display:flex;flex-direction:column;align-items:center">'
    +'<div id="tryb-card-emoji" style="font-size:48px;margin-bottom:12px"></div>'
    +'<div id="tryb-card-word" style="font-family:Syne,sans-serif;font-size:42px;font-weight:800;color:var(--navy);letter-spacing:-1px;margin-bottom:10px"></div>'
    +'<div id="tryb-card-example" style="font-size:13px;color:var(--dim2);font-style:italic;max-width:400px;line-height:1.6;margin-bottom:20px"></div>'
    +'<div style="display:flex;gap:8px;width:100%;max-width:380px">'
    +'<input id="tryb-answer-input" type="text" class="fi" placeholder="Wpisz tłumaczenie..." style="flex:1;font-size:15px;text-align:center" onkeydown="if(event.key===\'Enter\')checkAnswer()">'
    +'<button onclick="checkAnswer()" class="btn btn-orange" style="padding:10px 18px">✓</button></div>'
    +'<div style="display:flex;gap:8px;margin-top:12px;justify-content:center">'
    +'<button id="tryb-hint-btn" onclick="showTrybHint()" style="background:transparent;border:1px solid var(--border2);border-radius:100px;padding:5px 14px;font-size:12px;color:var(--dim2);cursor:pointer">💡 Podpowiedź (<span id="tryb-hint-level">3</span>)</button>'
    +'<button onclick="dontKnow()" style="background:transparent;border:1px solid var(--border2);border-radius:100px;padding:5px 14px;font-size:12px;color:var(--dim2);cursor:pointer">🚫 Nie pamiętam</button></div>'
    +'<div id="tryb-hint-text" style="margin-top:10px;font-size:14px;color:var(--orange);font-weight:600;min-height:20px"></div>'
    +'</div>'
    // Answer side
    +'<div id="tryb-a-side" style="display:none;width:100%">'
    +'<div id="tryb-result-icon" style="font-size:48px;margin-bottom:8px"></div>'
    +'<div id="tryb-card-word-ans" style="font-family:Syne,sans-serif;font-size:32px;font-weight:800;color:var(--navy);margin-bottom:6px"></div>'
    +'<div id="tryb-card-answer" style="font-size:22px;color:var(--orange);font-weight:700;margin-bottom:10px"></div>'
    +'<div id="tryb-user-wrote" style="font-size:13px;color:var(--dim2);margin-bottom:16px"></div>'
    +'<div id="tryb-etymology-wrap" style="background:var(--paper2);border-radius:12px;padding:12px 16px;margin-bottom:16px;text-align:left;width:100%;max-width:440px;display:none">'
    +'<button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'" style="background:none;border:none;cursor:pointer;font-size:12px;font-weight:700;color:var(--dim2);width:100%;text-align:left">🔍 Dlaczego tak?</button>'
    +'<div id="tryb-etymology-text" style="display:none;font-size:13px;color:var(--dim);line-height:1.6;margin-top:8px"></div></div>'
    +'<div style="width:100%;max-width:440px;margin-bottom:16px"><input id="tryb-mnemonic-input" type="text" class="fi" placeholder="💭 Twoja mnemotechnika..." style="font-size:13px;width:100%" oninput="saveTrybMnemonic()"></div>'
    +'<div style="font-size:13px;color:var(--dim2);margin-bottom:10px;font-weight:600">Jak poszło?</div>'
    +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:100%;max-width:440px">'
    +'<button onclick="rateCard(1)" class="tryb-rate-btn" data-q="1" style="background:#fee2e2;border:1.5px solid #fca5a5;color:#991b1b;border-radius:12px;padding:10px 4px;cursor:pointer;font-size:12px;font-weight:700"><div style="font-size:18px">😔</div>Nie wiedziałem</button>'
    +'<button onclick="rateCard(2)" class="tryb-rate-btn" data-q="2" style="background:#ffedd5;border:1.5px solid #fed7aa;color:#9a3412;border-radius:12px;padding:10px 4px;cursor:pointer;font-size:12px;font-weight:700"><div style="font-size:18px">😅</div>Prawie</button>'
    +'<button onclick="rateCard(3)" class="tryb-rate-btn" data-q="3" style="background:#dcfce7;border:1.5px solid #86efac;color:#166534;border-radius:12px;padding:10px 4px;cursor:pointer;font-size:12px;font-weight:700"><div style="font-size:18px">😊</div>Wiedziałem</button>'
    +'<button onclick="rateCard(4)" class="tryb-rate-btn" data-q="4" style="background:#dbeafe;border:1.5px solid #93c5fd;color:#1e40af;border-radius:12px;padding:10px 4px;cursor:pointer;font-size:12px;font-weight:700"><div style="font-size:18px">🚀</div>Bardzo łatwe</button>'
    +'</div></div>'
    +'<div id="tryb-feedback" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:80px;pointer-events:none;opacity:0"></div>'
    +'</div>'
    +'<div style="text-align:center;margin-bottom:16px"><button id="tryb-story-btn" onclick="showTrybMiniStory()" style="display:none;background:transparent;border:1.5px solid var(--border2);border-radius:100px;padding:8px 20px;font-size:13px;color:var(--dim);cursor:pointer">📖 Minihistoryjka</button></div>'
    +'<div id="tryb-story-box" style="display:none;background:var(--navy);color:#fff;border-radius:16px;padding:20px;font-size:14px;line-height:1.7"></div>'
    +'</div>'
    // Summary
    +'<div id="tryb-summary" style="display:none;text-align:center">'
    +'<div style="font-size:64px;margin-bottom:16px" id="tryb-summary-icon">🎉</div>'
    +'<h2 style="font-family:Syne,sans-serif;font-size:32px;font-weight:800;color:var(--navy);margin-bottom:8px">Sesja ukończona!</h2>'
    +'<p style="color:var(--dim2);margin-bottom:28px" id="tryb-summary-sub">Świetna robota!</p>'
    +'<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px">'
    +'<div class="dstat"><div class="dstat-l">📚 Kart</div><div class="dstat-v" id="sum-cards">0</div></div>'
    +'<div class="dstat"><div class="dstat-l">✅ % poprawnych</div><div class="dstat-v green" id="sum-pct">0%</div></div>'
    +'<div class="dstat"><div class="dstat-l">⭐ XP</div><div class="dstat-v gold" id="sum-xp">0</div></div>'
    +'</div>'
    +'<div id="tryb-new-badge-announce" style="display:none;background:linear-gradient(135deg,var(--orange),var(--gold));color:#fff;border-radius:16px;padding:20px;margin-bottom:20px">'
    +'<div style="font-size:36px;margin-bottom:8px" id="tryb-new-badge-icon"></div>'
    +'<div style="font-weight:800;font-size:18px" id="tryb-new-badge-name"></div>'
    +'<div style="font-size:13px;opacity:.85" id="tryb-new-badge-desc"></div></div>'
    +'<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">'
    +'<button onclick="initTrybNauki()" class="btn btn-orange btn-lg">🔁 Nowa sesja</button>'
    +'<button onclick="showPage(\'community\')" class="btn btn-navy">← Materiały</button>'
    +'</div></div>'
    +'</div>';
  document.body.appendChild(div);

  // Confetti canvas
  if(!document.getElementById('tryb-confetti')){
    var canvas=document.createElement('canvas');
    canvas.id='tryb-confetti';
    canvas.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:9999;display:none';
    document.body.appendChild(canvas);
  }
})()
});;

// ── Napraw słówka do fiszek w analizie — tylko słowo + tłumaczenie, bez kontekstu ──
var _origRenderLyricsWords = window.renderLyricsWords;
window.renderLyricsWords = function(){
  var panel=document.getElementById('lyrics-words-panel');
  var addBtn=document.getElementById('lyrics-add-all-btn');
  if(!_lyricsWords||!_lyricsWords.length){
    if(panel)panel.innerHTML='<div style="color:var(--dim2);font-size:13px">Brak słów</div>';
    return;
  }
  if(addBtn)addBtn.style.display='flex';
  if(!panel)return;
  panel.innerHTML=_lyricsWords.map(function(w,i){
    return'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">'
      +'<div><div style="font-size:13px;font-weight:600;color:var(--navy)">'+(w.word||'')+'</div>'
      +'<div style="font-size:12px;color:var(--orange)">'+(w.translation||'').split('+')[0].trim()+'</div></div>'
      +'<span class="word-badge" id="wb-'+i+'" onclick="lyricsAddWord('+i+')" style="white-space:nowrap">+ Fiszka</span>'
      +'</div>';
  }).join('');
};
