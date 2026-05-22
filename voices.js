// Eyelingo — voices.js
async function loadVoiceRecordings(){
  var el = document.getElementById('mat-voices-list');
  if(!el) return;

  // Buduj filtry języka jeśli nie ma
  var voicesPanel = document.getElementById('mat-voices');
  if(voicesPanel && !document.getElementById('voices-lang-filter')){
    var filterBar = document.createElement('div');
    filterBar.style.cssText='display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap';
    filterBar.id='voices-lang-filter';
    var langs=[
      {code:'en',label:'🇬🇧 Angielski'},
      {code:'es',label:'🇪🇸 Hiszpański'},
      {code:'nl',label:'🇳🇱 Holenderski'},
      {code:'jp',label:'🇯🇵 Japoński'},
      {code:'de',label:'🇩🇪 Niemiecki'},
      {code:'fr',label:'🇫🇷 Francuski'}
    ];
    langs.forEach(function(l){
      var btn=document.createElement('button');
      btn.style.cssText='padding:6px 14px;border-radius:100px;border:1.5px solid var(--border);background:'+(l.code===_voicesLang?'var(--navy)':'var(--paper2)')+';color:'+(l.code===_voicesLang?'#fff':'var(--navy)')+';font-size:12px;font-weight:600;cursor:pointer;transition:.2s';
      btn.id='vfbtn-'+l.code;
      btn.textContent=l.label;
      btn.onclick=function(){
        _voicesLang=l.code;
        document.querySelectorAll('[id^="vfbtn-"]').forEach(function(b){
          b.style.background='var(--paper2)';b.style.color='var(--navy)';
        });
        btn.style.background='var(--navy)';btn.style.color='#fff';
        loadVoiceRecordings();
      };
      filterBar.appendChild(btn);
    });
    voicesPanel.insertBefore(filterBar, el);
  }

  el.innerHTML='<div style="color:var(--dim2);font-size:13px;padding:20px">Ładowanie głosówek...</div>';

  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){el.innerHTML='<div style="color:var(--dim2);font-size:13px;padding:20px">Zaloguj się aby zobaczyć głosówki</div>';return;}

    var {data:recs,error}=await db.from('voice_recordings')
      .select('id,user_id,word,sentence,language,audio_url,rating_pronunciation_avg,rating_correctness_avg,rating_count,created_at')
      .eq('language',_voicesLang)
      .order('created_at',{ascending:false})
      .limit(30);

    if(error){el.innerHTML='<div style="color:#c33;font-size:13px;padding:20px">Błąd: '+error.message+'</div>';return;}
    if(!recs||!recs.length){
      el.innerHTML='<div style="color:var(--dim2);font-size:14px;padding:30px;text-align:center">'
        +'<div style="font-size:36px;margin-bottom:12px">🎙️</div>'
        +'Brak głosówek dla tego języka.<br>Nagraj pierwszą w Strefie Nauki!</div>';
      return;
    }

    // Pobierz profile (username + avatar)
    var uids=[...new Set(recs.map(function(r){return r.user_id;}))];
    var profMap={};
    try{
      var {data:profs}=await db.from('profiles').select('user_id,username,avatar_url').in('user_id',uids);
      (profs||[]).forEach(function(p){profMap[p.user_id]=p;});
    }catch(e){}

    var myId=sess.user.id;
    el.innerHTML='';

    recs.forEach(function(rec){
      var prof=profMap[rec.user_id]||{};
      var username=prof.username||'Użytkownik';
      var avatarUrl=prof.avatar_url||'';
      var isOwn=rec.user_id===myId;

      var card=document.createElement('div');
      card.style.cssText='background:#fff;border:1.5px solid var(--border);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:12px';

      // Header: avatar + username + słowo
      var header=document.createElement('div');
      header.style.cssText='display:flex;align-items:center;gap:12px';

      // Avatar
      var avEl=document.createElement('div');
      avEl.style.cssText='width:40px;height:40px;border-radius:50%;background:var(--navy);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center';
      if(avatarUrl){
        avEl.innerHTML='<img src="'+avatarUrl+'" style="width:100%;height:100%;object-fit:cover">';
      } else {
        avEl.innerHTML='<span style="font-size:16px;color:#fff;font-weight:700">'+username[0].toUpperCase()+'</span>';
      }
      header.appendChild(avEl);

      var userInfo=document.createElement('div');
      userInfo.style.cssText='flex:1;min-width:0';
      userInfo.innerHTML='<div style="font-size:13px;font-weight:700;color:var(--navy)">'+username+(isOwn?' <span style="font-size:10px;color:var(--orange)">(Ty)</span>':'')+'</div>'
        +'<div style="font-size:12px;color:var(--dim2)">'+new Date(rec.created_at).toLocaleDateString('pl')+'</div>';
      header.appendChild(userInfo);

      // Słowo
      var wordBadge=document.createElement('div');
      wordBadge.style.cssText='background:var(--navy);color:#fff;font-size:12px;font-weight:700;padding:4px 12px;border-radius:100px';
      wordBadge.textContent=rec.word||'';
      header.appendChild(wordBadge);
      card.appendChild(header);

      // Zdanie kontekstowe
      if(rec.sentence){
        var sentEl=document.createElement('div');
        sentEl.style.cssText='font-size:13px;color:var(--dim);font-style:italic;border-left:3px solid var(--border2);padding-left:10px;line-height:1.5';
        sentEl.textContent='"'+rec.sentence+'"';
        card.appendChild(sentEl);
      }

      // Audio player
      if(rec.audio_url){
        var audio=document.createElement('audio');
        audio.controls=true;audio.src=rec.audio_url;
        audio.style.cssText='width:100%;height:36px;border-radius:8px';
        card.appendChild(audio);
      }

      // Oceny
      var ratings=document.createElement('div');
      ratings.style.cssText='display:flex;align-items:center;gap:12px;font-size:12px;color:var(--dim2)';
      ratings.innerHTML='<span>🗣️ Wymowa: <strong style="color:var(--navy)">'+(rec.rating_pronunciation_avg||0).toFixed(1)+'</strong></span>'
        +'<span>✅ Poprawność: <strong style="color:var(--navy)">'+(rec.rating_correctness_avg||0).toFixed(1)+'</strong></span>'
        +'<span>👥 Ocen: <strong style="color:var(--navy)">'+(rec.rating_count||0)+'</strong></span>';
      card.appendChild(ratings);

      el.appendChild(card);
    });
  }catch(e){
    el.innerHTML='<div style="color:#c33;font-size:13px;padding:20px">Błąd: '+e.message+'</div>';
  }
}

