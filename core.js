// Eyelingo — core.js

const SUPABASE_URL='https://sntlgkhktscezxpxrchl.supabase.co';
const SUPABASE_KEY='sb_publishable_30dSE4_odIFOYk0k2mJ-lg_xjqv32V8';
const DOWNLOAD_URL='#';
const{createClient}=supabase;
const db=createClient(SUPABASE_URL,SUPABASE_KEY);
function getChatUsageToday(){try{return parseInt(localStorage.getItem('chat_usage_'+new Date().toISOString().slice(0,10))||'0');}catch(e){return 0;}}
// Global escH helper — available in all script blocks
window.escH = function(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
// ── renderStarsDisplay — global ──
window.renderStarsDisplay = function(rating){
  var full=Math.floor(rating||0);
  var half=(rating||0)-full>=0.5;
  var html='';
  for(var i=0;i<5;i++){
    if(i<full) html+='<span style="color:#f5c842;font-size:14px">★</span>';
    else if(i===full&&half) html+='<span style="color:#f5c842;font-size:14px">½</span>';
    else html+='<span style="color:#ddd;font-size:14px">★</span>';
  }
  return html;
};
function renderStarsDisplay(r){ return window.renderStarsDisplay(r); }


let authMode='login';

function _showPageBasic(n){document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));const p=document.getElementById('page-'+n);if(p)p.classList.add('active');window.scrollTo(0,0)}
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

document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.getElementById('page-auth').classList.contains('active'))submitAuth()});

// ── Strony Community i Ranking ──
function showPage(name){
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
  // Ładuj powiadomienia jeśli panel istnieje
  try{
    var panel=document.getElementById('notif-panel');
    var badge=document.getElementById('notif-badge');
    if(!panel&&!badge) return;
    var sess=(await db.auth.getSession()).data.session;
    if(!sess) return;
    var{data:notifs}=await db.from('notifications')
      .select('id,type,message,read_at,created_at')
      .eq('user_id',sess.user.id)
      .order('created_at',{ascending:false})
      .limit(20);
    if(!notifs) return;
    var unread=notifs.filter(function(n){return !n.read_at;}).length;
    if(badge) badge.textContent=unread||'';
    if(badge) badge.style.display=unread?'flex':'none';
    if(panel){
      var icon={voice_rated:'🎙️',voice_commented:'💬',material_liked:'❤️',streak:'🔥',gold:'🪙',review:'⭐'};
      panel.innerHTML=notifs.length
        ?notifs.map(function(n){
          return'<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start;'+(n.read_at?'opacity:.6':'')+'">'
            +'<span style="font-size:18px">'+(icon[n.type]||'🔔')+'</span>'
            +'<div><div style="font-size:13px;color:var(--navy)">'+(n.message||'')+'</div>'
            +'<div style="font-size:11px;color:var(--dim2)">'+ new Date(n.created_at).toLocaleDateString('pl')+'</div></div>'
            +'</div>';
        }).join('')
        :'<div style="padding:20px;text-align:center;color:var(--dim2);font-size:13px">Brak powiadomień</div>';
    }
  }catch(e){ /* silent */ }
}

// ── Materiały - stan globalny ──
let _likedSets = new Set();
let _addedSets = new Set();
let _matSets = [];
let _matMyUid = null;
let _matTab = 'community';
let _matModal = null;
let _matEditMode = false;

