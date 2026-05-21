// Eyelingo — Nauczyciel PRO

async function initTeacher(){
  var el=document.getElementById('teacher-messages');
  if(!el)return;
  if(el.dataset.inited==='1')return;
  el.dataset.inited='1';
  // Show welcome
  var lang=window._strefaLang||'en';
  var teachers={en:'Alex 🇬🇧',es:'María 🇪🇸',nl:'Lars 🇳🇱',jp:'Yuki 🇯🇵',de:'Klaus 🇩🇪',fr:'Claire 🇫🇷'};
  var teacher=teachers[lang]||'Alex 🇬🇧';
  appendTeacherMsg('assistant','Cześć! Jestem '+teacher+', Twój nauczyciel. Porozmawiajmy! O czym chcesz dziś porozmawiać?');
  window._teacherHistory=[{role:'user',content:'You are '+teacher+', a friendly language teacher. Speak in English (or the target language). Be encouraging. Keep responses short (2-3 sentences max).'}];
}

function appendTeacherMsg(role, text){
  var el=document.getElementById('teacher-messages');
  if(!el)return;
  var empty=el.querySelector('div[style*="text-align:center"]');
  if(empty)empty.remove();
  var div=document.createElement('div');
  div.style.cssText='display:flex;'+(role==='user'?'justify-content:flex-end':'');
  var bubble=document.createElement('div');
  bubble.style.cssText='max-width:70%;padding:10px 16px;border-radius:16px;font-size:14px;line-height:1.6;'
    +(role==='user'?'background:var(--orange);color:#fff;border-bottom-right-radius:4px':'background:var(--paper2);color:var(--navy);border-bottom-left-radius:4px;border:1px solid var(--border)');
  bubble.textContent=text;
  div.appendChild(bubble);el.appendChild(div);
  el.scrollTop=el.scrollHeight;
}

async function sendTeacherMsg(){
  var inp=document.getElementById('teacher-input');
  if(!inp)return;
  var msg=inp.value.trim();if(!msg)return;
  inp.value='';
  appendTeacherMsg('user',msg);
  if(!window._teacherHistory)window._teacherHistory=[];
  window._teacherHistory.push({role:'user',content:msg});
  // Show typing
  var typingDiv=document.createElement('div');
  typingDiv.id='teacher-typing';typingDiv.style.cssText='color:var(--dim2);font-size:13px;font-style:italic;padding:4px 0';
  typingDiv.textContent='Nauczyciel pisze...';
  var el=document.getElementById('teacher-messages');if(el)el.appendChild(typingDiv);
  try{
    var sess=(await db.auth.getSession()).data.session;
    var tok=sess?sess.access_token:'';
    var res=await fetch(AI_PROXY_URL,{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'apikey':APIKEY_CONST},
      body:JSON.stringify({messages:window._teacherHistory.slice(-10),max_tokens:200})
    });
    var d=await res.json();
    var reply=(d&&d.candidates&&d.candidates[0]&&d.candidates[0].content&&d.candidates[0].content.parts&&d.candidates[0].content.parts[0]?d.candidates[0].content.parts[0].text:'').trim();
    if(typingDiv.parentNode)typingDiv.remove();
    if(reply){window._teacherHistory.push({role:'assistant',content:reply});appendTeacherMsg('assistant',reply);}
  }catch(e){if(typingDiv.parentNode)typingDiv.remove();appendTeacherMsg('assistant','Przepraszam, mam problem z połączeniem.');}
}
