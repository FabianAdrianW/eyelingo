// Eyelingo — core.js

const SUPABASE_URL='https://sntlgkhktscezxpxrchl.supabase.co';
const SUPABASE_KEY='sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8';
const DOWNLOAD_URL='#';
const{createClient}=supabase;
const db=createClient(SUPABASE_URL,SUPABASE_KEY);

// ── API constants ──
const APIKEY_CONST='sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8';
const AI_PROXY_URL='https://sntlgkhktscezxpxrchl.supabase.co/functions/v1/super-endpoint';
const GENERATE_SENTENCE_URL='https://sntlgkhktscezxpxrchl.supabase.co/functions/v1/generate-sentence';
var ODKRYJ_AI_URL='https://sntlgkhktscezxpxrchl.supabase.co/functions/v1/super-endpoint';
var ODKRYJ_ARTICLE_URL='https://sntlgkhktscezxpxrchl.supabase.co/functions/v1/generate-article';
var ODKRYJ_APIKEY='sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8';
var ODKRYJ_YT_URL='https://sntlgkhktscezxpxrchl.supabase.co/functions/v1/search-youtube';
const _YT_KEY='AIzaSyCUQJksAT-HtZ3GBBMr3__b19nNlHqxajI';
window._YT_KEY=_YT_KEY;

// ── Global state ──
let authMode='login';
let _likedSets=new Set();
let _addedSets=new Set();
let _matSets=[];
let _matMyUid=null;
let _matTab='community';
let _matModal=null;
let _matEditMode=false;
let _createIsPublic=false;
const CHAT_DAILY_LIMIT=15;
var _chatHistory=[];
var _chatLang='en';
var _chatLevel='beginner';
var _lyricsWords=[];
var _lyricsAllLines=[];
var _allTutors=[];
var _myTutorId=null;
var _strefaCards=[];
var _strefaIdx=0;
var _strefaLang='en';
var _strefaLevel='A1';
var _strefaWords=[];
var _strefaLevels=[];
var _strefaProfile=null;
var _inlineQuizState={step:0,done:false,words:[]};
var _tcp={open:false,activeTutorId:null,activeTutorName:'',myId:null,realtimeSub:null,contacts:JSON.parse(localStorage.getItem('tutor_contacts')||'{}')};
var _dailyDone={word:false,read:false,quiz:false};
var _dailyXP=0;
var _dailyLoaded=false;
var _dailyLoadedDate='';
var _quizAnswered=false;
var _sentCache={};
var _ttCache={};
var _srsUserId=null;
var _srsCards=[];
var _srsIdx=0;
var _srsSetName='';
var _srsFlipped=false;
var _challengeTimer=null;
var _challengeSetCache=null;
var _trybCards=[];
var _trybIdx=0;
var _voicesLang='en';
var LANG_FLAGS={'en':'🇬🇧','es':'🇪🇸','nl':'🇳🇱','jp':'🇯🇵','de':'🇩🇪','fr':'🇫🇷','it':'🇮🇹','pt':'🇵🇹'};
const LANG_FLAGS_STREFA={en:'🇬🇧',es:'🇪🇸',jp:'🇯🇵',nl:'🇳🇱'};
const LANG_LABELS={en:'Angielski',es:'Hiszpański',jp:'Japoński',nl:'Niderlandzki'};
var DAYS_PL=['Pon','Wt','Śr','Czw','Pt','Sob','Nd'];
var DAYS_EN=['mon','tue','wed','thu','fri','sat','sun'];
const DAYS_EN_T=['mon','tue','wed','thu','fri','sat','sun'];

function getChatUsageToday(){try{return parseInt(localStorage.getItem('chat_usage_'+new Date().toISOString().slice(0,10))||'0');}catch(e){return 0;}}

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



function navHome(){showPage('home');return false}

function navSection(sel){showPage('home');setTimeout(()=>{const el=document.querySelector(sel);if(el)el.scrollIntoView({behavior:'smooth'})},60);return false}

function showAuth(m){authMode=m;showPage('auth');updateAuthUI();clearMsg('auth-msg')}

function toggleAuthMode(){authMode=authMode==='login'?'register':'login';updateAuthUI();clearMsg('auth-msg')}

