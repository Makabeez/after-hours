// Shared data layer: Chainlink (Base), Aerodrome via DexScreener, Hyperliquid xyz perps, US market calendar.
export const STOCKS = [
  { t: 'NVDA', name: 'NVIDIA',    token: '0xb20000000000000000000078ee7ce2fE4908108C', feed: '0x04689a41629776563E6822F76f2e57D148d28513' },
  { t: 'TSLA', name: 'Tesla',     token: '0xb2000000000000000000001e800a7f5189430cD0', feed: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4' },
  { t: 'AAPL', name: 'Apple',     token: '0xb200000000000000000000C2e324d24d7eEcd1fb', feed: '0x787f13dEa48Db0897CbCDD985de77809D837F988' },
  { t: 'MSFT', name: 'Microsoft', token: '0xB200000000000000000000Ab99cFa739E253872B', feed: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c' },
  { t: 'META', name: 'Meta',      token: '0xb2000000000000000000008bC8786B856E61707C', feed: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D' },
  { t: 'AMZN', name: 'Amazon',    token: '0xb200000000000000000000d9192b6B456483C2E8', feed: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295' },
  { t: 'GOOGL',name: 'Alphabet',  token: '0xb2000000000000000000002D0BA3164cc74f58B7', feed: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2' },
  { t: 'MSTR', name: 'Strategy',  token: '0xb2000000000000000000004884b426556b92883d', feed: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a' },
  { t: 'SPCX', name: 'SpaceX',    token: '0xb2000000000000000000007b9fcbd005511aCBd5', feed: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68' },
  { t: 'SNDK', name: 'SanDisk',   token: '0xb200000000000000000000397293Cb8cda9a10c5', feed: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA' },
];
const RPC = process.env.BASE_RPC || 'https://mainnet.base.org';
const UA = { 'User-Agent': 'after-hours/0.1', 'content-type': 'application/json' };

async function j(url, body) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: UA, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

// ---------- US equity calendar (NYSE), America/New_York via Intl
const HOLIDAYS = new Set(['2026-11-26', '2026-12-25', '2027-01-01', '2027-01-18', '2027-02-15']);
const EARLY_CLOSE = { '2026-11-27': 13, '2026-12-24': 13 };
function nyParts(ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, h: +p.hour % 24, m: +p.minute };
}
function nyToUtc(date, h, m) { // find UTC ms for a NY wall-clock time
  const guess = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  for (const off of [4, 5]) { const t = guess + off * 3600e3; const p = nyParts(t); if (p.date === date && p.h === h && p.m === m) return t; }
  return guess + 5 * 3600e3;
}
const isTradingDay = d => { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); return wd > 0 && wd < 6 && !HOLIDAYS.has(d); };
const addDay = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export function marketClock(now = Date.now()) {
  const today = nyParts(now).date;
  const sess = d => ({ open: nyToUtc(d, 9, 30), close: nyToUtc(d, EARLY_CLOSE[d] || 16, 0) });
  if (isTradingDay(today)) { const s = sess(today); if (now >= s.open && now < s.close) return { open: true, sessionOpen: s.open, closesAt: s.close }; }
  let d = today, lastClose = null, nextOpen = null;
  for (let i = 0; i < 10 && !lastClose; i++) { if (isTradingDay(d) && sess(d).close <= now) lastClose = sess(d).close; d = addDay(d, -1); }
  d = today;
  for (let i = 0; i < 10 && !nextOpen; i++) { if (isTradingDay(d) && sess(d).open > now) nextOpen = sess(d).open; d = addDay(d, 1); }
  return { open: false, lastClose, nextOpen };
}

// ---------- sources
async function chainlink() {
  const batch = STOCKS.map((s, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_call', params: [{ to: s.feed, data: '0xfeaf968c' }, 'latest'] }));
  const res = await j(RPC, batch);
  const out = {};
  for (const r of res) {
    const h = (r.result || '0x').slice(2); if (h.length < 320) continue;
    out[STOCKS[r.id].t] = { price: Number(BigInt('0x' + h.slice(64, 128))) / 1e8, updatedAt: Number(BigInt('0x' + h.slice(192, 256))) * 1000 };
  }
  return out;
}
async function aerodrome() {
  // one request per token: DexScreener caps a multi-token query at 30 pairs, which silently drops tickers
  const all = await Promise.all(STOCKS.map(s => j(`https://api.dexscreener.com/latest/dex/tokens/${s.token}`).catch(() => ({ pairs: [] }))));
  const out = {};
  for (const [i, s] of STOCKS.entries()) {
    const pools = (all[i].pairs || []).filter(p => p.baseToken.address.toLowerCase() === s.token.toLowerCase() && p.chainId === 'base');
    if (!pools.length) continue;
    pools.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const top = pools[0];
    out[s.t] = { price: +top.priceUsd, pool: top.pairAddress, dex: top.dexId, liquidity: pools.reduce((a, p) => a + (p.liquidity?.usd || 0), 0), volume24h: pools.reduce((a, p) => a + (p.volume?.h24 || 0), 0) };
  }
  return out;
}
async function hyperliquid(refTimes) {
  const [meta, ctxs] = await j('https://api.hyperliquid.xyz/info', { type: 'metaAndAssetCtxs', dex: 'xyz' });
  const out = {};
  meta.universe.forEach((a, i) => { const t = a.name.split(':')[1]; if (STOCKS.some(s => s.t === t)) out[t] = { mark: +ctxs[i].markPx }; });
  // HL price at the moment each Chainlink feed last updated (self-referenced: avoids unit/basis differences, e.g. SNDK)
  await Promise.all(Object.keys(out).map(async t => {
    const ref = refTimes[t]; if (!ref) return;
    try {
      const c = await j('https://api.hyperliquid.xyz/info', { type: 'candleSnapshot', req: { coin: `xyz:${t}`, interval: '5m', startTime: ref - 10 * 60e3, endTime: ref + 5 * 60e3 } });
      const k = c.filter(x => x.t <= ref).pop(); if (k) out[t].atRef = +k.c;
    } catch { /* leave undefined */ }
  }));
  return out;
}
export async function board() {
  const clock = marketClock();
  const [cl, dx] = await Promise.allSettled([chainlink(), aerodrome()]);
  const C = cl.value || {}, D = dx.value || {};
  const refTimes = Object.fromEntries(Object.entries(C).map(([t, v]) => [t, v.updatedAt]));
  const [hl] = await Promise.allSettled([hyperliquid(refTimes)]);
  const H = hl.value || {};
  const rows = STOCKS.map(s => {
    const c = C[s.t], d = D[s.t], h = H[s.t];
    const gap = c && d ? (d.price / c.price - 1) * 100 : null;
    const hlMove = h?.mark && h?.atRef ? (h.mark / h.atRef - 1) * 100 : null;
    return { ...s, close: c?.price ?? null, closeUpdatedAt: c?.updatedAt ?? null, base: d?.price ?? null, pool: d?.pool ?? null,
      liquidity: d?.liquidity ?? null, volume24h: d?.volume24h ?? null, gap, hlMove, hlMark: h?.mark ?? null,
      agree: gap != null && hlMove != null ? Math.abs(gap - hlMove) : null };
  });
  return { generatedAt: Date.now(), clock, rows, sources: { chainlink: cl.status, aerodrome: dx.status, hyperliquid: hl.status } };
}
