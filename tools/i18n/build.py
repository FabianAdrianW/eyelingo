import json,re,sys
raw=json.load(open('en_raw.json'))
def unesc(s):
    def r(m):
        g=m.group(1)
        if g.startswith('u'): 
            try: return chr(int(g[1:],16))
            except: return m.group(0)
        return {'n':'\n','t':'\t',"'":"'",'"':'"','\\':'\\','/':'/'}.get(g,g)
    return re.sub(r'\\(u[0-9a-fA-F]{4}|.)',r,s)
out={}
bad=re.compile(r'(\{|\}|=>|;\s*$|^[#.\[]|\bonclick\b|style=|class=|\bvar\b|function\(|\$\{|<|>)')
for k,v in raw.items():
    if not v or not isinstance(v,str): continue
    k2=unesc(k).strip(); v2=unesc(v).strip()
    if not k2 or k2==v2 or bad.search(k2) or '\n' in k2: continue
    if len(k2)>600: continue
    out[k2]=v2
manual={"i":"and","lub":"or","oraz":"and","albo":"or","oraz z":"and with","fiszka":"card","fiszki":"cards","fiszek":"cards","fiszkę":"card","Fiszki":"Flashcards","zestaw":"set","zestawy":"sets","zestawów":"sets","słowo":"word","słowa":"words","słów":"words","słówek":"words","dni":"days","dzień":"day","minut":"minutes","minuty":"minutes","Bisson i in. 2014 · Peters 2016 · Webb i Chang 2022 (150+ — szacunek własny)":"Bisson et al. 2014 · Peters 2016 · Webb & Chang 2022 (150+ — our own estimate)","Polski":"Polish","polski":"Polish","Angielski":"English","angielski":"English","Język":"Language","Język ojczysty":"Native language"}
import re as _re
for k,v in list(out.items()):
    if len(k)<90 and 'Polish' in v and 'app' not in v and not _re.search(r'(translation|JSON|word|field|Respond|Provide|TASK|axis)',v,_re.I):
        out[k]=v.replace('Polish','English')
    if v=='Lesson: PL': out[k]='Lesson: EN'
manual.update({"Polski":"English","polski":"English","PL":"EN","Kierunek:":"Direction:","Kierunek":"Direction","Obcy":"Foreign","obcy":"foreign"})
manual.update({
 "PRO odblokowuje wszystkie poziomy.":"PRO unlocks all levels.",
 "PRO odblokowuje wszystkie poziomy i funkcje":"PRO unlocks all levels and features",
 "Plan darmowy: do # fiszek w zestawie · Subskrypcja = bez limitu":"Free plan: up to # cards per set · Subscription = unlimited",
 "Subskrypcja odblokuje nieograniczone zestawy":"A subscription unlocks unlimited sets",
 "Odblokuj poziom":"Unlock level",
 "Subskrypcja":"Subscription",
 "Subskrypcja roczna · # zł/rok":"Annual subscription · # PLN/year",
 "Subskrypcja miesięczna · # zł/mies":"Monthly subscription · # PLN/month",
 "Subskrypcja odnawia się automatycznie co miesiąc (# zł) lub co rok (# zł), dopóki jej nie anulujesz. Anulować możesz w każdej chwili — napisz na eyelingo.app@gmail.com lub użyj panelu płatności.":"The subscription renews automatically every month (# PLN) or every year (# PLN) until you cancel it. You can cancel at any time — write to eyelingo.app@gmail.com or use the billing portal.",
 "Poprzednia kategoria":"Previous category",
 "Kliknij przycisk → naciśnij kombinację. ✖ = wyłącz":"Click a button → press the key combination. ✖ = disable",
 "[ naciśnij kombinację… ]":"[ press the combination… ]",
 "Masz najnowszą wersję":"You have the latest version",
})
out.update(manual)
out.update(json.load(open('manual_extra.json')))   # ręczne poprawki naniesione wcześniej wprost na en.json
rich=json.load(open('rich_raw.json'))
out['__rich']={k:v for k,v in rich.items() if v and k!=v}
json.dump(out,open(sys.argv[1],'w'),ensure_ascii=False,separators=(',',':'),sort_keys=True)
print(len(out))