function updateAuthUI(){
  const l=authMode==='login';
  document.getElementById('auth-title').textContent=l?'Witaj z powrotem 👋':'Utwórz konto 🚀';
  document.getElementById('auth-sub').textContent=l?'Zaloguj się aby kontynuować naukę':'Dołącz do Eyelingo — to nic nie kosztuje';
  document.getElementById('auth-btn-text').textContent=l?'Zaloguj się':'Zarejestruj się';
  document.getElementById('auth-switch').innerHTML=l
    ?'Nie masz konta? <a onclick="toggleAuthMode()">Zarejestruj się za darmo</a>'
    :'Masz już konto? <a onclick="toggleAuthMode()">Zaloguj się</a>';
  document.getElementById('fg-username').style.display=l?'none':'block';
}

function showMsg(id,t,tp){const e=document.getElementById(id);e.textContent=t;e.className='amsg '+tp+' show'}

function clearMsg(id){document.getElementById(id).className='amsg'}

async function submitAuth(){
  const email=document.getElementById('auth-email').value.trim();
  const pass=document.getElementById('auth-password').value;
  const username=document.getElementById('auth-username')?.value.trim()||'';
  if(!email||!pass){showMsg('auth-msg','Wypełnij e-mail i hasło.','error');return}
  if(pass.length<6){showMsg('auth-msg','Hasło musi mieć co najmniej 6 znaków.','error');return}
  if(authMode==='register'){
    if(!username){showMsg('auth-msg','Wpisz pseudonim.','error');return}
    if(username.length<3){showMsg('auth-msg','Pseudonim musi mieć co najmniej 3 znaki.','error');return}
  }
  const btn=document.getElementById('auth-btn');btn.disabled=true;
  document.getElementById('auth-btn-text').textContent='Łączenie...';
  try{
    let res=authMode==='login'
      ?await db.auth.signInWithPassword({email,password:pass})
      :await db.auth.signUp({email,password:pass,options:{data:{username}}});
    if(res.error)throw res.error;
    if(authMode==='register'){
      if(!res.data.session){
        showMsg('auth-msg','✅ Sprawdź e-mail i potwierdź konto.','success');
      } else {
        // Zapisz pseudonim - upsert żeby nie było błędu jeśli trigger już stworzył wiersz
        if(username&&res.data.user){
          await db.from('profiles').upsert({user_id:res.data.user.id,username},{onConflict:'user_id'}).select();
        }
        await loadDashboard();showPage('dash');
      }
    } else {
      await loadDashboard();showPage('dash');
    }
  }catch(e){
    const m=e.message||'';
    if(m.includes('Invalid login')||m.includes('invalid'))showMsg('auth-msg','Nieprawidłowy e-mail lub hasło.','error');
    else if(m.includes('already'))showMsg('auth-msg','Ten e-mail jest już zarejestrowany.','error');
    else showMsg('auth-msg','Błąd: '+m,'error');
  }
  btn.disabled=false;
  document.getElementById('auth-btn-text').textContent=authMode==='login'?'Zaloguj się':'Zarejestruj się';
}