async function uploadUserAvatar(file){
  if(!file) return;
  if(file.size>2*1024*1024){if(typeof showToast==='function')showToast('Plik za duży — max 2MB','error');return;}
  var label=document.getElementById('user-avatar-label');
  var preview=document.getElementById('user-avatar-preview');
  if(label)label.textContent='⏳ Przesyłanie...';
  try{
    var sess=(await db.auth.getSession()).data.session;
    if(!sess){showToast&&showToast('Zaloguj się','error');return;}
    var ext=file.name.split('.').pop()||'jpg';
    var path='avatars/'+sess.user.id+'_'+Date.now()+'.'+ext;
    var {error}=await db.storage.from('recordings').upload(path,file,{contentType:file.type,upsert:true});
    if(error)throw error;
    var {data:urlData}=db.storage.from('recordings').getPublicUrl(path);
    var url=urlData.publicUrl;
    // Zapisz do profiles
    await db.from('profiles').upsert({user_id:sess.user.id,avatar_url:url},{onConflict:'user_id'});
    if(preview){preview.src=url;preview.style.display='block';}
    if(label)label.textContent='✅ Zdjęcie zapisane!';
    showToast&&showToast('Zdjęcie profilowe zaktualizowane!','success');
  }catch(e){
    if(label)label.textContent='Błąd: '+e.message;
  }
}

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