async function loadCommunity(){
  document.getElementById('mat-grid').innerHTML='<div class="mat-empty">Ładowanie...</div>';
  try{
    const{data:{session}}=await db.auth.getSession();
    _matMyUid=session?.user?.id||null;

    // Pobierz publiczne zestawy
    const{data,error}=await db.from('user_sets')
      .select('id,name,likes_count,user_id,created_at,is_public,user_set_cards(id,word,translation)')
      .eq('is_public',true)
      .order('likes_count',{ascending:false})
      .limit(60);
    if(error)throw error;

    // Pobierz usernames osobno
    const userIds=[...new Set((data||[]).map(s=>s.user_id))];
    let usernameMap={};
    if(userIds.length){
      const{data:profiles}=await db.from('profiles')
        .select('user_id,username')
        .in('user_id',userIds);
      (profiles||[]).forEach(p=>usernameMap[p.user_id]=p.username);
    }

    // Pobierz lajki użytkownika
    _likedSets=new Set();
    if(_matMyUid){
      const{data:likes}=await db.from('set_likes')
        .select('set_id')
        .eq('user_id',_matMyUid);
      if(likes) likes.forEach(l=>_likedSets.add(l.set_id));
    }

    const now=Date.now();
    _matSets=(data||[]).map(s=>{
      const age=(now-new Date(s.created_at).getTime())/(1000*3600);
      const hot=(s.likes_count||0)/Math.pow(age+2,1.5);
      return{...s,_hot:hot,username:usernameMap[s.user_id]||'Nieznany'};
    }).sort((a,b)=>b._hot-a._hot);

    renderMat();
  }catch(e){
    showMatError('Błąd: '+e.message);
    console.error('[loadCommunity]',e);
  }
}

async function loadMySets(){
  const{data:{session}}=await db.auth.getSession();
  if(!session){
    document.getElementById('mat-grid').innerHTML='<div class="mat-empty">Zaloguj się aby zobaczyć swoje zestawy.<br><br><button class="btn btn-navy" onclick="showAuth(\'login\')" style="margin-top:8px">Zaloguj się</button></div>';
    const countEl=document.getElementById('mat-count');
    if(countEl) countEl.textContent='';
    return;
  }
  _matMyUid=session.user.id;
  const{data,error}=await db.from('user_sets')
    .select('id,name,likes_count,is_public,created_at,user_set_cards(id,word,translation)')
    .eq('user_id',_matMyUid)
    .order('created_at',{ascending:false});
  if(error){showMatError(error.message);return;}
  const{data:profile}=await db.from('profiles').select('username').eq('user_id',_matMyUid).maybeSingle();
  const username=profile?.username||'Ty';
  _matSets=(data||[]).map(s=>({...s,username,user_id:_matMyUid}));
  renderMat();
}

function renderMat(query=''){
  const el=document.getElementById('mat-grid');
  const countEl=document.getElementById('mat-count');
  if(!el)return;
  let filtered=_matSets;
  if(query){
    const q=query.toLowerCase();
    filtered=_matSets.filter(s=>
      s.name.toLowerCase().includes(q)||
      (s.username||'').toLowerCase().includes(q)
    );
  }
  if(countEl) countEl.textContent=filtered.length?`${filtered.length} zestaw${filtered.length===1?'':'ów'}`:'';
  if(!filtered.length){
    el.innerHTML=`<div class="mat-empty">${query?`Brak wyników dla "${query}"`
      :_matTab==='mine'?'Nie masz jeszcze żadnych zestawów.'
      :'Brak publicznych zestawów.'}</div>`;
    return;
  }
  el.innerHTML=filtered.map(s=>setCard(s)).join('');
}

function filterMat(q){renderMat(q)}