async function loadDashboard(){
  const{data:{user}}=await db.auth.getUser();if(!user)return;
  const name=user.email.split('@')[0];
  document.getElementById('dash-name').textContent=name+' 👋';
  updateNav(true,name);

  // Złoto i statystyki z learning_stats
  // maybeSingle() nie rzuca 406 gdy brak wiersza
  let{data:s}=await db.from('learning_stats').select('gold,cards_seen,minutes_active,streak_days').eq('user_id',user.id).maybeSingle();
  if(!s){
    // Utwórz wiersz dla nowego użytkownika
    await db.from('learning_stats').upsert({user_id:user.id,gold:0,cards_seen:0,minutes_active:0,streak_days:0},{onConflict:'user_id'});
    s={gold:0,cards_seen:0,minutes_active:0,streak_days:0};
  }
  if(s){
    const streak=s.streak_days||0;
    const cards=s.cards_seen||0;
    const minutes=s.minutes_active||0;
    const gold=s.gold||0;

    // Hero stats
    document.getElementById('dash-gold').textContent=gold.toLocaleString('pl-PL');
    document.getElementById('dash-streak').textContent=streak;
    document.getElementById('dash-cards').textContent=cards;

    // Streak card
    const streakEl=document.getElementById('stat-streak');
    if(streakEl) streakEl.textContent=streak;
    const bar=document.getElementById('streak-bar');
    if(bar) bar.style.width=Math.min(100,Math.round(streak/7*100))+'%';
    const flame=document.getElementById('streak-flame');
    if(flame) flame.textContent=streak>=7?'🔥🔥':streak>=3?'🔥':'💤';
    const streakMsg=document.getElementById('streak-msg');
    if(streakMsg){
      if(streak===0) streakMsg.textContent='Zacznij dziś — pierwszy dzień streaka!';
      else if(streak<3) streakMsg.textContent='Dobry start! Utrzymaj go jutro 💪';
      else if(streak<7) streakMsg.textContent='Świetnie! Jeszcze '+(7-streak)+' dni do tygodniowego celu 🎯';
      else streakMsg.textContent='Niesamowite! Tydzień z rzędu — tak trzymaj! 🏆';
    }

    // Nauka stats
    const sc2=document.getElementById('stat-cards2');
    if(sc2) sc2.textContent=cards;
    const sm=document.getElementById('stat-minutes');
    if(sm) sm.textContent=minutes;

    // AI Partner usage
    const chatUsed=getChatUsageToday?getChatUsageToday():0;
    const chatEl=document.getElementById('stat-chat');
    if(chatEl) chatEl.textContent=chatUsed;
    const chatBar=document.getElementById('chat-usage-bar');
    if(chatBar) chatBar.style.width=Math.min(100,Math.round(chatUsed/15*100))+'%';

    // Wyzwanie
    const challenges=[
      {name:'Mistrz Podróży 🗺️',goal:50},
      {name:'Biznes Pro 💼',goal:40},
      {name:'Naukowy Umysł 🔬',goal:30}
    ];
    const week=Math.floor(Date.now()/604800000)%challenges.length;
    const ch=challenges[week];
    const myProgress=Math.min(ch.goal,Math.floor(cards%ch.goal));
    const chName=document.getElementById('stat-challenge-name');
    const chProg=document.getElementById('stat-challenge-progress');
    const chBar=document.getElementById('stat-challenge-bar');
    if(chName) chName.textContent=ch.name;
    if(chProg) chProg.textContent=myProgress+' / '+ch.goal+' słów';
    if(chBar) chBar.style.width=Math.round(myProgress/ch.goal*100)+'%';

    // Odznaki
    const badges=[];
    if(streak>=3) badges.push({icon:'🔥',name:'Ogień x3',desc:'3-dniowy streak'});
    if(streak>=7) badges.push({icon:'💎',name:'Diament',desc:'7-dniowy streak'});
    if(cards>=100) badges.push({icon:'📚',name:'Czytelnik',desc:'100 fiszek'});
    if(cards>=500) badges.push({icon:'🧠',name:'Erudyta',desc:'500 fiszek'});
    if(gold>=1000) badges.push({icon:'🪙',name:'Kolekcjoner',desc:'1000 złota'});
    if(minutes>=60) badges.push({icon:'⏰',name:'Godzina nauki',desc:'60 minut'});
    const badgesEl=document.getElementById('stat-badges');
    if(badgesEl){
      if(badges.length){
        badgesEl.innerHTML=badges.map(function(b){
          return'<div style="text-align:center;padding:8px 12px;background:var(--paper2);border-radius:10px;border:1px solid var(--border)">'
            +'<div style="font-size:24px">'+b.icon+'</div>'
            +'<div style="font-size:11px;font-weight:600;color:var(--navy);margin-top:2px">'+b.name+'</div>'
            +'<div style="font-size:10px;color:var(--dim2)">'+b.desc+'</div>'
            +'</div>';
        }).join('');
      } else {
        badgesEl.innerHTML='<div style="font-size:12px;color:var(--dim2)">Brak odznak — zacznij się uczyć! 🚀</div>';
      }
    }
  }

  // Głosówki
  try{
    const{data:vr}=await db.from('voice_recordings').select('id,rating_pronunciation_avg,rating_count').eq('user_id',user.id);
    const svEl=document.getElementById('stat-voices');
    if(svEl) svEl.textContent=(vr||[]).length;
    const svRating=document.getElementById('stat-voices-rating');
    if(svRating&&vr&&vr.length){
      const avgRating=vr.reduce(function(sum,r){return sum+(r.rating_pronunciation_avg||0);},0)/vr.length;
      svRating.textContent='Śr. ocena wymowy: '+avgRating.toFixed(1)+' ⭐';
    }
  }catch(e){}

  // Status premium z profiles
  const{data:p}=await db.from('profiles').select('is_premium,premium_until,levels_bought,username').eq('user_id',user.id).maybeSingle();
  const now=new Date();
  const until=p?.premium_until?new Date(p.premium_until):null;
  const isPremium=p?.is_premium&&until&&until>now;
  const se=document.getElementById('dash-status');
  if(isPremium){
    const days=Math.ceil((until-now)/(1000*60*60*24));
    se.textContent=`🏆 Premium (${days}d)`;
    se.style.color='#16a34a';
    document.getElementById('premium-card').style.display='none';
  } else {
    se.textContent='🔒 Darmowy';
    se.style.color='';
  }

  // Pseudonim
  if(p?.username) document.getElementById('dash-name').textContent=p.username+' 👋';

  // Postęp językowy
  loadLangProgress(user.id, p?.levels_bought||[]);

  // Aktywność (symulowana z danych)
  loadActivityChart(s);
}

