import json, os, math, datetime as dt, csv
TK=['AAPL','AMZN','GOOGL','META','MSFT','MSTR','NVDA','SNDK','SPCX','TSLA']
HOLI={dt.date(2026,9,7)}
def off(d): return -4 if d < dt.date(2026,11,1) else -5
def wk():
    d=dt.date(2026,8,28)
    while True:
        r=d+dt.timedelta(days=3)
        while r in HOLI: r+=dt.timedelta(days=1)
        ro=int(dt.datetime(r.year,r.month,r.day,9,30,tzinfo=dt.timezone(dt.timedelta(hours=off(r)))).timestamp())
        if ro>1795300000: break
        yield r,ro; d+=dt.timedelta(days=7)
def asof(series,ts):
    v=None
    for t,o,c,*_ in series:
        if t+3600<=ts: v=c
        else: break
    return v
L=lambda p: json.load(open(p)) if os.path.exists(p) else []
rows=[]
for tk in TK:
    rs=L(f'cache/cl_{tk}.json'); hl=L(f'cache/hl_{tk}.json'); dx=L(f'cache/dex_{tk}.json')
    for r,ro in wk():
        pre=[(u,a) for u,a in rs if u<=ro-60]
        if not pre or not hl: continue
        tref,clf=pre[-1]
        if ro-tref<12*3600: continue
        h0=asof(hl,tref+3599); hpre=asof(hl,ro); htrue=asof(hl,ro+3600)
        if None in (h0,hpre,htrue): continue
        row=dict(ticker=tk,reopen=str(r),true=100*(htrue/h0-1),hl=100*(hpre/h0-1))
        if dx and dx[0][0]<=tref-3600:
            d0=asof(dx,tref+3599); dpre=asof(dx,ro); dtrue=asof(dx,ro+3600)
            if None not in (d0,dpre,dtrue): row.update(dex=100*(dpre/d0-1),dex_true=100*(dtrue/d0-1))
        rows.append(row)
def st(rows,pk,tk_='true'):
    r=[x for x in rows if pk in x and tk_ in x]; n=len(r)
    if n<3: return None
    e=[abs(x[pk]-x[tk_]) for x in r]; e0=[abs(x[tk_]) for x in r]
    big=[x for x in r if abs(x[tk_])>=0.5]; hit=sum(x[pk]*x[tk_]>0 for x in big)
    mx=sum(x[pk] for x in r)/n; my=sum(x[tk_] for x in r)/n
    vx=sum((x[pk]-mx)**2 for x in r); vy=sum((x[tk_]-my)**2 for x in r); cv=sum((x[pk]-mx)*(x[tk_]-my) for x in r)
    beta=cv/vx if vx else None
    return dict(n=n,mae=round(sum(e)/n,2),naive_mae=round(sum(e0)/n,2),improvement=f"{100*(1-sum(e)/sum(e0)):.0f}%",
                corr=round(cv/math.sqrt(vx*vy),2),beta=round(beta,2),sign=f"{hit}/{len(big)}",mean_abs_true=round(sum(e0)/n,2))
S={'weekends':len({x['reopen'] for x in rows}),'hl_vs_hl_open':st(rows,'hl'),'dex_vs_dex_open':st(rows,'dex','dex_true'),'dex_vs_hl_open':st(rows,'dex')}
print(json.dumps(S,indent=1))
with open('weekend_gaps_v2.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['ticker','reopen','true','hl','dex','dex_true']); w.writeheader(); w.writerows(rows)
json.dump(S,open('summary_v2.json','w'),indent=1)
