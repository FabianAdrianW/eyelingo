import json,sys,urllib.request,concurrent.futures as cf,os
T=open('../.tok').read().strip()
U='https://sntlgkhktscezxpxrchl.supabase.co/functions/v1/translate-native'
src=sys.argv[1]; dst=sys.argv[2]
c=json.load(open(src))
done=json.load(open(dst)) if os.path.exists(dst) else {}
todo=[s for s in c if s not in done]
B=int(os.environ.get("B","100"))
batches=[todo[i:i+B] for i in range(0,len(todo),B)]
def run(b):
    items=[{"i":k,"t":s} for k,s in enumerate(b)]
    for a in range(3):
        try:
            req=urllib.request.Request(U,data=json.dumps({"mode":"ui","items":items}).encode(),headers={"x-job-token":T,"Content-Type":"application/json"})
            r=json.load(urllib.request.urlopen(req,timeout=170))
            out={}
            for x in r.get('items',[]):
                i=x.get('i')
                if isinstance(i,int) and 0<=i<len(b): out[b[i]]=x.get('en')
            return out
        except Exception as e: print('err',e,file=sys.stderr)
    return {}
with cf.ThreadPoolExecutor(5) as ex:
    for out in ex.map(run,batches):
        done.update(out); json.dump(done,open(dst,'w'),ensure_ascii=False,indent=0)
print(len(c),len(done),sum(1 for v in done.values() if v))