async function loadLangProgress(uid, levelsBought){
  const el=document.getElementById('lang-progress');
  if(!el)return;
  const langs=[
    {code:'en',label:'🇬🇧 Angielski'},
    {code:'es',label:'🇪🇸 Hiszpański'},
    {code:'jp',label:'🇯🇵 Japoński'},
    {code:'nl',label:'🇳🇱 Niderlandzki'},
  ];
  const levels=['A1','A2','B1','B2','C1','C2'];
  el.innerHTML=langs.map(lang=>{
    const bought=levels.filter(lv=>levelsBought.includes(`${lang.code}_${lv}`)).length;
    const pct=Math.round(bought/6*100);
    return `<div class="lang-row">
      <div class="lang-row-label">${lang.label}</div>
      <div class="lang-row-track"><div class="lang-row-fill" style="width:${pct}%"></div></div>
      <div class="lang-row-val">${bought}/6</div>
    </div>`;
  }).join('');
}

function loadActivityChart(stats){
  const el=document.getElementById('activity-chart');
  if(!el)return;
  const days=['Pn','Wt','Śr','Cz','Pt','Sb','Nd'];
  const today=new Date().getDay();
  const reorder=i=>(today-6+i+7)%7;
  // Symulujemy dane na podstawie streak i minut
  const streak=stats?.streak_days||0;
  const mins=stats?.minutes_active||0;
  const avgMins=streak>0?Math.round(mins/Math.max(streak,1)):0;
  const bars=days.map((_,i)=>{
    const active=i>=(7-streak)&&streak>0;
    const h=active?Math.max(20,Math.min(100,avgMins*2)):Math.random()<0.2?Math.round(Math.random()*20):0;
    return h;
  });
  const maxH=Math.max(...bars,1);
  el.innerHTML=days.map((d,i)=>{
    const ri=reorder(i);
    const h=bars[ri];
    const pct=Math.round(h/maxH*100);
    return `<div class="act-bar-wrap">
      <div class="act-bar" style="height:${pct}%;opacity:${h>0?'0.85':'0.15'}"></div>
      <div class="act-label">${d}</div>
    </div>`;
  }).join('');
}

