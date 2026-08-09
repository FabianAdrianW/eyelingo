/* ═══════════════════════════════════════════════════════════════════════
   EYELINGO — GRAMMAR ENGINE — KOPIA REFERENCYJNA
   ---------------------------------------------------------------------
   Ten plik NIE jest ładowany przez aplikację. Silnik działa wklejony
   wewnątrz index.html i app.html i tylko tamte kopie są wykonywane.
   Plik służy do czytania i do diffa — musi być znakowo identyczny
   z blokiem w obu HTML-ach, inaczej wprowadza w błąd przy zmianach.

   Wygenerowany z index.html. Po każdej zmianie w silniku wygeneruj
   ponownie, zamiast edytować ręcznie.
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══ EYELINGO — GRAMMAR ENGINE v1.0 (GRAM-0..GRAM-4) ═══
   Bank pusty/niezaładowany => wszystkie funkcje neutralne, aplikacja działa jak wcześniej. */
(function(){
  'use strict';
  var LEVELS=['A1','A2','B1','B2','C1','C2'];
  var BANK={}, LOADING={};
  var BANK_BASE='data/grammar/grammar-bank.';

  /* Kod jezyka banku. PWA deklaruje _lexLang przez `let`, wiec zmienna NIE
     trafia na window — silnik czytal wtedy zawsze 'en', bank japonskiego
     ladowal sie pod kluczem 'jp', a bank() siegal po pusty 'en'. Efekt:
     gramBankReady()===false i cala gramatyka milczala dla kazdego jezyka
     poza angielskim. Czytamy wiec window, zmienna leksykalna i kod zestawu. */
  function _gramNormCode(c){
    c=String(c==null?'':c).toLowerCase().trim().split(/[-_]/)[0];
    if(c==='ja') c='jp';                 // kanoniczny kod japonskiego w Eyelingo
    return c;
  }
  function lang(){
    var c='';
    try{ c=window._lexLang||''; }catch(e){}
    try{ if(!c && typeof _lexLang!=='undefined') c=_lexLang||''; }catch(e){}
    try{ if(!c && typeof curSetLang!=='undefined') c=curSetLang||''; }catch(e){}
    return _gramNormCode(c)||'en';
  }
  function level(){
    try{ if(window._gramLevel) return window._gramLevel; }catch(e){}
    try{ if(typeof lexLevel!=='undefined'&&lexLevel) return lexLevel; }catch(e){}
    return 'A1';
  }
  function lvlIdx(l){ var i=LEVELS.indexOf(String(l||'A1')); return i<0?0:i; }
  function skey(){ try{ return uk('lex_gram_state_'+lang()); }catch(e){ return 'lex_gram_state_'+lang(); } }
  function now(){ return Date.now(); }
  var DAY=86400000;

  window.gramBankLoad=function(l){
    l=l?_gramNormCode(l):lang(); if(!l) l=lang();
    if(BANK[l]) return Promise.resolve(BANK[l]);
    if(LOADING[l]) return LOADING[l];
    LOADING[l]=fetch(BANK_BASE+l+'.json',{cache:'no-cache'})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(j){
        var list=(j&&j.points)?j.points.slice():[];
        list.sort(function(a,b){ return (a.order||0)-(b.order||0); });
        var byId={}; list.forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
        BANK[l]={byId:byId,list:list};
        // Stan ucznia musi byc na miejscu, zanim policzymy pierwszy status.
        return Promise.resolve(gramSyncPull(l)).catch(function(){}).then(function(){ return BANK[l]; });
      })
      .catch(function(err){
        try{ console.warn('[gram] nie wczytano banku:', BANK_BASE+l+'.json', '-', (err&&err.message)||err); }catch(e){}
        // Nieudanej proby NIE zapisujemy — inaczej jeden 404 (np. przed wgraniem
        // pliku) blokuje bank do konca sesji. Nastepna porcja sprobuje ponownie.
        delete LOADING[l];
        return {byId:{},list:[]};
      });
    return LOADING[l];
  };
  function bank(){ return BANK[lang()]||{byId:{},list:[]}; }
  /* Wymusza ponowne pobranie banku z pominieciem cache przegladarki. */
  window.gramBankReload=function(l){ l=l?_gramNormCode(l):lang(); delete BANK[l]; delete LOADING[l]; return gramBankLoad(l); };
  window.gramPoint=function(id){ return bank().byId[id]||null; };
  window.gramBankReady=function(){ return bank().list.length>0; };

  /* Stan trzymamy w pamieci miedzy odczytami. gramStatus wola sie rekurencyjnie
     po prerekwizytach, wiec bez tego jedno gramAllowed() parsowaloby localStorage
     kilkaset razy. */
  var _stCache=null, _stKey='';
  function loadState(){
    var k=skey();
    if(_stCache&&_stKey===k) return _stCache;
    try{ _stCache=JSON.parse(localStorage.getItem(k)||'{}'); }catch(e){ _stCache={}; }
    _stKey=k; return _stCache;
  }
  function saveState(s){
    var k=skey();
    try{ localStorage.setItem(k,JSON.stringify(s)); }catch(e){}
    _stCache=s; _stKey=k; _touched=null;
  }
  function dropState(){ _stCache=null; _stKey=''; _touched=null; }
  function rec(id){ var r=loadState()[id]; return (r&&typeof r==='object')?r:null; }
  /* Na zewnatrz oddajemy KOPIE — loadState() zwraca zywy obiekt z cache,
     wiec wydanie go publicznie znaczyloby, ze czyjas zmienna zmienia sie
     sama pod reka. */
  window.gramState=function(){
    var s=loadState(), out={};
    Object.keys(s).forEach(function(k){
      var v=s[k];
      out[k]=(v&&typeof v==='object')?JSON.parse(JSON.stringify(v)):v;
    });
    return out;
  };
  /* Reczne odswiezenie cache — dla diagnostyki i srodowisk bez zdarzen okna. */
  window.gramStateReload=dropState;
  /* Inna karta tej samej aplikacji moze zapisac stan pod nami. */
  try{ window.addEventListener('storage',function(ev){ if(!ev||!ev.key||ev.key===_stKey) dropState(); }); }catch(e){}

  /* ── Poziom odniesienia i uznanie kompetencji ────────────────────────────
     Uczen B1 nie moze dostac lekcji o czasowniku „to be". Wszystko dwa pasma
     ponizej jego poziomu startuje jako `presumed` — uznane za znane: nie jest
     nauczane, wolno go uzywac w cwiczeniach, nie dostaje sciagi.

     Weryfikacja NIE jest testem na wejsciu. Dzieje sie w zwyklych cwiczeniach:
     gdy uznana struktura zawiedzie w produkcji, punkt cicho spada do nauki.
     Asymetria kosztow (Bible §6.8): nauczenie znanego to chwila nudy, ktora
     sama sie leczy; uznanie nieznanego to cicha dziura, ktora narasta —
     dlatego uznajemy chetnie, ale bez sciagi i z natychmiastowa demotacja.

     Zabezpieczenie: nigdy nie uznajemy NAJWYZSZEGO pasma, jakie bank posiada.
     Inaczej uczen B2 przy bankach konczacych sie na A2 nie dostalby nic. */
  function bankMaxIdx(){
    var m=-1; bank().list.forEach(function(p){ var i=lvlIdx(p.level); if(i>m) m=i; }); return m;
  }
  /* Kotwica jest monotoniczna — powrot do latwiejszego zestawu nie cofa
     nadanych statusow do `locked`. */
  var _anchor={};
  function anchorIdx(){
    var l=lang(), cur=lvlIdx(level());
    if(_anchor[l]==null){
      var s=loadState();
      _anchor[l]=(typeof s.__anchor==='number')?s.__anchor:cur;
    }
    if(cur>_anchor[l]){
      _anchor[l]=cur;
      var s2=loadState(); s2.__anchor=cur; saveState(s2);
    }
    return _anchor[l];
  }
  function presumedCut(){
    var mx=bankMaxIdx(); if(mx<0) return -1;
    return Math.min(anchorIdx()-2, mx-1);
  }
  /* Pasmo, w ktorym uczen ma juz JAKIKOLWIEK slad pracy, przestaje podlegac
     uznaniu. Bez tego ktos, kto przerobil polowe A1, po jednym zestawie B1
     tracil reszte: punkty zmienialy sie w „uznane za znane" i nikt ich nigdy
     nie uczyl. Uznajemy cale pasma, ktorych uczen nie tknal — nie polowki. */
  var _touched=null;
  function bandTouched(idx){
    if(_touched===null){
      _touched={};
      var s=loadState();
      bank().list.forEach(function(p){
        var r=s[p.id];
        // Wylacznie faktyczna nauka. Odwolanie uznania ('unknown') to korekta
        // samego zalozenia, nie dowod pracy w pasmie — inaczej jedno „nie znam"
        // zdejmowaloby uznanie z calego poziomu naraz.
        if(r&&typeof r==='object'&&r.status==='unlocked') _touched[lvlIdx(p.level)]=1;
      });
    }
    return !!_touched[idx];
  }
  function preOk(q){
    // Prerekwizyt nieobecny w banku traktujemy jako spelniony — inaczej czesciowy
    // bank (albo literowka w id) blokuje cala galaz. Kompletnosc grafu sprawdza
    // audyt banku (GRAM-2), nie runtime.
    if(!bank().byId[q]) return true;
    var s=gramStatus(q);
    return s==='unlocked'||s==='stale'||s==='presumed';
  }

  window.gramStatus=function(id){
    var p=gramPoint(id); if(!p) return 'locked';
    var r=rec(id);
    if(r&&r.status==='unlocked') return (r.due&&r.due<now())?'stale':'unlocked';
    var pi=lvlIdx(p.level);
    // `unknown` = uznanie odwolane (przez ucznia albo przez jego blad)
    if(!(r&&r.status==='unknown') && pi<=presumedCut() && !bandTouched(pi)) return 'presumed';
    if(pi>anchorIdx()) return 'locked';
    return [].concat(p.prereq||[]).every(preOk)?'teachable':'locked';
  };
  window.gramAllowed=function(){
    var out=[]; bank().list.forEach(function(p){
      var s=gramStatus(p.id); if(s==='unlocked'||s==='stale'||s==='presumed') out.push(p.id);
    }); return out;
  };
  /* Front: WSZYSTKIE punkty gotowe do wprowadzenia. Graf prereq to porzadek
     CZESCIOWY, nie kolejka — wybor wewnatrz frontu nie moze zlamac GRAM-0,
     a pozwala dopasowac strukture do tematu porcji. Poprzednia wersja
     splaszczala graf do jednej sciezki po `order` i ignorowala temat lekcji. */
  window.gramFrontier=function(limit){
    var out=[], l=bank().list;
    for(var i=0;i<l.length;i++){
      if(gramStatus(l[i].id)==='teachable'){ out.push(l[i].id); if(limit&&out.length>=limit) break; }
    }
    return out;
  };
  window.gramTeachableNow=function(){ var f=gramFrontier(1); return f.length?f[0]:null; };
  /* Odwolanie uznania — z mapy struktur albo automatycznie po bledzie produkcyjnym. */
  window.gramDemote=function(id,src){
    if(!gramPoint(id)) return false;
    if(gramStatus(id)!=='presumed') return false;
    var s=loadState(); s[id]={status:'unknown',since:now(),src:src||'user',ts:now()};
    saveState(s); _push(id,s[id]);
    try{ console.info('[gram] uznanie odwolane:',id,'('+(src||'user')+')'); }catch(e){}
    return true;
  };
  /* Prog opanowania — identyczny jak dla fiszek: trzy trafienia i interwal,
     ktory przetrwal odstep. Nie da sie go osiagnac w jednej sesji i o to
     chodzi: opanowanie to przetrwanie odstepu, nie liczba klikniec. */
  var MASTER_REPS=3, MASTER_DAYS=21;
  window.gramMastered=function(id){
    var r=rec(id);
    if(!r||r.status!=='unlocked') return false;
    return (r.exposures||0)>=MASTER_REPS && (r.interval||0)>=MASTER_DAYS;
  };
  window.gramPresumedCount=function(){
    var n=0; bank().list.forEach(function(p){ if(gramStatus(p.id)==='presumed') n++; }); return n;
  };
  /* Pasmo aktualnie nauczane — nie poziom ucznia. Uczen B1 uczy sie A2. */
  window.gramTeachLevel=function(){
    var f=gramFrontier(1);
    if(f.length){ var p=gramPoint(f[0]); if(p) return p.level; }
    var mx=Math.min(anchorIdx(), bankMaxIdx());
    return LEVELS[mx<0?0:mx];
  };
  window.gramStalePoint=function(){
    var l=bank().list; for(var i=0;i<l.length;i++){ if(gramStatus(l[i].id)==='stale') return l[i].id; } return null;
  };

  /* Kanoniczna tresc dydaktyczna punktu jako tekst — uzywana w moscie
     Etapu 1-2 (przepisywana przez model do intro) oraz przez Zeszyt.
     W Etapie 3 zastapi ja karta „Nowa struktura" renderowana przez aplikacje:
     wystarczy ustawic window.GRAM_INTRO_BRIDGE=false. */
  /* ── Normalizacja porcji ────────────────────────────────────────────────
     Model bywa, ze zwraca kafelki jako JEDEN string sklejony przecinkami
     ("Watashi,wa,Nihon,no,gakusei,desu,.") zamiast tablicy slow. Wtedy
     uczen dostaje jeden bezuzyteczny kafel. Kafelki MUSZA byc dokladnie
     slowami zdania wzorcowego — wiec jesli sie nie zgadzaja, odtwarzamy je
     z pola answer i tasujemy. To jest deterministyczne, wiec nie zalezy od
     tego, czy model tym razem posluchal. */
  function _tok(str){
    return String(str||'')
      .replace(/([^\s,]),(?=[^\s,])/g,'$1 ')   // slowo,slowo -> slowo slowo
      .replace(/\s*([.!?…、。])\s*/g,' $1 ')     // interpunkcja jako osobny token
      .split(/\s+/).filter(Boolean);
  }
  function _shuffle(a){
    a=a.slice();
    for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; }
    return a;
  }
  window.lexNormalizePortion=function(data){
    if(!data||!data.exercises) return data;
    data.exercises.forEach(function(ex){
      if(!ex) return;

      // 1. answer sklejone przecinkami -> normalne zdanie ze spacjami
      ['answer','sentence','skeleton','source','context'].forEach(function(k){
        if(typeof ex[k]==='string' && ex[k].indexOf(',')>=0 && !/,\s/.test(ex[k])){
          ex[k]=ex[k].replace(/([^\s,]),(?=[^\s,])/g,'$1 ').replace(/\s+([.!?])/g,'$1').trim();
        }
      });

      if(ex.type!=='sculpt') return;

      // 2. kafelki: string albo jednoelementowa tablica ze sklejka
      var t=ex.tiles;
      if(typeof t==='string') t=_tok(t);
      else if(Array.isArray(t) && t.length===1 && /[,\s]/.test(String(t[0]))) t=_tok(t[0]);
      else if(Array.isArray(t)) t=t.map(function(x){ return String(x==null?'':x).trim(); }).filter(Boolean);
      else t=[];

      // 3. kafelki musza pokrywac sie ze zdaniem wzorcowym — inaczej odtwarzamy
      var want=_tok(ex.answer);
      var okCount = want.length>0 && t.length===want.length;
      var okWords = okCount && want.slice().sort().join('\u0001')===t.slice().sort().join('\u0001');
      if(!okWords && want.length) t=_shuffle(want);

      // 4. gotowe kafelki nie moga stac w kolejnosci odpowiedzi
      if(t.length>1 && t.join(' ')===want.join(' ')) t=_shuffle(t);
      ex.tiles=t;
    });
    return data;
  };

  /* ── Transliteracja pozycji porcji ──────────────────────────────────────
     Pole "reading" pochodzi od modelu, wiec bywa puste. W trybie transliteracji
     Tablica pokazywalaby wtedy pismo oryginalne — czyli zapis, ktorego uczen
     na tym poziomie nie czyta. Naprawiamy to deterministycznie: brakujace
     odczyty dobieramy JEDNYM zbiorczym zapytaniem i cache'ujemy per slowo. */
  var _trMem={};
  function _trKey(lang,w){ var k='eyl_translit_'+lang+'_'+String(w||'').trim().toLowerCase();
    try{ return uk(k); }catch(e){ return k; } }
  function _trGet(lang,w){
    var k=_trKey(lang,w);
    if(_trMem[k]!=null) return _trMem[k];
    try{ var v=localStorage.getItem(k); if(v){ _trMem[k]=v; return v; } }catch(e){}
    return null;
  }
  function _trSet(lang,w,r){
    if(!r) return; var k=_trKey(lang,w); _trMem[k]=r;
    try{ localStorage.setItem(k,r); }catch(e){}
  }

  /* ask(prompt) -> Promise<string>. Zwraca liczbe uzupelnionych pozycji. */
  window.lexTranslitRepair=async function(data, langCode, scriptName, ask){
    if(!data||!data.items||!data.items.length) return 0;
    var lang=langCode||lang;
    var brak=[];
    data.items.forEach(function(it){
      if(!it||!it.word) return;
      if(it.reading && String(it.reading).trim()) return;
      var c=_trGet(lang,it.word);
      if(c){ it.reading=c; return; }
      brak.push(it);
    });
    if(!brak.length || typeof ask!=='function') return 0;

    var lista=brak.map(function(it,i){ return (i+1)+'. '+it.word; }).join('\n');
    var p='Podaj transliterację ('+(scriptName||'zapis łaciński')+') dla poniższych słów. '
      +'Zwróć WYŁĄCZNIE JSON, tablicę w tej samej kolejności, bez żadnego dodatkowego tekstu: '
      +'{"readings":["transliteracja 1","transliteracja 2"]}\n'+lista;
    var out=null;
    try{
      var raw=await ask(p);
      var t=String(raw||'').replace(/```json|```/g,'').trim();
      var a=t.indexOf('{'), b=t.lastIndexOf('}');
      if(a>=0&&b>a) out=JSON.parse(t.slice(a,b+1));
    }catch(e){
      try{ console.warn('[translit] nie udalo sie uzupelnic odczytow:', (e&&e.message)||e); }catch(_){}
      return 0;
    }
    var r=(out&&out.readings)||[];
    var n=0;
    brak.forEach(function(it,i){
      var v=String(r[i]||'').trim();
      if(v){ it.reading=v; _trSet(lang,it.word,v); n++; }
    });
    return n;
  };

  window.gramTeachBlock=function(p){
    if(!p||!p.teach) return '';
    var t=p.teach, out=[];
    out.push(p.name_pl);
    if(t.rule_pl) out.push(t.rule_pl);
    if(t.paradigm&&t.paradigm.rows&&t.paradigm.rows.length){
      t.paradigm.rows.forEach(function(r){ out.push([].concat(r).join('  →  ')); });
    }
    if(t.examples&&t.examples.length){
      t.examples.forEach(function(e){ out.push(String(e.target||'')+' — '+String(e.pl||'')); });
    }
    if(t.contrast_pl) out.push('Uwaga: '+t.contrast_pl);
    return out.join('\n');
  };

  /* Diagnostyka — do wklejenia w konsoli gdy bank sie nie laduje. */
  window.gramDiag=async function(){
    var l=lang();
    var url=BANK_BASE+l+'.json';
    var out={ kod_jezyka:l, poziom:level(), sciezka:url, pelny_url:(new URL(url, location.href)).href };
    try{
      var r=await fetch(url,{cache:'no-store'});
      out.status=r.status;
      if(r.ok){ var j=await r.json(); out.punktow=(j&&j.points)?j.points.length:0; out.lang_w_pliku=j&&j.lang; }
    }catch(e){ out.blad=(e&&e.message)||String(e); }
    out.bank_zaladowany=gramBankReady();
    console.table?console.table(out):console.log(out);
    return out;
  };

  /* ── Karta „Nowa struktura" — render z danych banku ──────────────────────
     Segmentacja wizualna zamiast sciany tekstu: kazda funkcja dydaktyczna
     (regula / wzorzec / przyklad / typowy blad) dostaje wlasny blok, wlasny
     kolor i wlasny rytm. Czytelnik skanuje, nie brnie. */
  function _e(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* Zdanie wzorcowe zbudowane ze slownictwa biezacej porcji. Karta z banku
     jest z definicji neutralna — uczen widzi regule, ktora nie ma zwiazku
     z tym, czego sie wlasnie uczy. To domyka luke. */
  var _gEx={};
  window.gramSetExample=function(id,ex){
    if(!id||!ex) return;
    var tgt=String(ex.target||ex.zdanie||'').trim();
    if(!tgt) return;
    try{ tgt=gramCleanNotation(tgt); }catch(e){}
    _gEx[lang()+'|'+id]={target:tgt, pl:String(ex.pl||ex.tlumaczenie||'').trim()};
  };
  window.gramGetExample=function(id){ return _gEx[lang()+'|'+id]||null; };

  /* Model regularnie nie wypelnia pol, o ktore prosimy (Bible §6.6). Wszystko,
     co da sie odtworzyc deterministycznie, odtwarzamy sami: zdanie „W tej
     porcji" bierzemy z pierwszego cwiczenia, ktore faktycznie uzywa tej
     struktury. W cloze wstawiamy odpowiedz w luke, zeby zdanie bylo pelne. */
  window.gramDeriveExample=function(data,id){
    if(!data||!id) return null;
    var exs=[].concat(data.exercises||[]);
    for(var i=0;i<exs.length;i++){
      var ex=exs[i]||{};
      if([].concat(ex.uses_grammar||[]).indexOf(id)<0) continue;
      var s=ex.sentence||ex.answer||ex.target||ex.source||'';
      if(Array.isArray(s)) s=s.join(' ');
      s=String(s||'');
      var ans=[].concat(ex.answers||ex.answer||[]).map(function(a){ return String(a||'').trim(); }).filter(Boolean);
      if(s.indexOf('_')>=0 && ans.length){
        var k=0;
        s=s.replace(/_{2,}/g,function(){ var v=ans[k++]; return v||'…'; });
      }
      s=s.replace(/_{2,}/g,'').replace(/\s+/g,' ').trim();
      if(s.length<6 || s.indexOf('…')>=0) continue;
      var pl=String(ex.sentence_pl||ex.source_pl||ex.context_pl||'').replace(/_{2,}/g,'').replace(/\s+/g,' ').trim();
      return {target:s, pl:pl};
    }
    return null;
  };

  window.gramCardHTML=function(id, opts){
    var p=(typeof id==='object'&&id)?id:gramPoint(id);
    if(!p||!p.teach) return '';
    opts=opts||{};
    var t=p.teach, h='';
    h+='<div class="gram-card">';
    h+='<div class="gram-eyebrow">'+_e(opts.eyebrow||'Nowa struktura')+'</div>';
    h+='<div class="gram-title">'+_e(p.name_pl)+'</div>';
    if(t.rule_pl) h+='<div class="gram-rule">'+_e(t.rule_pl)+'</div>';

    if(t.paradigm&&t.paradigm.rows&&t.paradigm.rows.length){
      var head=t.paradigm.head||[];
      h+='<div class="gram-para">';
      if(head.length){
        h+='<div class="gram-prow gram-phead">'+head.map(function(c){
          return '<div class="gram-pcell">'+_e(c)+'</div>'; }).join('')+'</div>';
      }
      t.paradigm.rows.forEach(function(r){
        var cells=[].concat(r);
        h+='<div class="gram-prow">'+cells.map(function(c,ci){
          var last=(ci===cells.length-1);
          return '<div class="gram-pcell'+(last?' gram-pkey':'')+'">'+_e(c)+'</div>';
        }).join('')+'</div>';
      });
      h+='</div>';
    }

    // Najpierw material wlasny porcji, dopiero potem przyklady kanoniczne.
    // Uczen ma zobaczyc regule na slowach, ktorych wlasnie uzywa — inaczej
    // struktura i lekcja zostaja dwoma osobnymi swiatami.
    var _cx=opts.example||((typeof gramGetExample==='function')?gramGetExample(p.id):null);
    if(_cx&&_cx.target){
      h+='<div class="gram-ctx"><div class="gram-ctx-lab">W tej porcji</div>'
        +'<div class="gram-ex" data-say="'+_e(_cx.target)+'">'
        +'<div class="gram-ex-t">'+_e(_cx.target)+'</div>'
        +(_cx.pl?'<div class="gram-ex-p">'+_e(_cx.pl)+'</div>':'')
        +'</div></div>';
    }

    if(t.examples&&t.examples.length){
      h+='<div class="gram-exs">';
      t.examples.forEach(function(ex){
        // Pismo oryginalne siedzialo w modelu danych od wersji 2.0 i nie bylo
        // renderowane nigdzie — bank japonski niosl kane i kanji, ktorych nikt
        // nie widzial. Kolejnosc jak w Tablicy: transliteracja, pod nia zapis.
        // Do wymowy podajemy oryginal, jesli jest — lektor czytajacy
        // transliterację wymawia ja jak tekst polski.
        var nat=String(ex.target_native||'').trim();
        h+='<div class="gram-ex" data-say="'+_e(nat||ex.target)+'">'
          +'<div class="gram-ex-t">'+_e(ex.target)+'</div>'
          +(nat?'<div class="gram-ex-n">'+_e(nat)+'</div>':'')
          +(ex.pl?'<div class="gram-ex-p">'+_e(ex.pl)+'</div>':'')+'</div>';
      });
      h+='</div>';
    }

    if(t.contrast_pl){
      h+='<div class="gram-warn"><span class="gram-warn-ic">!</span><span>'+_e(t.contrast_pl)+'</span></div>';
    }
    h+='</div>';
    return h;
  };

  /* Lista struktur wprowadzonych w tej porcji — do Tablicy lekcji. */
  window.gramLessonPoints=function(data){
    if(!gramBankReady()||!data) return [];
    var ids={}, out=[];
    if(data._teachable) ids[data._teachable]=1;
    (data.exercises||[]).forEach(function(ex){
      [].concat((ex&&ex.uses_grammar)||[]).forEach(function(i){ if(i) ids[i]=1; });
    });
    Object.keys(ids).forEach(function(i){
      var p=gramPoint(i); if(!p) return;
      // Struktury uznane za znane sluza tu za rusztowanie, nie za material.
      // Wpisane na Tablice na rowni z nowa struktura zrownywaly to, co uczen
      // dzis poznaje, z tym, co system tylko zalozyl — i przeczyly mapie.
      if(i!==data._teachable && gramStatus(i)==='presumed') return;
      out.push(p);
    });
    out.sort(function(a,b){ return (a.order||0)-(b.order||0); });
    return out;
  };

  function _gramTail(tp,hasNew){
    return (hasNew?('Zdania w ćwiczeniach z nową strukturą MUSZĄ być zbudowane ze słownictwa tej porcji '
        +'— nie z neutralnych przykładów podręcznikowych. Struktura ma obsłużyć TEN temat, nie dowolny. '
        +'W polu "new_grammar_example" na najwyższym poziomie odpowiedzi podaj jedno krótkie zdanie '
        +'w języku docelowym, które pokazuje nową strukturę na słowie z materiału tej porcji, '
        +'wraz z tłumaczeniem na polski: {"target":"zdanie","pl":"tłumaczenie"}. '):'')
      +'Nie wolno użyć ŻADNEJ innej struktury — ani w zdaniach, ani w poleceniach, ani we wzorcowych odpowiedziach, ani w podpowiedziach. '
      +'W KAŻDYM ćwiczeniu wypełnij pole "uses_grammar": tablicę id struktur wymaganych do poprawnego wykonania zadania (pusta tablica, jeśli zadanie jest czysto leksykalne). '
      +'Porcja wprowadzająca nową strukturę NIE dokłada własnych słów ponad materiał do utrwalenia — budżet uwagi ucznia zajmuje reguła. '
      +(tp?(window.GRAM_INTRO_BRIDGE!==true
            ? 'NIE tłumacz nowej struktury w polu "intro" — regułę i odmianę pokaże aplikacja z własnych danych. Twoim zadaniem są wyłącznie ćwiczenia. '
            : ('NOWĄ strukturę wprowadź na POCZĄTKU pola "intro", przepisując PONIŻSZY model DOSŁOWNIE, bez skracania i bez własnych wyjaśnień, a dopiero potem przejdź do ćwiczeń:\n'
               + gramTeachBlock(tp) + '\n'))
         : 'NIE tłumacz struktur w polu "intro" — regułę pokaże aplikacja z własnych danych. ')
      +'Nie używaj notacji podręcznikowej: tyldy (~ ani ～), nawiasów kwadratowych, gwiazdek poza **wyróżnieniem słowa-celu**. ';
  }
  /* Licznik porcji bez nowej struktury. Postep gramatyczny nie moze zalezec
     od tego, jakie zestawy slownikowe uczen lubi — po trzech porcjach bez
     wprowadzenia przestajemy pytac o dopasowanie i wymuszamy front. */
  var _noNew=0;
  window.gramPromptBlock=function(words){
    if(!gramBankReady()) return '';
    var allowed=gramAllowed().map(function(id){ var p=gramPoint(id); return p?(p.id+' = '+p.name_pl):id; });
    var mat=[].concat(words||[]).map(function(w){
      return String((w&&w.word)||w||'').trim(); }).filter(Boolean).slice(0,12);
    var force=_noNew>=3;
    var cands=gramFrontier(force?1:6).map(function(id){ return gramPoint(id); }).filter(Boolean);
    _noNew++;
    var head='KONTRAKT GRAMATYCZNY — BEZWZGLĘDNY. '
      +'Struktury, które uczeń ZNA i których wolno używać: '
      +(allowed.length?allowed.join('; '):'BRAK — trzymaj się absolutnych podstaw')+'. ';
    /* SM-2 planowal powtorki struktur, ale nikt ich nie odczytywal — interwal
       mijal i nic sie nie dzialo. Struktura po terminie wraca teraz do
       materialu porcji jako WYDOBYCIE, nie jako nowe wprowadzenie. */
    var _sp=(typeof gramStalePoint==='function')?gramStalePoint():null;
    var _spP=_sp?gramPoint(_sp):null;
    if(_spP){
      head+='DO ODŚWIEŻENIA — struktura poznana wcześniej, której termin powtórki minął: '
        +_spP.id+' = '+_spP.name_pl+'. Wpleć ją w co najmniej jedno ćwiczenie tej porcji '
        +'i zadeklaruj w "uses_grammar". Nie tłumacz jej od nowa — uczeń ma ją sobie przypomnieć, '
        +'wykonując zadanie. ';
    }
    if(!cands.length){
      return head+'NIE wprowadzaj żadnej nowej struktury gramatycznej w tej porcji. '+_gramTail(null,false);
    }
    if(cands.length===1){
      // Jeden kandydat = brak wyboru. Ciężar dopasowania przechodzi wtedy
      // w całości na ćwiczenia: to one mają obsłużyć temat tą strukturą.
      return head+'Struktura NOWA, dozwolona wyłącznie w tej porcji: '
        +cands[0].id+' = '+cands[0].name_pl+'. '
        +'Struktura jest ustalona z góry — to ćwiczenia mają dopasować się do niej, '
        +'budując zdania z materiału tej porcji. '
        +_gramTail(cands[0],true);
    }
    return head
      +'KANDYDACI na nową strukturę — wszyscy dozwoleni na tym etapie: '
      +cands.map(function(p){ return p.id+' = '+p.name_pl; }).join('; ')+'. '
      // Kandydaci i slowa musza stac obok siebie. Rozdzielone w promptcie,
      // model wybieral pierwszego z listy zamiast tego, ktory obsluguje material.
      +(mat.length?('Materiał tej porcji to: '+mat.join(', ')+'. Wybierz kandydata, który obsłuży WŁAŚNIE TE słowa '
        +'w naturalnych zdaniach — nie takiego, przy którym trzeba by je naginać. '):'')
      +'Wybierz DOKŁADNIE JEDNEGO i wpisz jego id w pole "new_grammar" na najwyższym poziomie odpowiedzi. '
      +'Kolejność listy nie ma znaczenia — nie bierz pierwszego z przyzwyczajenia; '
      +'przejdź całą listę i sprawdź, który daje najlepsze zdania z tym słownictwem. '
      +'Jeśli żaden nie pasuje bez sztuczności — wpisz pusty string i nie wprowadzaj nowej struktury. '
      +'Wolno użyć wyłącznie wybranego kandydata; pozostali są w tej porcji zabronieni. '
      +_gramTail(null,true);
  };
  /* Model proponuje, klient rozstrzyga. Id spoza frontu albo zmyslone nie ma
     prawa przejsc — wracamy wtedy do punktu, ktory faktycznie pojawil sie
     w cwiczeniach, a w ostatecznosci do najnizszego `order`. */
  window.gramResolvePick=function(data){
    if(!gramBankReady()) return null;
    var fr=gramFrontier(0); if(!fr.length) return null;
    var inFr={}; fr.forEach(function(i){ inFr[i]=1; });
    var pick=String((data&&(data.new_grammar||data.newGrammar))||'').trim();
    var cnt={};
    ((data&&data.exercises)||[]).forEach(function(ex){
      [].concat((ex&&ex.uses_grammar)||[]).forEach(function(id){ if(inFr[id]) cnt[id]=(cnt[id]||0)+1; });
    });
    if(pick&&inFr[pick]&&cnt[pick]) return pick;
    var best=null,bn=0;
    fr.forEach(function(id){ var n=cnt[id]||0; if(n>bn){ bn=n; best=id; } });
    if(best) return best;
    if(pick&&inFr[pick]) return pick;
    return fr[0];
  };

  var PRODUCTIVE=['produce','sculpt','transform','translate','scenario'];
  function exText(ex){
    var p=[];
    ['prompt','instruction','intent','answer','source','sentence','skeleton','situation','hint','key','explain','question','context']
      .forEach(function(k){ if(ex&&ex[k]) p.push(String(ex[k])); });
    if(ex&&Array.isArray(ex.options)) p.push(ex.options.join(' '));
    if(ex&&Array.isArray(ex.tiles)) p.push(ex.tiles.join(' '));
    if(ex&&Array.isArray(ex.answers)) p.push(ex.answers.join(' '));
    if(ex&&Array.isArray(ex.must_use)) p.push(ex.must_use.join(' '));
    return p.join(' \n ').toLowerCase();
  }
  /* ── Sito wykładników (GRAM-5) ───────────────────────────────────────────
     Sito łapie struktury UŻYTE, lecz niezadeklarowane. Każde trafienie wycina
     ćwiczenie z porcji, więc fałszywy alarm kosztuje więcej niż przeoczenie.

     Poprzednia wersja szukała podciągu i dopuszczała każdy wykładnik od 4
     znaków. W bankach produkcyjnych oznaczało to, że 'ando' trafiało w
     'cuando', 'than' w 'thank', 'mente' w każdy włoski przysłówek, a 'that',
     'some', 'nicht' w niemal każde zdanie. Przy 27–34 punktach z sitem na bank
     wycinało to poprawne ćwiczenia masowo.

     Teraz: konstrukcje wielowyrazowe ("te kudasai", "om te") szukane jako
     podciąg — są jednoznaczne. Pojedyncze słowa muszą mieć co najmniej 6
     znaków i pasować do CAŁEGO słowa, nie do jego fragmentu. Końcówki
     fleksyjne ('ísimo', 'erai') przestają więc trafiać w ogóle — i dobrze,
     bo jako podciągi były najgroźniejsze. */
  var _sieveRe={};
  /* Granica slowa nakladana WARUNKOWO — tylko po tej stronie wykladnika,
     ktora konczy sie znakiem alfanumerycznym. Wykladnik zaczynajacy sie od
     interpunkcji (", das") nie ma przed soba granicy, bo poprzedza go litera
     ("Zeit, das"); wymuszenie jej po obu stronach kasowalo poprawne trafienia.
     Granica NA KONCU jest natomiast konieczna takze dla wykladnikow
     wielowyrazowych: bez niej ", das" (zdanie wzgledne) lapie ", dass"
     (zdanie dopelnieniowe), a "voy a" lapie "voy al". Kazde takie trafienie
     wycina z porcji cwiczenie, ktore bylo poprawne. */
  var _AN=/[\p{L}\p{N}]/u;
  function _alnum(ch){ try{ return _AN.test(ch); }catch(e){ return /[a-zà-ÿ0-9]/i.test(ch); } }
  function _wordRe(e){
    if(_sieveRe[e]!==undefined) return _sieveRe[e];
    var esc=e.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    var pre=_alnum(e.charAt(0))?'(^|[^\\p{L}\\p{N}])':'';
    var post=_alnum(e.charAt(e.length-1))?'([^\\p{L}\\p{N}]|$)':'';
    var r=null;
    try{ r=new RegExp(pre+esc+post,'u'); }
    catch(err){
      var pre2=/[a-zà-ÿ0-9]/i.test(e.charAt(0))?'(^|[^a-zà-ÿ0-9])':'';
      var post2=/[a-zà-ÿ0-9]/i.test(e.charAt(e.length-1))?'([^a-zà-ÿ0-9]|$)':'';
      try{ r=new RegExp(pre2+esc+post2); }catch(e2){ r=null; }
    }
    _sieveRe[e]=r; return r;
  }
  function sieveHit(ex,point){
    if(point.sieve!==true) return false;
    var exps=[].concat(point.exponents||[])
      .map(function(e){ return String(e==null?'':e).trim().toLowerCase(); })
      .filter(Boolean);
    if(!exps.length) return false;
    var t=exText(ex);
    for(var i=0;i<exps.length;i++){
      var e=exps[i];
      /* Prog dlugosci zostaje rozny (wielowyrazowe >=5, pojedyncze >=6), ale
         dopasowanie idzie juz przez te sama granice warunkowa. */
      if(e.length < (e.indexOf(' ')>0 ? 5 : 6)) continue;
      var r=_wordRe(e);
      if(r ? r.test(t) : (t.indexOf(e)>=0)) return true;
    }
    return false;
  }
  window.gramValidatePortion=function(data,teachableId){
    if(!gramBankReady()||!data) return {bad:[],reasons:[]};
    var ok={}; gramAllowed().forEach(function(id){ ok[id]=1; }); if(teachableId) ok[teachableId]=1;
    var locked=bank().list.filter(function(p){ return !ok[p.id]&&lvlIdx(p.level)<=lvlIdx(level())+1; });
    var bad=[], reasons={};
    (data.exercises||[]).forEach(function(ex,i){
      if(!ex) return;
      var used=[].concat(ex.uses_grammar||[]).filter(Boolean);
      var illegal=used.filter(function(id){ return !ok[id]; });
      if(illegal.length){ bad.push(i); illegal.forEach(function(id){ var p=gramPoint(id); reasons[p?p.name_pl:id]=1; }); return; }
      if(PRODUCTIVE.indexOf(ex.type)>=0&&!used.length){ bad.push(i); return; }
      for(var k=0;k<locked.length;k++){ if(sieveHit(ex,locked[k])){ bad.push(i); reasons[locked[k].name_pl]=1; return; } }
    });
    return {bad:bad,reasons:Object.keys(reasons)};
  };

  window.gramCleanNotation=function(s){
    return String(s==null?'':s).replace(/[~～〜]/g,'').replace(/\[([^\]]{1,30})\]/g,'$1').replace(/\s{2,}/g,' ').trim();
  };

  window.gramMarkTaught=function(id){
    var p=gramPoint(id); if(!p) return;
    var s=loadState(); if(s[id]&&s[id].status==='unlocked') return;
    s[id]={status:'unlocked',taught_at:now(),exposures:0,errors:0,ease:(p.srs&&p.srs.initial_ease)||2.5,interval:1,due:now()+DAY,ts:now()};
    saveState(s); _noNew=0; _push(id,s[id]);
    try{ if(typeof lexGrammarSavePoint==='function') lexGrammarSavePoint(p); }catch(e){}
  };
  /* ── Dowody zamiast wyroku ───────────────────────────────────────────────
     Pierwsza wersja demotowala uznana strukture po jednym bledzie. To zle
     odwzorowuje czlowieka: pomylka bywa pospiechem, nieuwaga, zmeczeniem
     albo pechem przy dwuznacznym zdaniu. Zamiast progu jednego bledu
     zbieramy dowody po obu stronach i cofamy uznanie dopiero, gdy sa
     powtarzalne ORAZ przewazaja nad dowodami znajomosci.

     Efekt uboczny jest pozadany: im wiecej razy uczen uzyl struktury
     poprawnie, tym trudniej ja podwazyc. Uznanie samo sie utwierdza,
     bez ani jednego pytania do uzytkownika. */
  /* Margines dwoch dowodow. Sam bilans „wiecej bledow niz sukcesow" bywa
     krzywdzacy: dwa potkniecia przy jednym trafieniu to jeszcze nie dowod
     nieznajomosci, tylko slaby dzien. Cofamy uznanie dopiero, gdy bledy
     przewazaja WYRAZNIE — a im wiecej uczen ma na koncie poprawnych uzyc,
     tym wiecej potkniec trzeba, zeby go podwazyc. */
  var PROBE_BAD=2, PROBE_MARGIN=2;
  window.gramGrade=function(id,quality){
    if(gramStatus(id)==='presumed'){
      var sp=loadState(), rp=sp[id];
      if(!rp||typeof rp!=='object'||rp.status!=='probe') rp={status:'probe',ok:0,bad:0};
      if(quality>=3) rp.ok=(rp.ok||0)+1; else rp.bad=(rp.bad||0)+1;
      rp.ts=now(); sp[id]=rp; saveState(sp); _push(id,rp);
      if((rp.bad||0)>=PROBE_BAD && (rp.bad||0)-(rp.ok||0)>=PROBE_MARGIN) gramDemote(id,'dowody');
      return;
    }
    var s=loadState(), r=s[id]; if(!r||r.status!=='unlocked') return;
    r.exposures=(r.exposures||0)+1;
    if(quality<3){ r.errors=(r.errors||0)+1; r.interval=1; r.ease=Math.max(1.3,(r.ease||2.5)-0.2); }
    else { r.interval=(r.interval||1)<=1?3:Math.round(r.interval*(r.ease||2.5)); r.ease=Math.min(2.8,(r.ease||2.5)+(quality===5?0.06:0)); }
    r.due=now()+r.interval*DAY; r.ts=now(); s[id]=r; saveState(s); _push(id,r);
  };
  window.gramScaffoldMode=function(id){
    var r=rec(id); if(!r) return 'full';
    if(gramStatus(id)==='stale') return 'full';
    var e=r.exposures||0;
    if(e<2) return 'full';
    if(e<6||(r.errors||0)>0) return 'chip';
    return 'hidden';
  };

  /* ── Sciaga w cwiczeniu (Warstwa 2c) ────────────────────────────────────
     Wzorzec struktury dostepny w trakcie zadania, wygaszany wraz z liczba
     ekspozycji: full (rozwiniety) -> chip (na tapniecie) -> hidden.
     W obrebie jednej porcji schodzi dodatkowo o stopien przy kazdym kolejnym
     cwiczeniu z ta sama struktura — pierwsze ma byc imitacja, ostatnie
     produkcja z pamieci. Klucz to numer cwiczenia, wiec ponowny render tego
     samego kroku nie przesuwa wygaszania. */
  var _scOrder=['full','chip','hidden'];
  var _scSeen={};
  var _gramFocus=null;
  window.gramSetFocus=function(id){ _gramFocus=id||null; };
  window.gramScaffoldReset=function(){ _scSeen={}; };
  function _scStep(id, exIdx){
    var a=_scSeen[id]||(_scSeen[id]=[]);
    var k=a.indexOf(exIdx);
    if(k<0){ a.push(exIdx); k=a.length-1; }
    return k;
  }
  window.gramScaffoldHTML=function(ids, exIdx, exType){
    if(!gramBankReady()) return '';
    // cue i contrast to pretest i rozpoznanie — sciaga zabralaby im sens
    if(exType==='cue'||exType==='contrast') return '';
    var list=[].concat(ids||[]).filter(Boolean);
    // Struktura wprowadzana w tej porcji idzie pierwsza. Bez tego cwiczenie,
    // ktore deklaruje przy okazji strukture tla, pokazywalo wzorzec czegos,
    // czego uczen wlasnie nie cwiczy.
    if(_gramFocus && list.indexOf(_gramFocus)>0){
      list = [_gramFocus].concat(list.filter(function(x){ return x!==_gramFocus; }));
    }
    for(var i=0;i<list.length;i++){
      var id=list[i], p=gramPoint(id);
      if(!p||!p.teach) continue;
      var st=gramStatus(id);
      if(st==='locked') continue;
      // Struktura uznana za znana nie dostaje rusztowania — zalozylismy, ze
      // uczen ja ma. Wzorzec byłby zaprzeczeniem tego zalozenia i zabieral
      // miejsce strukturze, o ktora w tym cwiczeniu chodzi.
      if(st==='presumed') continue;
      var mi=_scOrder.indexOf(gramScaffoldMode(id)); if(mi<0) mi=0;
      mi=Math.min(2, mi+_scStep(id, (exIdx==null?-1:exIdx)));
      var mode=_scOrder[mi];
      if(mode==='hidden') continue;
      var t=p.teach, inner='';
      if(t.rule_pl) inner+='<div class="gram-sc-rule">'+_e(t.rule_pl)+'</div>';
      if(t.paradigm&&t.paradigm.rows&&t.paradigm.rows.length){
        var head=t.paradigm.head||[];
        inner+='<div class="gram-para">';
        if(head.length){
          inner+='<div class="gram-prow gram-phead">'+head.map(function(c){
            return '<div class="gram-pcell">'+_e(c)+'</div>'; }).join('')+'</div>';
        }
        t.paradigm.rows.forEach(function(r){
          var cells=[].concat(r);
          inner+='<div class="gram-prow">'+cells.map(function(c,ci){
            return '<div class="gram-pcell'+((ci===cells.length-1)?' gram-pkey':'')+'">'+_e(c)+'</div>';
          }).join('')+'</div>';
        });
        inner+='</div>';
      }
      if(!inner) continue;
      var open=(mode==='full');
      var lab=(st==='stale')?'Wzorzec — do odswiezenia':'Wzorzec';
      return '<div class="gram-sc'+(open?' open':'')+'">'
        +'<button type="button" class="gram-sc-h" onclick="this.parentNode.classList.toggle(\'open\')">'
        +'<span>'+_e(lab)+'</span><span class="gram-sc-name">'+_e(p.name_pl)+'</span>'
        +'<span class="gram-sc-arw"></span></button>'
        +'<div class="gram-sc-b">'+inner+'</div>'
      +'</div>';
    }
    return '';
  };

  /* Ocena beatu -> SM-2 struktur. Cue i contrast pomijamy: pretest i
     rozpoznanie nie sa swiadectwem opanowania struktury. */
  window.gramBeat=function(ex,correct,attempts){
    if(!ex||!gramBankReady()) return;
    if(ex.type==='cue'||ex.type==='contrast') return;
    var ids=[].concat(ex.uses_grammar||[]).filter(function(id){ return id&&gramPoint(id); });
    if(!ids.length) return;
    if(correct){
      // Sukces obcia¿a wszystkie struktury, ktore musialy zadzialac naraz.
      var q=(attempts&&attempts>0)?3:5;
      ids.forEach(function(id){ gramGrade(id,q); });
      return;
    }
    // Porazka jest przypisywalna tylko wtedy, gdy cwiczenie opieralo sie na
    // JEDNEJ strukturze. Przy kilku nie wiadomo, ktora zawiodla — karanie
    // wszystkich zabiera uznanie strukturom, z ktorymi nie bylo problemu.
    // Wskazanie winnej przy wielu strukturach nalezy do ewaluatora
    // (gramFindByGap), ktory patrzy na tresc bledu, nie na deklaracje.
    if(ids.length===1) gramGrade(ids[0],2);
  };

  /* Postep poziomu jako mapa terenu, nie wynik: bez procentow, serii i ocen. */
  window.gramProgressHTML=function(style){
    try{
      if(!gramBankReady()) return '';
      var g=gramProgress(); if(!g||!g.total) return '';
      var txt=g.level+' \u00b7 '+g.done+' z '+g.total+' struktur';
      // Uczen B1 nie moze zobaczyc „A2 · 0 z 21" i pomyslec, ze system zgubil
      // jego A1. Pominiete pasma pokazujemy wprost, jako osobna kategorie.
      if(g.presumed) txt+=' \u00b7 '+g.presumed+' uznanych za znane';
      var clickable=(typeof window.gramOpenMap==='function');
      if(!clickable) return '<div style="'+(style||'')+'">'+_e(txt)+'</div>';
      return '<button type="button" class="gram-prog" onclick="gramOpenMap()" style="'+(style||'')+'">'
        +_e(txt)+'<span class="gram-prog-i"></span></button>';
    }catch(e){ return ''; }
  };
  /* Wygrywa NAJDLUZSZE dopasowanie, nie pierwsze napotkane. Inaczej krotki
     wykladnik ("masen") wygrywalby z dluzszym, w ktorym sie zawiera
     ("te itadakemasen ka"), i blad trafialby na zla strukture. */
  window.gramFindByGap=function(text){
    if(!gramBankReady()) return null;
    var t=String(text||'').toLowerCase(); if(!t) return null;
    var hit=null, best=0;
    bank().list.forEach(function(p){
      var nm=String(p.name_pl||'').toLowerCase();
      // Nazwa pelna oraz jej czlon glowny przed myslnikiem/dwukropkiem —
      // punkty bez wykladnikow (np. „Present Simple — twierdzenie") inaczej
      // nie daloby sie w ogole dopasowac.
      var nmBase=nm.split(/[—:(]/)[0].trim();
      [nm, nmBase].forEach(function(cand){
        if(cand && cand.length>2 && cand.length>best && t.indexOf(cand)>=0){ hit=p.id; best=cand.length; }
      });
      // Ta sama zasada co w sicie: podciag krotkiego wykladnika trafia
      // przypadkiem w komentarz ewaluatora i demotuje losowa strukture.
      [].concat(p.exponents||[]).forEach(function(e){
        e=String(e==null?'':e).trim().toLowerCase();
        if(!e || e.length<=best) return;
        if(e.length < (e.indexOf(' ')>0 ? 5 : 6)) return;
        var r=_wordRe(e);
        if(r ? r.test(t) : (t.indexOf(e)>=0)){ hit=p.id; best=e.length; }
      });
    });
    return hit;
  };

  window.gramProgress=function(lvl){
    lvl=lvl||gramTeachLevel(); var total=0,done=0,mastered=0;
    bank().list.forEach(function(p){
      if(p.level!==lvl) return; total++;
      var s=gramStatus(p.id);
      if(s==='unlocked'||s==='stale'){ done++; if(gramMastered(p.id)) mastered++; }
    });
    return {level:lvl,done:done,total:total,mastered:mastered,presumed:gramPresumedCount()};
  };

  /* ── Mapa struktur ───────────────────────────────────────────────────────
     Nie jest wymagana do niczego. Domysly robia robote same; kto chce
     sterowac, ma jeden gest. Sekcje sa uporzadkowane wedlug tego, co
     uczen chce wiedziec najpierw: gdzie jestem, co dalej, co pominieto. */
  window.gramMapHTML=function(){
    if(!gramBankReady()) return '<div class="gram-map-empty">Bank struktur nie jest załadowany.</div>';
    var g=gramProgress();
    var done=[], learn=[], now_=[], next=[], pre=[];
    bank().list.forEach(function(p){
      var s=gramStatus(p.id);
      if(s==='unlocked'||s==='stale'){
        (gramMastered(p.id)?done:learn).push([p,s]);
      }
      else if(s==='presumed') pre.push([p,s]);
      else if(s==='teachable') now_.push([p,s]);
      else next.push([p,s]);
    });
    function row(x,extra){
      var p=x[0], s=x[1];
      // Wiersz rozwija pelna karte reguly. Powtorka na zadanie, bez osobnego
      // trybu nauki gramatyki — regula jest tam, gdzie uczen o niej mysli.
      return '<div class="gram-map-item" data-gram-id="'+_e(p.id)+'">'
        +'<div class="gram-map-row" data-gram-open="'+_e(p.id)+'">'
        +'<span class="gram-map-lvl">'+_e(p.level)+'</span>'
        +'<span class="gram-map-nm">'+_e(p.name_pl)+'</span>'
        +(s==='stale'?'<span class="gram-map-tag">do powtórki</span>':'')
        +(extra||'')
        +'<span class="gram-map-chev"></span></div>'
        +'<div class="gram-map-rule"></div></div>';
    }
    function sec(t,arr,cap,extra){
      if(!arr.length) return '';
      var shown=cap?arr.slice(0,cap):arr;
      var out='<div class="gram-map-sec">'+t+'</div>'+shown.map(function(x){ return row(x,extra?extra(x):''); }).join('');
      if(cap&&arr.length>cap) out+='<div class="gram-map-more">i '+(arr.length-cap)+' dalszych</div>';
      return out;
    }
    var _lead=g.level+' \u00b7 '+g.done+' z '+g.total+' poznanych';
    if(g.done) _lead+=' \u00b7 '+g.mastered+(g.mastered===1?' opanowana':' opanowanych');
    var out='<div class="gram-map-lead">'+_e(_lead)+'</div>';
    // Znak horyzontu. Bank konczy sie ponizej poziomu ucznia — bez tej linii
    // dopracowany widok mowi „tyle jest gramatyki w tym jezyku", co jest
    // nieprawda. Lepiej powiedziec wprost, gdzie konczy sie mapa.
    if(bankMaxIdx()>=0 && bankMaxIdx()<anchorIdx()){
      out+='<div class="gram-map-horizon">Mapa obejmuje na razie poziomy do '
        +_e(LEVELS[bankMaxIdx()])+'. Wy\u017csze przygotowujemy.</div>';
    }
    out+=sec('Opanowane',done);
    out+=sec('W nauce',learn);
    out+=sec('Najbliżej',now_,6);
    out+=sec('Dalej',next,8);
    if(pre.length){
      out+='<details class="gram-map-det"><summary>'+pre.length+' uznanych za znane — nie są nauczane</summary>'
        +pre.map(function(x){
          return row(x,'<button type="button" class="gram-map-btn" data-gram-demote="'+_e(x[0].id)+'">Nie znam</button>');
        }).join('')+'</details>';
    }
    return out;
  };
  /* Porzadek istnieje — tylko nie widac go z lekcji. Bez tej linii zmiennosc
     („raz struktura jest, raz jej nie ma") wyglada na przypadek, a jest
     nastepstwem frontu i stanu ucznia. Pokazujemy najblizszych kandydatow
     jako informacje, nie jako obietnice: model wybiera sposrod nich tego,
     ktory pasuje do slownictwa porcji. */
  window.gramUpcomingHTML=function(style){
    try{
      if(!gramBankReady()) return '';
      var f=gramFrontier(2).map(function(id){ var p=gramPoint(id); return p?p.name_pl:null; }).filter(Boolean);
      if(!f.length) return '';
      return '<div style="'+(style||'')+'">Najbliżej: '+_e(f.join(' \u00b7 '))+'</div>';
    }catch(e){ return ''; }
  };
  window.gramMapBind=function(root, rerender){
    if(!root||!root.addEventListener) return;
    function up(t,attr){
      while(t&&t!==root){ if(t.getAttribute&&t.getAttribute(attr)) return t; t=t.parentNode; }
      return null;
    }
    root.addEventListener('click',function(ev){
      var d=up(ev.target,'data-gram-demote');
      if(d){
        ev.preventDefault(); ev.stopPropagation();
        if(gramDemote(d.getAttribute('data-gram-demote'),'user')&&typeof rerender==='function') rerender();
        return;
      }
      var o=up(ev.target,'data-gram-open');
      if(!o) return;
      ev.preventDefault();
      var item=o.parentNode, box=item?item.querySelector('.gram-map-rule'):null;
      if(!box) return;
      // Karty renderujemy dopiero na tapniecie — przy czterdziestu punktach
      // budowanie wszystkich z gory to zbedna praca i sciana tekstu.
      if(!box.getAttribute('data-gotowe')){
        try{ box.innerHTML=gramCardHTML(o.getAttribute('data-gram-open'),{eyebrow:''}); }catch(e){ return; }
        box.setAttribute('data-gotowe','1');
      }
      item.classList.toggle('open');
    });
  };

  /* ── Synchronizacja z Supabase ───────────────────────────────────────────
     localStorage zostaje jako cache i tryb offline; zrodlem prawdy jest
     tabela grammar_progress. Zapisy PUNKTOWE — jeden wiersz na zmiane,
     nigdy caly stan, inaczej pozniejsza sesja nadpisuje wczesniejsza. */
  function _sb(){ try{ if(typeof db!=='undefined'&&db) return db; }catch(e){} return window.db||null; }
  async function _uid(){
    try{ if(typeof UID!=='undefined'&&UID) return UID; }catch(e){}
    try{
      var d=_sb(); if(!d) return null;
      var s=await d.auth.getSession();
      return (s&&s.data&&s.data.session&&s.data.session.user)?s.data.session.user.id:null;
    }catch(e){ return null; }
  }
  function _push(id,r){
    try{
      var d=_sb(); if(!d||!r) return;
      var l=lang();
      _uid().then(function(u){
        if(!u) return;
        // Zapisy probne nie maja wlasnych kolumn — dowody mieszcza sie w tych
        // samych licznikach: trafienia jako exposures, potkniecia jako errors.
        var _pr=(r.status==='probe');
        var row={ user_id:u, lang:l, point_id:id, status:r.status||'unlocked',
          ease:_pr?null:(r.ease==null?null:r.ease),
          interval_days:_pr?null:(r.interval==null?null:r.interval),
          due:(!_pr&&r.due)?new Date(r.due).toISOString():null,
          exposures:_pr?(r.ok||0):(r.exposures||0), errors:_pr?(r.bad||0):(r.errors||0),
          taught_at:r.taught_at?new Date(r.taught_at).toISOString():null,
          updated_at:new Date(r.ts||now()).toISOString() };
        var q=d.from('grammar_progress').upsert(row,{onConflict:'user_id,lang,point_id'});
        if(q&&q.then) q.then(function(res){
          if(res&&res.error) try{ console.warn('[gram] zapis nieudany:',res.error.message); }catch(e){}
        });
      });
    }catch(e){}
  }
  var _pulled={};
  window.gramSyncPull=async function(l){
    l=l?_gramNormCode(l):lang();
    if(_pulled[l]) return 0;
    var d=_sb(); if(!d) return 0;
    try{
      var u=await _uid(); if(!u) return 0;
      _pulled[l]=1;
      var res=await d.from('grammar_progress')
        .select('point_id,status,ease,interval_days,due,exposures,errors,taught_at,updated_at')
        .eq('user_id',u).eq('lang',l);
      if(res.error||!res.data) return 0;
      var k=(function(){ try{ return uk('lex_gram_state_'+l); }catch(e){ return 'lex_gram_state_'+l; } })();
      var s={}; try{ s=JSON.parse(localStorage.getItem(k)||'{}'); }catch(e){ s={}; }
      var n=0;
      res.data.forEach(function(row){
        var ts=row.updated_at?Date.parse(row.updated_at):0;
        var loc=s[row.point_id];
        if(loc&&(loc.ts||0)>=ts) return;          // lokalny zapis nowszy — zostaje
        if(row.status==='probe'){
          s[row.point_id]={ status:'probe', ok:row.exposures||0, bad:row.errors||0, ts:ts };
        } else {
          s[row.point_id]={ status:row.status||'unlocked', ease:row.ease||2.5,
            interval:row.interval_days||1, due:row.due?Date.parse(row.due):0,
            exposures:row.exposures||0, errors:row.errors||0,
            taught_at:row.taught_at?Date.parse(row.taught_at):0, ts:ts };
        }
        n++;
      });
      try{ localStorage.setItem(k,JSON.stringify(s)); }catch(e){}
      dropState();
      if(n) try{ console.info('[gram] pobrano z Supabase:',n,'struktur ('+l+')'); }catch(e){}
      return n;
    }catch(e){ _pulled[l]=0; return 0; }
  };
})();
