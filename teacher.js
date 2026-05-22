// Eyelingo — teacher.js

// ═══════════════════════════════════════════════════════
// NAUCZYCIEL PRO — initTeacher + page
// ═══════════════════════════════════════════════════════

// Inject page-teacher if missing
(function(){
  if(document.getElementById('page-teacher')) return;
  var div=document.createElement('div');
  div.id='page-teacher';div.className='page';
  div.style.cssText='min-height:100vh;padding:110px 20px 80px;background:var(--paper)';
  div.innerHTML='<div style="max-width:900px;margin:0 auto">'
    +'<h2 style="font-family:Syne,sans-serif;font-size:36px;font-weight:800;color:var(--navy);margin-bottom:6px">👨‍🏫 Nauczyciel PRO</h2>'
    +'<p style="color:var(--dim2);margin-bottom:28px">Konwersacja z AI w wybranym języku</p>'
    +'<div id="teacher-ui" style="background:#fff;border:2px solid var(--border);border-radius:20px;overflow:hidden">'
    +'<div id="teacher-messages" style="min-height:400px;max-height:60vh;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:12px">'
    +'<div style="text-align:center;color:var(--dim2);font-size:14px;padding:40px">Wybierz nauczyciela i zacznij rozmowę</div>'
    +'</div>'
    +'<div style="border-top:1px solid var(--border);padding:16px;display:flex;gap:10px">'
    +'<input id="teacher-input" type="text" placeholder="Napisz wiadomość..." style="flex:1;padding:10px 16px;border-radius:100px;border:1.5px solid var(--border);font-size:14px;font-family:\'DM Sans\',sans-serif;outline:none" onkeydown="if(event.key===\'Enter\')sendTeacherMsg()">'
    +'<button onclick="sendTeacherMsg()" class="btn btn-orange" style="padding:10px 20px;font-size:14px">Wyślij</button>'
    +'</div></div></div>';
  document.body.appendChild(div);
})();

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

// ── addVoiceRecordingBtn stub — prevents errors when not fully implemented ──
function addVoiceRecordingBtn(word, sentence, lang){
  // Placeholder — rekord głosowy tworzony przez Strefę Nauki
  var el=document.getElementById('voice-record-wrap');
  if(!el)return;
  el.innerHTML='<button style="background:var(--navy);color:#fff;border:none;border-radius:100px;padding:8px 16px;font-size:12px;cursor:pointer" onclick="startVoiceRecord()">🎙️ Nagraj wymowę</button>';
}