function updateNav(li,email){
  const n=document.getElementById('nav-r');
  const tabs=document.getElementById('nav-tabs');
  if(li){
    const initials=(email||'?').substring(0,2).toUpperCase();
    n.innerHTML=`<button id="chat-nav-btn" onclick="toggleChatPanel()" title="Wiadomości" style="position:relative;background:transparent;border:1.5px solid rgba(255,255,255,.2);border-radius:100px;padding:7px 12px;cursor:pointer;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:6px;font-size:13px;transition:.2s"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg><span id="chat-badge" style="position:absolute;top:-4px;right:-4px;background:#e53e3e;color:#fff;font-size:9px;font-weight:800;min-width:15px;height:15px;border-radius:8px;display:none;align-items:center;justify-content:center;padding:0 3px"></span></button><button class="btn btn-ghost" style="padding:8px 16px;font-size:13px" onclick="showPage('dash')">Panel</button><div class="nav-avatar" onclick="showPage('dash')" title="${email}">${initials}</div><button class="btn btn-ghost" style="padding:8px 16px;font-size:13px" onclick="logout()">Wyloguj</button>`;
    if(tabs) tabs.classList.add('visible');
  } else {
    n.innerHTML=`<button class="btn btn-ghost" onclick="showAuth('login')">Zaloguj się</button><button class="btn btn-orange" onclick="showAuth('register')">Zacznij za darmo</button>`;
    if(tabs) tabs.classList.remove('visible');
  }
}

function switchTab(page, btn){
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  if(btn) btn.classList.add('active');
  showPage(page);
}

function setActiveTab(page){
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const btn=document.getElementById('ntab-'+page);
  if(btn) btn.classList.add('active');
}

async function logout(){await db.auth.signOut();updateNav(false);showPage('home')}

async function activateCode(){
  const code=document.getElementById('code-input').value.trim().toUpperCase();
  if(!code){showMsg('code-msg','Wpisz kod.','error');return}
  const btn=document.getElementById('code-btn');btn.disabled=true;document.getElementById('code-btn-text').textContent='...';
  try{
    const{data,error}=await db.rpc('activate_premium_code',{p_code:code});if(error)throw error;
    if(data.success){showMsg('code-msg','🏆 '+data.message,'success');document.getElementById('dash-status').textContent='🏆 Premium';document.getElementById('dash-status').style.color='#16a34a';setTimeout(()=>document.getElementById('premium-card').style.display='none',2000)}
    else showMsg('code-msg','❌ '+data.message,'error');
  }catch(e){showMsg('code-msg','Błąd: '+e.message,'error')}
  btn.disabled=false;document.getElementById('code-btn-text').textContent='Aktywuj';
}

function showModal(name){document.getElementById('modal-'+name).style.display='flex'}

function closeModal(name){document.getElementById('modal-'+name).style.display='none'}

async function handleCreateSet(){
  const{data:{session}}=await db.auth.getSession();
  if(session){showPage('community');setTimeout(()=>{switchMatTab('mine');openCreateSet()},100)}
  else showAuth('register');
}

function handleDownload(e){if(DOWNLOAD_URL==='#'){e.preventDefault();alert('Plik .exe będzie dostępny wkrótce!')}}