function setCard(s){
  const isOwn = s.user_id === _matMyUid;
  const isMineTab = _matTab === 'mine';
  const cards = s.user_set_cards || [];
  const liked = _likedSets.has(s.id);
  const added = _addedSets.has(s.id);

  const preview = cards.slice(0,3).map(c=>`
    <div class="mat-preview-row">
      <span class="mat-pf">${esc(c.word)}</span>
      <span class="mat-pb">${esc(c.translation)}</span>
    </div>`).join('');

  // Lajk — zawsze widoczny, ale nie można lajkować własnych
  const likeBtn = `
    <div class="mat-card-likes${liked?' liked':''}" id="like-btn-${s.id}"
      onclick="event.stopPropagation();toggleLike(${s.id})"
      title="${isOwn?'Nie możesz lajkować własnych zestawów':liked?'Usuń lajk':'Dodaj lajk'}">
      ${liked?'❤️':'🤍'} <span id="like-count-${s.id}">${s.likes_count||0}</span>
    </div>`;

  // Stopka zależy od zakładki
  let foot = '';
  if(isMineTab){
    // Moje zestawy: edytuj + usuń + publiczny/prywatny
    foot = `
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
        <button class="mat-pub-toggle ${s.is_public?'pub':'priv'}"
          onclick="event.stopPropagation();quickTogglePublic(${s.id},this)">
          ${s.is_public?'🌐 Publiczny':'🔒 Prywatny'}
        </button>
        <div class="mat-card-actions">
          <button class="mat-btn-edit" onclick="event.stopPropagation();openEditSet(${s.id})">✏️ Edytuj</button>
          <button class="mat-btn-del" onclick="event.stopPropagation();deleteSet(${s.id})">🗑️ Usuń</button>
        </div>
      </div>`;
  } else {
    // Społeczność: tylko "Dodaj do moich zestawów" (nie dla własnych)
    if(!isOwn){
      foot = `
        <button class="mat-btn-add${added?' added':''}" id="add-btn-${s.id}"
          onclick="event.stopPropagation();addSetToMine(${s.id})"
          ${added?'disabled':''}>
          ${added?'✓ Dodano do zestawów':'+ Dodaj do zestawów'}
        </button>`;
    }
  }

  return `
    <div class="mat-card" onclick="openSet(${s.id})">
      <div class="mat-card-head">
        <div>
          <div class="mat-card-name">${esc(s.name)}</div>
          <div class="mat-card-meta">
            by ${s.username||'Nieznany'} · ${cards.length} fiszek
          </div>
        </div>
        ${likeBtn}
      </div>
      ${preview?`<div class="mat-preview">${preview}</div>`:''}
      ${foot?`<div class="mat-card-foot">${foot}</div>`:''}
    </div>`;
}

async function quickTogglePublic(id, btn){
  const s = _matSets.find(x=>x.id===id);
  if(!s) return;
  // Blokuj zestawy zaimportowane z wyzwań i artykułów
  if(s.name&&(s.name.includes('(mój)')||s.name.includes('🏆'))){
    showToast('Zaimportowane zestawy nie mogą być publiczne.','error');
    return;
  }
  const newVal = !s.is_public;
  await db.from('user_sets').update({is_public:newVal}).eq('id',id);
  s.is_public = newVal;
  btn.className = `mat-pub-toggle ${newVal?'pub':'priv'}`;
  btn.textContent = newVal?'🌐 Publiczny':'🔒 Prywatny';
}

function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

async function openSet(id){
  const s=_matSets.find(x=>x.id===id);
  if(!s)return;
  _matModal=s; _matEditMode=false;
  showSetModal(s,false);
}

function showSetModal(s,editMode){
  const cards=s.user_set_cards||[];
  const isOwn=s.user_id===_matMyUid;
  document.getElementById('mat-modal-title').textContent=editMode?'Edytuj zestaw':s.name;
  document.getElementById('mat-modal-body').innerHTML=editMode?renderEditForm(s):renderViewCards(cards,s,isOwn);
  document.getElementById('mat-modal').style.display='flex';
}

