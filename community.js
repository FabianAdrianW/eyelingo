// Eyelingo — Community

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