// ── Strony Community i Ranking ──
function showPage(name){
  if(name&&name!=='auth'){try{sessionStorage.setItem('eyelingo_page',name);}catch(e){}}
  if(name==='tryb'){name='strefa';setTimeout(function(){if(typeof switchLearnTab==='function')switchLearnTab('tryb');},80);}
  else if(name==='challenge'){name='daily';setTimeout(function(){var s=document.getElementById('daily-challenge-section');if(s)s.scrollIntoView({behavior:'smooth'});if(typeof initChallenge==='function')initChallenge();},100);}
  // Stop any ongoing TTS
  if(typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  // Stop any audio elements
  document.querySelectorAll('audio').forEach(function(a){try{a.pause();a.currentTime=0;}catch(e){}});
  // Update URL hash
  try{history.replaceState(null,'','#'+name);}catch(e){}
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const pg=document.getElementById('page-'+name);
  if(pg){pg.classList.add('active');window.scrollTo(0,0);}
  if(name==='community') loadCommunity();
  if(name==='ranking') loadRanking();
  if(name==='tofix') initToFixPage();
  if(name==='strefa') initStrefa();
  if(name==='odkryj') initOdkryj();
  if(name==='daily') initDaily();
  if(name==='challenge') initChallenge();
  if(name==='tryb') initTrybNauki();
  if(name==='chat') initChat();
  if(name==='teacher') initTeacher();
  if(name==='lyrics') initLyrics();
  if(name==='tutors') initTutors();
  loadNotifications();
  setActiveTab(name);
  return false;
}

// ── Stub functions (safe fallbacks) ──
async function loadNotifications(){
  // Silent — table may not exist
}
async function loadRanking(){
  // Tabele rankingu
  for(const period of ['all','weekly']){
    try{
      const{data}=await db.rpc('get_ranking',{p_period:period});
      if(!data) continue;
      for(const cat of ['gold','streak','words']){
        const el=document.getElementById(`rank-${period}-${cat}`);
        if(!el||!data[cat]) continue;
        el.innerHTML=data[cat].map((r,i)=>`
          <div class="rank-row ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':''}">
            <span class="rank-pos">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</span>
            <span class="rank-name">${r.username}</span>
            <span class="rank-score">${Number(r.score).toLocaleString('pl-PL')}</span>
          </div>
        `).join('');
      }
      // Wyróżnieni z danych globalnych
      if(period==='all'&&data.gold?.length){
        const topGold=data.gold[0];
        document.getElementById('feat-creator').textContent=topGold.username;
        document.getElementById('feat-creator-meta').textContent=`🏺 ${Number(topGold.score).toLocaleString('pl-PL')} złota`;
      }
      if(period==='all'&&data.streak?.length){
        const topStreak=data.streak[0];
        document.getElementById('feat-streak').textContent=topStreak.username;
        document.getElementById('feat-streak-meta').textContent=`🔥 ${topStreak.score} dni z rzędu`;
      }
    }catch(e){console.error(e);}
  }
  // Najlepsze zestawy
  try{
    const{data:sets}=await db.from('user_sets')
      .select('id,name,likes_count,user_id')
      .eq('is_public',true)
      .order('likes_count',{ascending:false})
      .limit(5);
    const el=document.getElementById('rank-top-sets');
    if(el&&sets?.length){
      // Wyróżniony zestaw
      if(sets[0]){
        document.getElementById('feat-set').textContent=sets[0].name;
        document.getElementById('feat-set-meta').textContent=`❤️ ${sets[0].likes_count||0} lajków · by ${sets[0].username||'Nieznany'}`;
      }
      el.innerHTML=sets.map((s,i)=>`
        <div class="rank-row ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':''}">
          <span class="rank-pos">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</span>
          <span class="rank-name">${s.name} <span style="font-size:12px;color:var(--dim2);font-weight:400">by ${s.username||'Nieznany'}</span></span>
          <span class="rank-score">❤️ ${s.likes_count||0}</span>
        </div>
      `).join('');
    }
  }catch(e){console.error(e);}
  // Załaduj panel admina jeśli admin
  const{data:{session}}=await db.auth.getSession();
  // Admin panel moved to admin.html
}

// ── escH global helper ──
function escH(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

function renderStarsDisplay(r){ return window.renderStarsDisplay(r); }

async function initToFixPage(){
  const{data:{session}}=await db.auth.getSession();
  // Zawsze resetuj formularz przy wejściu na stronę
  document.getElementById('fix-form-wrap').innerHTML=`
    <label class="fix-label">Kategoria problemu</label>
    <div class="fix-category">
      <button class="fix-cat-btn" onclick="selectCat(this,'UI/UX')">🎨 UI/UX</button>
      <button class="fix-cat-btn" onclick="selectCat(this,'Płatności')">💳 Płatności</button>
      <button class="fix-cat-btn" onclick="selectCat(this,'Fiszki')">📚 Fiszki</button>
      <button class="fix-cat-btn" onclick="selectCat(this,'Błąd techniczny')">⚙️ Błąd techniczny</button>
      <button class="fix-cat-btn" onclick="selectCat(this,'Inne')">💬 Inne</button>
    </div>
    <label class="fix-label" style="margin-top:16px;display:block">Opis problemu</label>
    <textarea id="fix-desc" class="fi" rows="5" placeholder="Opisz co się dzieje, kiedy się pojawia i jak można to odtworzyć..." style="width:100%;margin-top:8px;resize:vertical;min-height:120px"></textarea>
    <label class="fix-label" style="margin-top:16px;display:block">Screenshot (opcjonalny)</label>
    <input type="file" id="fix-screenshot" accept="image/*" style="margin-top:8px;font-size:13px;color:var(--dim2)">
    <div id="fix-msg" style="margin-top:12px;font-size:13px;text-align:center;color:#c33"></div>
    <button class="btn btn-navy" style="width:100%;margin-top:16px" onclick="submitBugReport()">📤 Wyślij zgłoszenie</button>
  `;
  _fixCategory = null;
  if(!session){
    document.getElementById('fix-form-wrap').innerHTML='<div style="text-align:center;padding:40px 0"><p style="color:var(--dim2);margin-bottom:16px">Zaloguj się aby wysłać zgłoszenie.</p><button class="btn btn-navy" onclick="showAuth(\'login\')">Zaloguj się</button></div>';
  }
}

function selectCat(btn, cat){
  document.querySelectorAll('.fix-cat-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  _fixCategory = cat;
}

async function submitBugReport(){
  const{data:{session}}=await db.auth.getSession();
  if(!session){showToast('Zaloguj się aby wysłać zgłoszenie','error');return;}
  if(!_fixCategory){document.getElementById('fix-msg').textContent='Wybierz kategorię problemu.';return;}
  const desc=document.getElementById('fix-desc').value.trim();
  if(desc.length<10){document.getElementById('fix-msg').textContent='Opisz problem dokładniej (min. 10 znaków).';return;}
  document.getElementById('fix-msg').textContent='Wysyłanie...';
  document.getElementById('fix-msg').style.color='var(--dim2)';
  try{
    const{error}=await db.from('bug_reports').insert({
      user_id:session.user.id,
      email:session.user.email,
      category:_fixCategory,
      description:desc
    });
    if(error)throw error;
    document.getElementById('fix-form-wrap').innerHTML=`
      <div style="text-align:center;padding:40px 0">
        <div style="font-size:48px;margin-bottom:16px">✅</div>
        <h3 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:700;color:var(--navy);margin-bottom:8px">Zgłoszenie wysłane!</h3>
        <p style="color:var(--dim2)">Dziękujemy! Przejrzymy je i poprawimy jak najszybciej.</p>
        <button class="btn btn-navy" style="margin-top:24px" onclick="showPage('tofix')">Wyślij kolejne</button>
      </div>
    `;
  }catch(e){
    document.getElementById('fix-msg').textContent='Błąd: '+e.message;
    document.getElementById('fix-msg').style.color='#c33';
  }
}


function showToast(msg, type){
  type=type||'info';
  var t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 22px;border-radius:100px;font-size:14px;font-weight:600;color:#fff;pointer-events:none;transition:opacity .3s;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.18)';
  t.style.background=type==='success'?'#16a34a':type==='error'?'#dc2626':'var(--navy)';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(function(){t.style.opacity='0';setTimeout(function(){t.remove();},300);},2500);
}
window.showToast=showToast;

function showConfirmModal({title, message, confirmText, cancelText, danger}){
  confirmText=confirmText||'Potwierdź';
  cancelText=cancelText||'Anuluj';
  danger=danger||false;
  return new Promise(function(resolve){
    var ex=document.getElementById('confirm-modal');
    if(ex)ex.remove();
    if(!document.getElementById('cm-style')){
      var st=document.createElement('style');st.id='cm-style';
      st.textContent='@keyframes cmUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}'
        +'@keyframes cmFade{from{opacity:0}to{opacity:1}}'
        +'#confirm-modal{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px}'
        +'#cm-bd{position:absolute;inset:0;background:rgba(26,35,64,.4);animation:cmFade .2s ease;backdrop-filter:blur(4px)}'
        +'#cm-box{position:relative;background:#fff;border-radius:22px;width:100%;max-width:340px;overflow:hidden;box-shadow:0 28px 72px rgba(26,35,64,.16);animation:cmUp .22s cubic-bezier(.34,1.3,.64,1)}'
        +'#cm-body{padding:30px 26px 22px;text-align:center}'
        +'#cm-title{font-family:Syne,sans-serif;font-size:19px;font-weight:800;color:var(--navy);margin-bottom:8px;line-height:1.3}'
        +'#cm-msg{font-size:14px;color:var(--dim2);line-height:1.65}'
        +'#cm-foot{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--border)}'
        +'#cm-cancel{padding:16px;background:none;border:none;border-right:1px solid var(--border);font-size:14px;font-weight:600;color:var(--dim);cursor:pointer;transition:.15s;font-family:inherit}'
        +'#cm-ok{padding:16px;background:none;border:none;font-size:14px;font-weight:700;cursor:pointer;transition:.15s;font-family:inherit}'
        +'#cm-cancel:hover{background:var(--paper2)}'
        +'#cm-ok:hover{background:var(--paper2)}';
      document.head.appendChild(st);
    }
    var modal=document.createElement('div');modal.id='confirm-modal';
    var bd=document.createElement('div');bd.id='cm-bd';modal.appendChild(bd);
    var box=document.createElement('div');box.id='cm-box';
    var body=document.createElement('div');body.id='cm-body';
    var t=document.createElement('div');t.id='cm-title';t.textContent=title;body.appendChild(t);
    var m=document.createElement('div');m.id='cm-msg';m.innerHTML=message;body.appendChild(m);
    box.appendChild(body);
    var foot=document.createElement('div');foot.id='cm-foot';
    var cb=document.createElement('button');cb.id='cm-cancel';cb.textContent=cancelText;
    var ob=document.createElement('button');ob.id='cm-ok';ob.textContent=confirmText;
    ob.style.color=danger?'#dc2626':'var(--orange)';
    foot.appendChild(cb);foot.appendChild(ob);
    box.appendChild(foot);modal.appendChild(box);
    document.body.appendChild(modal);
    function cleanup(r){box.style.animation='cmUp .15s ease reverse';bd.style.animation='cmFade .15s ease reverse';setTimeout(function(){modal.remove();},140);resolve(r);}
    ob.onclick=function(){cleanup(true);};cb.onclick=function(){cleanup(false);};
    bd.onclick=function(){cleanup(false);};
    function onKey(e){if(e.key==='Escape'){cleanup(false);document.removeEventListener('keydown',onKey);}}
    document.addEventListener('keydown',onKey);
  });
}
window.showConfirmModal=showConfirmModal;

function switchLearnTab(tab){
  var panels={tryb:'learn-panel-tryb',strefa:'learn-panel-strefa'};
  var btns={tryb:'learn-tab-tryb',strefa:'learn-tab-strefa'};
  Object.keys(panels).forEach(function(key){
    var panel=document.getElementById(panels[key]);
    var btn=document.getElementById(btns[key]);
    if(panel)panel.style.display=key===tab?'block':'none';
    if(btn){
      if(key===tab){btn.style.background='var(--navy)';btn.style.color='#fff';btn.style.fontWeight='700';}
      else{btn.style.background='transparent';btn.style.color='var(--dim)';btn.style.fontWeight='600';}
    }
  });
  if(tab==='tryb'){
    if(typeof initTrybNauki==='function')initTrybNauki();
  }
  if(tab==='strefa'&&typeof initStrefa==='function')initStrefa();
}
window.switchLearnTab=switchLearnTab;

// Override navHome to scroll to top when already on home
window.navHome=function(){
  if(document.getElementById('page-home')&&document.getElementById('page-home').classList.contains('active')){
    window.scrollTo({top:0,behavior:'smooth'});
  } else {
    showPage('home');window.scrollTo({top:0,behavior:'smooth'});
  }
  return false;
};

// ── Session restore ──
document.addEventListener('DOMContentLoaded',async function(){
  try{
    var res=await db.auth.getSession();
    var session=res.data.session;
    if(session){
      await loadDashboard();
      var last=sessionStorage.getItem('eyelingo_page')||'home';
      var valid=['home','dash','community','daily','challenge','chat','teacher','lyrics','tutors','tryb','strefa','odkryj','ranking','tofix'];
      showPage(valid.includes(last)?last:'home');
    } else {
      showPage('home');
    }
  }catch(e){showPage('home');}
});
