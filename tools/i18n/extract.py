import re,sys,json,html
PLCH=re.compile('[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]')
def jsstrings(code):
    out=[];i=0;n=len(code)
    while i<n:
        c=code[i]
        if c in '"\'`':
            q=c;j=i+1;buf=[];parts=[]
            while j<n and code[j]!=q:
                if code[j]=='\\' and j+1<n: buf.append(code[j:j+2]); j+=2; continue
                if q=='`' and code[j]=='$' and j+1<n and code[j+1]=='{':
                    parts.append(''.join(buf)); buf=[]; d=1; j+=2
                    while j<n and d: 
                        d+= code[j]=='{'; d-= code[j]=='}'; j+=1
                    continue
                if q!='`' and code[j]=='\n': break
                buf.append(code[j]); j+=1
            parts.append(''.join(buf)); out+=parts; i=j+1; continue
        if c=='/' and i+1<n and code[i+1]=='/':
            k=code.find('\n',i); i=n if k<0 else k; continue
        if c=='/' and i+1<n and code[i+1]=='*':
            k=code.find('*/',i+2); i=n if k<0 else k+2; continue
        i+=1
    return out
cands=set()
def add(t):
    t=html.unescape(t)
    # split html inside js strings into text segments
    for seg in re.split(r'<[^>]*>',t):
        seg=seg.strip()
        if len(seg)<2 or not re.search('[A-Za-zĄ-ż]',seg): continue
        if re.fullmatch(r'[\w.#\-:/%()\[\]=,;!?+*&|^$]*',seg) and not PLCH.search(seg) and ' ' not in seg:
            # single token: keep only if capitalized word-like
            if not re.fullmatch(r'[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{2,}',seg): continue
        if re.search(r'(function|var |=>|\{|\};|document\.|window\.|px;|rgba\()',seg): continue
        cands.add(seg)
for f in sys.argv[1:]:
    s=open(f).read()
    if f.endswith('.js'):
        [add(t) for t in jsstrings(s)]; continue
    for m in re.finditer(r'<script[^>]*>(.*?)</script>',s,re.S):
        for t in jsstrings(m.group(1)): add(t)
    body=re.sub(r'<script[^>]*>.*?</script>|<style[^>]*>.*?</style>','',s,flags=re.S)
    for m in re.finditer(r'>([^<]+)<',body): add(m.group(1))
    for m in re.finditer(r'(?:placeholder|title|aria-label|alt|content)="([^"]+)"',body): add(m.group(1))
json.dump(sorted(cands),open('cands.json','w'),ensure_ascii=False,indent=0)
print(len(cands), sum(1 for c in cands if PLCH.search(c)))
