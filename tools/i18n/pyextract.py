import tokenize,io,ast,json,re,sys
src=open(sys.argv[1]).read()
out=set()
PL=re.compile(r'[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(Zestaw\w*|Dalej|Zapisz|Zamknij|Anuluj|Ucz\w*|Wybierz|Język\w*|Konto|Zaloguj\w*|Wyloguj\w*|fiszk\w*|Powt\w*|Start|Pauza|Ustawienia|Kategori\w*|Poziom\w*)\b')
for t in tokenize.generate_tokens(io.StringIO(src).readline):
    if t.type==tokenize.STRING:
        try: v=ast.literal_eval(t.string)
        except Exception: 
            # f-strings: take literal parts
            v=re.sub(r'\{[^{}]*\}','\u0001',t.string.lstrip('rbfRBF')[1:-1])
            for part in v.split('\u0001'):
                part=part.strip()
                if part and PL.search(part) and len(part)<500: out.add(part)
            continue
        if isinstance(v,str):
            for seg in re.split(r'<[^>]*>',v):
                seg=seg.strip()
                if seg and PL.search(seg) and len(seg)<500 and '\n' not in seg: out.add(seg)
json.dump(sorted(out),open('py_cands.json','w'),ensure_ascii=False,indent=0)
print(len(out))
