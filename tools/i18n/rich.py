import re,sys,json
from bs4 import BeautifulSoup, NavigableString, Tag
INLINE={'b','i','em','strong','a','span','br','small','u','mark','sup','sub','code','kbd','s'}
PL=re.compile(r'[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(i|w|z|na|do|nie|się|jest|dla|od|po|już|jak|co)\b')
def norm(h): return re.sub(r'\s+',' ',h.replace(' ',' ')).strip()
out=set()
for f in sys.argv[1:]:
    s=open(f).read()
    s=re.sub(r'<script[^>]*>.*?</script>','',s,flags=re.S)
    soup=BeautifulSoup(s,'lxml')
    for el in soup.find_all(True):
        if el.name in INLINE and el.name!='span': continue
        kids=list(el.children)
        if not any(isinstance(k,Tag) for k in kids): continue
        if any(isinstance(k,Tag) and (k.name not in INLINE or any(isinstance(g,Tag) and g.name not in INLINE for g in k.descendants)) for k in kids): continue
        txt=el.get_text(' ')
        if not PL.search(txt) or len(txt)>1500: continue
        if not any(isinstance(k,NavigableString) and k.strip() for k in kids) and len([k for k in kids if isinstance(k,Tag)])<2: continue
        out.add(norm(el.decode_contents()))
json.dump(sorted(out),open('rich_cands.json','w'),ensure_ascii=False,indent=0)
print(len(out))