function renderViewCards(cards, s, isOwn){
  const isMineTab = _matTab === 'mine';
  const liked = _likedSets.has(s.id);
  const added = _addedSets.has(s.id);
  return `
    <div class="mat-modal-meta">
      by ${s.username||'Nieznany'} · ${cards.length} fiszek
      <span class="mat-card-likes${liked?' liked':''}" style="display:inline-flex;margin-left:8px;cursor:pointer"
        onclick="toggleLike(${s.id});this.textContent=(window._likedSets?.has(${s.id})?'❤️':'🤍')+' '+(${s.likes_count||0}+(window._likedSets?.has(${s.id})?1:-1))">
        ${liked?'❤️':'🤍'} ${s.likes_count||0}
      </span>
    </div>
    <div class="mat-modal-cards">
      ${cards.map(c=>`
        <div class="mat-modal-row">
          <span>${esc(c.word)}</span>
          <span class="mat-modal-tr">${esc(c.translation)}</span>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
      <button class="btn btn-orange" style="flex:1;min-width:140px;font-weight:700;font-size:15px" onclick="closeMatModal();startTrybNauki(${JSON.stringify(cards).replace(/"/g,'&quot;')},${JSON.stringify(s.name).replace(/"/g,'&quot;')})">📚 Ucz się</button>
      ${isMineTab?`
        <button class="btn btn-navy" onclick="switchToEdit()">✏️ Edytuj</button>
        <button class="mat-btn-del" style="padding:10px 18px" onclick="deleteSet(${s.id})">🗑️ Usuń</button>
        <button class="mat-pub-toggle ${s.is_public?'pub':'priv'}" onclick="togglePublic(${s.id})">
          ${s.is_public?'🌐 Publiczny':'🔒 Prywatny'}
        </button>
      `:`
        ${!isOwn?`<button class="btn btn-navy" style="flex:1" id="modal-add-btn"
          onclick="addSetToMine(${s.id})" ${added?'disabled':''}>
          ${added?'✓ Dodano do zestawów':'+ Dodaj do moich zestawów'}
        </button>`:''}
      `}
    </div>`;
}

function renderEditForm(s){
  const cards=s.user_set_cards||[];
  return `
    <div style="margin-bottom:12px">
      <label style="font-size:12px;color:var(--dim2);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Nazwa zestawu</label>
      <input id="edit-name" class="fi" value="${esc(s.name)}" style="width:100%;margin-top:4px">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">
      <span>Słowo / pytanie</span><span>Tłumaczenie / odpowiedź</span>
    </div>
    <div id="edit-rows" style="display:flex;flex-direction:column;gap:6px;max-height:320px;overflow-y:auto">
      ${cards.map((c,i)=>`
        <div class="edit-row" data-id="${c.id}">
          <input class="fi edit-word" value="${esc(c.word)}" placeholder="słowo">
          <input class="fi edit-translation" value="${esc(c.translation)}" placeholder="tłumaczenie">
          <button onclick="removeEditRow(this)" style="background:rgba(200,50,50,.15);border:none;border-radius:6px;width:28px;cursor:pointer;color:#c33">✕</button>
        </div>
      `).join('')}
    </div>
    <button onclick="addEditRow()" style="margin-top:8px;background:transparent;border:1px dashed var(--dim2);border-radius:8px;padding:8px;width:100%;cursor:pointer;color:var(--dim2);font-size:13px">+ Dodaj wiersz</button>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-navy" onclick="saveEdit(${s.id})" style="flex:1">💾 Zapisz</button>
      <button class="btn btn-ghost" onclick="switchToView()" style="flex:1">Anuluj</button>
    </div>
  `;
}

async function openEditSet(id){
  let s=_matSets.find(x=>x.id===id);
  if(!s)return;
  if(!s.user_set_cards||!s.user_set_cards.length){
    const{data}=await db.from('user_set_cards')
      .select('id,word,translation,sort_order')
      .eq('set_id',id)
      .order('sort_order');
    s.user_set_cards=data||[];
  }
  _matModal=s; _matEditMode=true;
  document.getElementById('mat-modal-title').textContent='Edytuj zestaw';
  document.getElementById('mat-modal-body').innerHTML=renderEditForm(s);
  document.getElementById('mat-modal').style.display='flex';
}

function switchToEdit(){_matEditMode=true;showSetModal(_matModal,true)}
function switchToView(){_matEditMode=false;showSetModal(_matModal,false)}

function addEditRow(){
  const row=document.createElement('div');
  row.className='edit-row';
  row.innerHTML=`<input class="fi edit-word" placeholder="słowo"><input class="fi edit-translation" placeholder="tłumaczenie"><button onclick="removeEditRow(this)" style="background:rgba(200,50,50,.15);border:none;border-radius:6px;width:28px;cursor:pointer;color:#c33">✕</button>`;
  document.getElementById('edit-rows').appendChild(row);
}
function removeEditRow(btn){btn.closest('.edit-row').remove()}

async function saveEdit(setId){
  const name=document.getElementById('edit-name').value.trim();
  if(!name){alert('Wpisz nazwę zestawu');return}
  const rows=[...document.querySelectorAll('.edit-row')];
  const cards=rows.map(r=>({
    word:r.querySelector('.edit-word').value.trim(),
    translation:r.querySelector('.edit-translation').value.trim()
  })).filter(c=>c.word&&c.translation);
  if(!cards.length){alert('Dodaj co najmniej jedną fiszkę');return}
  try{
    await db.from('user_sets').update({name}).eq('id',setId);
    await db.from('user_set_cards').delete().eq('set_id',setId);
    await db.from('user_set_cards').insert(cards.map((c,i)=>({set_id:setId,word:c.word,translation:c.translation,sort_order:i})));
    closeMatModal();
    _matTab==='mine'?loadMySets():loadCommunity();
  }catch(e){alert('Błąd: '+e.message)}
}

async function deleteSet(id){
  if(!confirm('Usunąć ten zestaw? Tej operacji nie można cofnąć.'))return;
  await db.from('user_sets').delete().eq('id',id);
  closeMatModal();
  _matTab==='mine'?loadMySets():loadCommunity();
}

async function togglePublic(id){
  const s=_matSets.find(x=>x.id===id);
  if(!s)return;
  const newVal=!s.is_public;
  await db.from('user_sets').update({is_public:newVal}).eq('id',id);
  s.is_public=newVal;
  s.user_set_cards=s.user_set_cards||[];
  showSetModal(s,false);
  _matTab==='mine'?loadMySets():loadCommunity();
}

async function toggleLike(setId){
  const{data:{session}}=await db.auth.getSession();
  if(!session){showToast('Zaloguj się aby lajkować','error');return;}
  try{
    const{data,error}=await db.rpc('toggle_like',{p_set_id:setId});
    if(error)throw error;
    if(!data)return;
    if(data.liked){_likedSets.add(setId)}else{_likedSets.delete(setId)}
    const s=_matSets.find(x=>x.id===setId);
    if(s) s.likes_count=(s.likes_count||0)+(data.liked?1:-1);
    const btn=document.getElementById(`like-btn-${setId}`);
    if(btn){
      btn.className='mat-card-likes'+(data.liked?' liked':'');
      btn.innerHTML=`${data.liked?'❤️':'🤍'} <span id="like-count-${setId}">${s?.likes_count||0}</span>`;
    }
    if(data.reward>0) showToast(`🏺 Gratulacje! Otrzymałeś ${data.reward.toLocaleString('pl-PL')} złota!`,'success');
  }catch(e){showToast('Błąd: '+e.message,'error')}
}

async function addSetToMine(setId){
  const{data:{session}}=await db.auth.getSession();
  if(!session){showToast('Zaloguj się aby dodać zestaw','error');return;}
  if(_addedSets.has(setId))return;
  _addedSets.add(setId);
  const btn=document.getElementById(`add-btn-${setId}`);
  if(btn){btn.disabled=true;btn.textContent='✓ Dodano do zestawów';btn.classList.add('added');}
  showToast('✅ Zestaw dodany do Twoich materiałów!','success');
}

let _createIsPublic = false;

function openCreateSet(){
  _createIsPublic = false;
  document.getElementById('mat-modal-title').textContent='Nowy zestaw';
  document.getElementById('mat-modal-body').innerHTML=`
    <div style="margin-bottom:10px">
      <label style="font-size:12px;color:var(--dim2);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Nazwa zestawu</label>
      <input id="create-name" class="fi" placeholder="np. Angielski – sprawdzian" style="width:100%;margin-top:4px">
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="display:grid;grid-template-columns:1fr 1fr 28px;gap:6px;flex:1;font-size:11px;font-weight:700;color:var(--dim2);text-transform:uppercase;letter-spacing:.5px">
        <span>Słowo / pytanie</span><span>Tłumaczenie / odpowiedź</span><span></span>
      </div>
    </div>
    <div id="create-rows" style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto"></div>
    <div style="margin-top:8px;font-size:12px;color:var(--dim2)">💡 Naciśnij <kbd style="background:rgba(0,0,0,.08);padding:1px 6px;border-radius:4px;font-family:monospace">Tab</kbd> aby szybko dodać nowy wiersz</div>
    <button onclick="addCreateRow()" style="margin-top:8px;background:transparent;border:1px dashed var(--dim2);border-radius:8px;padding:8px;width:100%;cursor:pointer;color:var(--dim2);font-size:13px">+ Dodaj wiersz</button>
    <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
      <button id="create-pub-btn" onclick="toggleCreatePublic()" style="border:1px solid rgba(100,100,120,.3);background:rgba(100,100,120,.08);color:var(--dim2);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;transition:.2s">🔒 Prywatny</button>
      <button class="btn btn-orange" style="flex:1" onclick="saveNewSet()">💾 Stwórz zestaw</button>
    </div>
    <div id="create-msg" style="margin-top:8px;font-size:13px;text-align:center;color:#c33"></div>
  `;
  document.getElementById('mat-modal').style.display='flex';
  // Dodaj 5 domyślnych wierszy
  for(let i=0;i<5;i++) addCreateRow();
  // Focus na pierwszym polu
  setTimeout(()=>{const f=document.querySelector('#create-rows .cr-word');if(f)f.focus()},50);
}

function addCreateRow(){
  const row=document.createElement('div');
  row.className='edit-row';
  row.style.cssText='display:grid;grid-template-columns:1fr 1fr 28px;gap:6px;align-items:center';
  const wInp=document.createElement('input');
  wInp.className='fi cr-word';wInp.placeholder='słowo';
  const tInp=document.createElement('input');
  tInp.className='fi cr-tr';tInp.placeholder='tłumaczenie';
  const del=document.createElement('button');
  del.textContent='✕';del.style.cssText='background:rgba(200,50,50,.15);border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;color:#c33;font-size:11px';
  del.onclick=()=>row.remove();
  // TAB z ostatniego pola tłumaczenia → nowy wiersz
  // TAB from word input -> translation input
  wInp.addEventListener('keydown',e=>{
    if(e.key==='Tab'&&!e.shiftKey){
      e.preventDefault();
      tInp.focus();
    }
  });
  // TAB from translation input -> next word input or new row
  tInp.addEventListener('keydown',e=>{
    if(e.key==='Tab'&&!e.shiftKey){
      const rows=[...document.querySelectorAll('#create-rows .edit-row')];
      if(row===rows[rows.length-1]){
        e.preventDefault();
        addCreateRow();
        setTimeout(()=>{const last=document.querySelectorAll('#create-rows .cr-word');if(last.length)last[last.length-1].focus()},20);
      } else {
        e.preventDefault();
        const nextRow=rows[rows.indexOf(row)+1];
        if(nextRow){const nextWord=nextRow.querySelector('.cr-word');if(nextWord)nextWord.focus();}
      }
    }
  });
  // Prevent TAB on delete button
  del.setAttribute('tabindex','-1');
  row.append(wInp,tInp,del);
  document.getElementById('create-rows').appendChild(row);
}

function toggleCreatePublic(){
  _createIsPublic=!_createIsPublic;
  const btn=document.getElementById('create-pub-btn');
  if(_createIsPublic){
    btn.textContent='🌐 Publiczny';
    btn.style.cssText='border:1px solid rgba(22,163,74,.3);background:rgba(22,163,74,.1);color:#16a34a;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;transition:.2s';
  } else {
    btn.textContent='🔒 Prywatny';
    btn.style.cssText='border:1px solid rgba(100,100,120,.3);background:rgba(100,100,120,.08);color:var(--dim2);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px;font-weight:600;transition:.2s';
  }
}

async function saveNewSet(){
  const{data:{session}}=await db.auth.getSession();
  if(!session){showAuth('login');return;}
  const name=document.getElementById('create-name').value.trim();
  if(!name){document.getElementById('create-msg').textContent='Wpisz nazwę zestawu.';return;}
  const rows=[...document.querySelectorAll('#create-rows .edit-row')];
  const cards=rows.map(r=>({
    word:r.querySelector('.cr-word').value.trim(),
    translation:r.querySelector('.cr-tr').value.trim()
  })).filter(c=>c.word&&c.translation);
  if(cards.length<1){document.getElementById('create-msg').textContent='Dodaj co najmniej jedną fiszkę.';return;}
  try{
    const{data:setData,error:se}=await db.from('user_sets').insert({
      user_id:session.user.id,name,is_public:_createIsPublic
    }).select().single();
    if(se)throw se;
    const{error:ce}=await db.from('user_set_cards').insert(
      cards.map((c,i)=>({set_id:setData.id,word:c.word,translation:c.translation,sort_order:i}))
    );
    if(ce)throw ce;
    closeMatModal();
    showToast('✅ Zestaw został utworzony!','success');
    switchMatTab('mine');
  }catch(e){document.getElementById('create-msg').textContent='Błąd: '+e.message;}
}

function closeMatModal(){document.getElementById('mat-modal').style.display='none';_matModal=null}

async function switchMatTab(tab){
  _matTab=tab;
  document.querySelectorAll('.mat-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  const createBtn=document.getElementById('mat-create-btn');
  if(createBtn) createBtn.style.display=(tab==='mine'&&_matMyUid)?'block':'none';
  const search=document.getElementById('mat-search');
  if(search) search.value='';
  const grid=document.getElementById('mat-grid');
  const voicesPanel=document.getElementById('mat-voices');
  if(tab==='voices'){
    if(grid) grid.style.display='none';
    if(voicesPanel) voicesPanel.style.display='block';
    loadVoiceRecordings();
    return;
  }
  if(grid) grid.style.display='grid';
  if(voicesPanel) voicesPanel.style.display='none';
  grid.innerHTML='<div class="mat-empty">Ładowanie...</div>';
  tab==='mine'?await loadMySets():await loadCommunity();
}

function showMatError(msg){
  const el=document.getElementById('mat-grid');
  if(el)el.innerHTML=`<div class="mat-empty" style="color:#f87">${msg}</div>`;
}

function showToast(msg,type='info'){
  const t=document.createElement('div');
  t.className=`toast toast-${type}`;t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('show'),10);
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300)},3500);
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

(async()=>{
  const{data:{session}}=await db.auth.getSession();
  if(session){await loadDashboard();showPage('dash')}
  // Obsługa parametru ?page= i hash routing
  const urlParams=new URLSearchParams(window.location.search);
  const pg=urlParams.get('page');
  const hash=window.location.hash.slice(1);
  const validHashes=['home','dash','community','daily','challenge','chat','teacher','strefa','odkryj','tutors','ranking','tofix','lyrics'];

  // Check session and redirect
  db.auth.getSession().then(function(res){
    var session=res.data&&res.data.session;
    if(session){
      loadDashboard().then(function(){
        // Restore from hash or query param
        var target = hash&&validHashes.includes(hash)?hash : pg==='community'?'community':pg==='ranking'?'ranking':'dash';
        showPage(target);
      });
    } else {
      // Not logged in — go to hash if valid and public, else home
      var publicPages=['home','tutors'];
      if(hash&&publicPages.includes(hash)) showPage(hash);
      else if(pg==='community') showPage('community');
    }
  });
})();


let _fixCategory = '';

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

