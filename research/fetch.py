"""Weekend-gap study: does the off-hours Aerodrome / Hyperliquid price predict the Monday reopen of Coinbase tokenized stocks on Base?"""
import json, time, urllib.request, datetime as dt, csv, math, sys, os
UA={'User-Agent':'Mozilla/5.0','content-type':'application/json'}
RPC='https://mainnet.base.org'
FEEDS={'AAPL':'0x787f13dEa48Db0897CbCDD985de77809D837F988','AMZN':'0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295','GOOGL':'0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2','META':'0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D','MSFT':'0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c','MSTR':'0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a','NVDA':'0x04689a41629776563E6822F76f2e57D148d28513','SNDK':'0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA','SPCX':'0x6A634B235903C4ad6376892180d6fF8612e3Fa68','TSLA':'0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4'}
TOK={'NVDA':'0xb20000000000000000000078ee7ce2fE4908108C','META':'0xb2000000000000000000008bC8786B856E61707C','AAPL':'0xb200000000000000000000C2e324d24d7eEcd1fb','GOOGL':'0xb2000000000000000000002D0BA3164cc74f58B7','AMZN':'0xb200000000000000000000d9192b6B456483C2E8','MSFT':'0xB200000000000000000000Ab99cFa739E253872B','MSTR':'0xb2000000000000000000004884b426556b92883d','SNDK':'0xb200000000000000000000397293Cb8cda9a10c5','SPCX':'0xb2000000000000000000007b9fcbd005511aCBd5','TSLA':'0xb2000000000000000000001e800a7f5189430cD0'}
START=int(dt.datetime(2026,8,20,tzinfo=dt.timezone.utc).timestamp())
CACHE='cache'; os.makedirs(CACHE,exist_ok=True)
def http(url,obj=None):
    for a in range(8):
        try:
            r=urllib.request.Request(url,data=json.dumps(obj).encode() if obj is not None else None,headers=UA)
            return json.load(urllib.request.urlopen(r,timeout=30))
        except urllib.error.HTTPError as e:
            if e.code==429: print('429, sleeping',file=sys.stderr); time.sleep(65); continue
            if a==7: raise
            time.sleep(3*(a+1))
        except Exception as e:
            if a==7: raise
            time.sleep(3*(a+1))
def cached(name,fn):
    p=f'{CACHE}/{name}.json'
    if os.path.exists(p): return json.load(open(p))
    v=fn(); json.dump(v,open(p,'w')); return v
# ---------- Chainlink rounds (all phases)
def call(to,data): return http(RPC,{'jsonrpc':'2.0','id':1,'method':'eth_call','params':[{'to':to,'data':data},'latest']})['result']
def rounds(feed):
    latest=call(feed,'0xfeaf968c')[2:]; rid=int(latest[:64],16)
    phase=rid>>64; out=[]
    while phase>=1:
        agg=(rid & ((1<<64)-1)) if phase==(int(latest[:64],16)>>64) else None
        if agg is None:  # find last round of an older phase by probing getRoundData
            agg=None
        # walk backwards in batches
        hi = agg if agg is not None else probe_last(feed,phase)
        if not hi: phase-=1; continue
        r=hi; done=False
        while r>=1 and not done:
            ids=list(range(r,max(0,r-100),-1))
            batch=[{'jsonrpc':'2.0','id':i,'method':'eth_call','params':[{'to':feed,'data':'0x9a6fc8f5'+format((phase<<64)|x,'064x')},'latest']} for i,x in enumerate(ids)]
            res=http(RPC,batch); res=sorted(res,key=lambda z:z['id'])
            for x,z in zip(ids,res):
                h=z.get('result','0x')[2:]
                if len(h)<320: continue
                ans=int(h[64:128],16); 
                if ans>=1<<255: ans-=1<<256
                upd=int(h[192:256],16)
                if upd==0: continue
                if upd<START: done=True; break
                out.append((upd,ans/1e8))
            r-=100; time.sleep(0.15)
        if done: break
        phase-=1
    return sorted(set(map(tuple,out)))
def probe_last(feed,phase):
    lo,hi=0,1
    def ok(x):
        h=call(feed,'0x9a6fc8f5'+format((phase<<64)|x,'064x'))
        return h and len(h)>=322 and int(h[2+192:2+256],16)>0
    try:
        while ok(hi): lo=hi; hi*=2
    except Exception: pass
    while hi-lo>1:
        m=(lo+hi)//2
        try: good=ok(m)
        except Exception: good=False
        lo,hi=(m,hi) if good else (lo,m)
    return lo
# ---------- DEX hourly candles (top Aerodrome pool)
def top_pool(tok):
    d=http(f'https://api.geckoterminal.com/api/v2/networks/base/tokens/{tok}/pools?page=1'); time.sleep(4)
    out=[]
    for p in d.get('data',[]):
        a=p['attributes']; dexid=p['relationships']['dex']['data']['id']
        if 'aerodrome' not in dexid: continue
        if float(a.get('reserve_in_usd') or 0)<20000: continue
        out.append(a['address'])
    return out[:4]
def dex_candles(pools):
    best={}  # hour -> (vol, o, c): keep the pool with the highest volume in each hour
    for pool in pools:
        before=int(time.time())
        while before>START:
            d=http(f'https://api.geckoterminal.com/api/v2/networks/base/pools/{pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd&before_timestamp={before}')
            lst=(d.get('data') or {}).get('attributes',{}).get('ohlcv_list') or []
            time.sleep(4)
            if not lst: break
            for t,o,h,l,c,v in lst:
                if int(t)<START: continue
                if int(t) not in best or v>best[int(t)][0]: best[int(t)]=(v,o,c)
            nb=min(int(x[0]) for x in lst)
            if nb>=before: break
            before=nb
    return sorted((t,o,c,v) for t,(v,o,c) in best.items())
