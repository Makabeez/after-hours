// After Hours front end: board rendering, market clock, and a KyberSwap trade flow tagged with a Base builder code.
const BUILDER_CODE = 'bc_il5mvrgl';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const KYBER = 'https://aggregator-api.kyberswap.com/base/api/v1';
const BASE_HEX = '0x2105';
const $ = s => document.querySelector(s);
let state = { board: null, account: null, country: null, sel: null, quote: null };

// ---------- ERC-8021 attribution suffix: codes ‖ codesLength ‖ schemaId(0) ‖ 16-byte marker
const hexOf = s => [...s].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
const SUFFIX = hexOf(BUILDER_CODE) + BUILDER_CODE.length.toString(16).padStart(2, '0') + '00' + '8021'.repeat(8);
const tag = data => data + SUFFIX;

// ---------- formatting
const pct = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) + '%';
const usd = x => x >= 1000 ? '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '$' + x.toFixed(2);
const compact = x => x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + Math.round(x / 1e3) + 'k' : '$' + Math.round(x);
function dur(ms) {
  const m = Math.max(0, Math.floor(ms / 60e3)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
const localTime = ms => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

// ---------- board
async function load() {
  try {
    const r = await fetch('/api/board', { cache: 'no-store' });
    if (!r.ok) throw new Error(`board ${r.status}`);
    state.board = await r.json();
    render();
    $('#status').textContent = `Updated ${new Date(state.board.generatedAt).toLocaleTimeString()}. Refreshes every 30 seconds.`;
  } catch (e) {
    $('#status').textContent = 'Prices could not be loaded. The board retries in 30 seconds.';
  }
}
function render() {
  const b = state.board, c = b.clock;
  const rows = b.rows.filter(r => r.gap != null);
  const top = [...rows].sort((a, z) => Math.abs(z.gap) - Math.abs(a.gap))[0];
  if (!c.open && top) {
    const dir = top.gap >= 0 ? 'above' : 'below';
    $('#headline').innerHTML = `${top.name} is trading <span class="num">${Math.abs(top.gap).toFixed(2)}%</span> ${dir} where Wall Street left it.`;
    const hours = ((Date.now() - top.closeUpdatedAt) / 36e5).toFixed(0);
    const hl = top.hlMove != null ? ` Hyperliquid's ${top.t} perp moved ${pct(top.hlMove)} over the same stretch.` : '';
    $('#subline').textContent = `Chainlink has held ${top.t} at ${usd(top.close)} for ${hours} hours. On Base it changes hands at ${usd(top.base)}.${hl}`;
  } else if (top) {
    $('#headline').textContent = 'Wall Street is open. Base prices are tracking the live market.';
    $('#subline').textContent = `Widest spread right now: ${top.name}, ${pct(top.gap)} against the latest Chainlink price.`;
  }
  const scale = Math.max(3, Math.ceil(Math.max(...b.rows.flatMap(r => [Math.abs(r.gap ?? 0), Math.abs(r.hlMove ?? 0)]))));
  const pos = x => 50 + Math.max(-1, Math.min(1, x / scale)) * 50;
  const ol = $('#rows');
  for (const r of b.rows) {
    let li = ol.querySelector(`[data-t="${r.t}"]`);
    if (!li) {
      li = document.createElement('li'); li.className = 'row'; li.dataset.t = r.t;
      li.innerHTML = `<div class="who"><b>${r.t}</b><span>${r.name}</span></div>
        <div class="track" role="img"><div class="axis"></div><div class="span"></div><div class="tick"></div><div class="hl"></div><div class="live"></div><span class="lbl l1"></span></div>
        <div class="gap"><b></b><span></span></div>
        <button class="btn ghost trade-btn" type="button" aria-label="Trade ${r.name}">Trade</button>`;
      li.querySelector('.trade-btn').addEventListener('click', () => openTrade(r.t));
      ol.appendChild(li);
    }
    const ok = r.gap != null;
    li.classList.toggle('stale', !ok);
    const g = ok ? pos(r.gap) : 50;
    li.querySelector('.live').style.left = g + '%';
    li.querySelector('.live').hidden = !ok;
    const sp = li.querySelector('.span'); sp.style.left = Math.min(50, g) + '%'; sp.style.width = Math.abs(g - 50) + '%';
    const hl = li.querySelector('.hl'); hl.hidden = r.hlMove == null; if (r.hlMove != null) hl.style.left = pos(r.hlMove) + '%';
    const l1 = li.querySelector('.l1'); l1.style.left = '50%'; l1.textContent = r.close ? usd(r.close) : '';
    li.querySelector('.gap b').textContent = ok ? pct(r.gap) : 'no price';
    li.querySelector('.gap span').textContent = ok ? `${usd(r.base)} · ${compact(r.liquidity || 0)} liquidity` : 'no Base pool found';
    li.querySelector('.track').setAttribute('aria-label', ok
      ? `${r.name}: frozen at ${usd(r.close)}, live on Base at ${usd(r.base)}, a gap of ${pct(r.gap)}${r.hlMove != null ? `; Hyperliquid moved ${pct(r.hlMove)}` : ''}.`
      : `${r.name}: no live Base price.`);
    li.querySelector('.trade-btn').disabled = state.country === 'US' || !ok;
  }
  tickClock();
}
function tickClock() {
  const c = state.board?.clock; if (!c) return;
  const now = Date.now();
  $('#clock').innerHTML = c.open
    ? `Wall Street is open. It closes at <strong>${localTime(c.closesAt)}</strong> your time, in ${dur(c.closesAt - now)}.`
    : `Wall Street closed ${dur(now - c.lastClose)} ago. It reopens <strong>${localTime(c.nextOpen)}</strong> your time, in ${dur(c.nextOpen - now)}.`;
}

// ---------- wallet
const eth = () => window.ethereum;
async function rpc(method, params = []) { return eth().request({ method, params }); }
async function connect() {
  if (!eth()) { alertMsg('Install a Base-compatible wallet such as Coinbase Wallet or Rabby to trade.'); return null; }
  const [a] = await rpc('eth_requestAccounts');
  state.account = a;
  $('#connect').textContent = a.slice(0, 6) + '…' + a.slice(-4);
  try { await rpc('wallet_switchEthereumChain', [{ chainId: BASE_HEX }]); }
  catch (e) {
    if (e.code === 4902) await rpc('wallet_addEthereumChain', [{ chainId: BASE_HEX, chainName: 'Base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://mainnet.base.org'], blockExplorerUrls: ['https://basescan.org'] }]);
    else throw e;
  }
  return a;
}
const pad = (h, n = 64) => h.replace(/^0x/, '').padStart(n, '0');
async function call(to, data) { return rpc('eth_call', [{ to, data }, 'latest']); }
async function decimals(token) { return parseInt(await call(token, '0x313ce567'), 16); }
async function allowance(token, owner, spender) { return BigInt(await call(token, '0xdd62ed3e' + pad(owner) + pad(spender))); }
function toUnits(v, d) { const [i, f = ''] = String(v).trim().split('.'); return BigInt(i || '0') * 10n ** BigInt(d) + BigInt((f + '0'.repeat(d)).slice(0, d) || '0'); }
function fromUnits(x, d) { const s = x.toString().padStart(d + 1, '0'); return Number(s.slice(0, -d) + '.' + s.slice(-d)); }
async function waitReceipt(hash) {
  for (let i = 0; i < 60; i++) { const r = await rpc('eth_getTransactionReceipt', [hash]); if (r) return r; await new Promise(s => setTimeout(s, 1500)); }
  throw new Error('Timed out waiting for confirmation');
}

// ---------- trade modal
function alertMsg(t, err) { const m = $('#trade-msg'); m.textContent = t; m.classList.toggle('err', !!err); }
function openTrade(t) {
  state.sel = state.board.rows.find(r => r.t === t); state.quote = null;
  $('#trade-title').textContent = `Trade ${t}`;
  $('#amount').value = ''; $('#quote').textContent = 'Enter an amount to see a quote.'; alertMsg('');
  syncSide(); $('#trade').showModal(); $('#amount').focus();
}
function side() { return document.querySelector('input[name=side]:checked').value; }
function syncSide() {
  $('#amount-label').textContent = side() === 'buy' ? 'Pay (USDC)' : `Sell (${state.sel.t}c tokens)`;
  state.quote = null; $('#go').textContent = 'Get quote'; updateGo();
}
function updateGo() { $('#go').disabled = !($('#eligible').checked && +$('#amount').value > 0) || state.country === 'US'; }
async function getQuote() {
  const s = state.sel, buy = side() === 'buy';
  const tokenIn = buy ? USDC : s.token, tokenOut = buy ? s.token : USDC;
  const [dIn, dOut] = await Promise.all([decimals(tokenIn), decimals(tokenOut)]);
  const amountIn = toUnits($('#amount').value, dIn);
  const r = await fetch(`${KYBER}/routes?tokenIn=${tokenIn}&tokenOut=${tokenOut}&amountIn=${amountIn}&source=after-hours`, { headers: { 'x-client-id': 'after-hours' } }).then(r => r.json());
  if (r.code !== 0 || !r.data?.routeSummary) throw new Error('No route found for this size. Try a smaller amount.');
  const out = fromUnits(BigInt(r.data.routeSummary.amountOut), dOut);
  const px = buy ? (+$('#amount').value) / out : out / (+$('#amount').value);
  const vsFrozen = (px / s.close - 1) * 100;
  state.quote = { r: r.data, tokenIn, amountIn, buy };
  $('#quote').textContent = buy
    ? `You get about ${out.toFixed(4)} ${s.t}c at ${usd(px)} each, ${pct(vsFrozen)} against the frozen Chainlink price.`
    : `You get about ${out.toFixed(2)} USDC at ${usd(px)} each, ${pct(vsFrozen)} against the frozen Chainlink price.`;
  $('#go').textContent = buy ? `Buy ${s.t}c` : `Sell ${s.t}c`;
}
async function execute() {
  const q = state.quote, from = state.account || await connect(); if (!from) return;
  const built = await fetch(`${KYBER}/route/build`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-client-id': 'after-hours' },
    body: JSON.stringify({ routeSummary: q.r.routeSummary, sender: from, recipient: from, slippageTolerance: 50, source: 'after-hours' }) }).then(r => r.json());
  if (built.code !== 0) throw new Error(built.message || 'Could not build the swap');
  const router = built.data.routerAddress;
  if (await allowance(q.tokenIn, from, router) < q.amountIn) {
    alertMsg('Approve the exact amount in your wallet.');
    const h = await rpc('eth_sendTransaction', [{ from, to: q.tokenIn, data: tag('0x095ea7b3' + pad(router) + pad(q.amountIn.toString(16))) }]);
    await waitReceipt(h);
  }
  alertMsg('Confirm the swap in your wallet.');
  const hash = await rpc('eth_sendTransaction', [{ from, to: router, data: tag(built.data.data), value: '0x' + BigInt(built.data.transactionValue || 0).toString(16) }]);
  alertMsg('Swap sent. Waiting for Base to confirm…');
  const rc = await waitReceipt(hash);
  $('#trade-msg').innerHTML = rc.status === '0x1'
    ? `Done. <a href="https://basescan.org/tx/${hash}" target="_blank" rel="noopener">View on Basescan</a>`
    : `The swap reverted. <a href="https://basescan.org/tx/${hash}" target="_blank" rel="noopener">See why on Basescan</a>`;
  state.quote = null; $('#go').textContent = 'Get quote';
}

// ---------- wiring
$('#connect').addEventListener('click', () => connect().catch(e => console.warn(e)));
document.querySelectorAll('input[name=side]').forEach(i => i.addEventListener('change', syncSide));
$('#amount').addEventListener('input', () => { state.quote = null; $('#go').textContent = 'Get quote'; updateGo(); });
$('#eligible').addEventListener('change', updateGo);
$('#go').addEventListener('click', async () => {
  const btn = $('#go'); btn.disabled = true; alertMsg('');
  try {
    if (!state.account) await connect();
    if (!state.quote) await getQuote(); else await execute();
  } catch (e) { alertMsg(e?.shortMessage || e?.message || 'Something went wrong.', true); }
  finally { updateGo(); }
});
fetch('/api/geo').then(r => r.json()).then(g => {
  state.country = g.country;
  if (g.country === 'US') $('#status').textContent = 'Trading is turned off for visitors in the United States. The board stays readable.';
  if (state.board) render();
}).catch(() => {});
load(); setInterval(load, 30e3); setInterval(tickClock, 30e3);