def hl_candles(t):
    out=[]; s=START*1000
    while True:
        d=http('https://api.hyperliquid.xyz/info',{'type':'candleSnapshot','req':{'coin':f'xyz:{t}','interval':'1h','startTime':s,'endTime':int(time.time()*1000)}})
        if not d: break
        out+= [(c['t']//1000,float(c['o']),float(c['c']),float(c['v'])) for c in d]
        if len(d)<5000: break
        s=d[-1]['t']+1
    return sorted(set(out))
# ---------- market calendar
HOLI={dt.date(2026,9,7)}  # Labor Day
def et_offset(day): return -4 if day < dt.date(2026,11,1) else -5
def weekends():
    d=dt.date(2026,8,28)
    while True:
        fri=d; mon=d+dt.timedelta(days=3)
        reopen=mon
        while reopen in HOLI: reopen+=dt.timedelta(days=1)
        fclose=dt.datetime(fri.year,fri.month,fri.day,16,0,tzinfo=dt.timezone(dt.timedelta(hours=et_offset(fri)))).timestamp()
        ropen=dt.datetime(reopen.year,reopen.month,reopen.day,9,30,tzinfo=dt.timezone(dt.timedelta(hours=et_offset(reopen)))).timestamp()
        if ropen+3*3600>time.time(): break
        yield fri,reopen,int(fclose),int(ropen); d+=dt.timedelta(days=7)
def asof(series,ts):  # last close with candle END <= ts (hourly candle t..t+3600)
    v=None
    for t,o,c,*_ in series:
        if t+3600<=ts: v=c
        else: break
    return v
def cl_asof(rs,ts):
    v=None
    for u,a in rs:
        if u<=ts: v=a
        else: break
    return v
rows=[]
for tk in FEEDS:
    rs=cached(f'cl_{tk}',lambda: rounds(FEEDS[tk]))
    pool=cached(f'pool_{tk}',lambda: top_pool(TOK[tk]))
    dx=cached(f'dex_{tk}',lambda: dex_candles(pool)) if pool else []
    if dx: print(tk,'dex from',dt.datetime.utcfromtimestamp(dx[0][0]).date(),file=sys.stderr)
    hl=cached(f'hl_{tk}',lambda: hl_candles(tk))
    print(tk,'rounds',len(rs),'dex',len(dx),'hl',len(hl),file=sys.stderr)
    for fri,reopen,fc,ro in weekends():
        pre=[(u,a) for u,a in rs if u<=ro-60]
        if not pre: continue
        t_ref,fri_cl=pre[-1]                    # moment + value at which Chainlink froze before the reopen
        true=cl_asof(rs,ro+3600)                # Chainlink 60 min after the open
        if not dx or dx[0][0]>t_ref-3600 or true is None or ro-t_ref<12*3600: continue
        dex_ref=asof(dx,t_ref+3599); dex_pre=asof(dx,ro); hl_ref=asof(hl,t_ref+3599); hl_pre=asof(hl,ro)
        if None in (dex_ref,dex_pre): continue
        upd_after=any(ro<=u<=ro+3600 for u,_ in rs)
        rows.append(dict(ticker=tk,friday=str(fri),reopen=str(reopen),frozen_at=dt.datetime.utcfromtimestamp(t_ref).strftime('%a %H:%M'),
            cl_frozen=fri_cl,cl_true=true,cl_updated_in_first_hour=upd_after,
            true_gap=100*(true/fri_cl-1), dex_gap=100*(dex_pre/dex_ref-1), hl_gap=(100*(hl_pre/hl_ref-1) if hl_ref and hl_pre else None),
            dex_level_vs_cl=100*(dex_pre/fri_cl-1)))
with open('weekend_gaps.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
def stats(key,rows):
    r=[x for x in rows if x[key] is not None]
    n=len(r); 
    if n<3: return None
    e=[abs(x[key]-x['true_gap']) for x in r]; e0=[abs(x['true_gap']) for x in r]
    big=[x for x in r if abs(x['true_gap'])>=0.5]
    hit=sum(1 for x in big if x[key]*x['true_gap']>0)
    mx=sum(x[key] for x in r)/n; my=sum(x['true_gap'] for x in r)/n
    cov=sum((x[key]-mx)*(x['true_gap']-my) for x in r); vx=sum((x[key]-mx)**2 for x in r); vy=sum((x['true_gap']-my)**2 for x in r)
    return dict(n=n,mae_pp=round(sum(e)/n,3),naive_mae_pp=round(sum(e0)/n,3),corr=round(cov/math.sqrt(vx*vy),3) if vx and vy else None,
                sign_hit=f'{hit}/{len(big)}',median_err_pp=round(sorted(e)[n//2],3))
summary={'level':stats('dex_level_vs_cl',rows),'weekends':sorted({x['reopen'] for x in rows}),'obs':len(rows),'dex':stats('dex_gap',rows),'hl':stats('hl_gap',rows),
         'cl_updated_in_first_hour_share':round(sum(x['cl_updated_in_first_hour'] for x in rows)/len(rows),2)}
json.dump(summary,open('summary.json','w'),indent=1); print(json.dumps(summary,indent=1))
