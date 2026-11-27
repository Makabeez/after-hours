// Counts swaps made through this board, straight from Base: every KyberSwap swap of the 10 stocks whose calldata
// ends with the ERC-8021 builder-code suffix (bc_il5mvrgl). The author's own wallets are counted separately.
// Writes public/data/traction.json (changes only when a new swap appears) and keeps its scan position in
// .traction-state.json (git-ignored). First run scans from the launch block; later runs are incremental.
//   npm run traction
import { readFile, writeFile } from 'node:fs/promises';
import { STOCKS } from '../api/_lib.js';

const BUILDER_CODE = 'bc_il5mvrgl';
const SUFFIX = Buffer.from(BUILDER_CODE).toString('hex') + BUILDER_CODE.length.toString(16).padStart(2, '0') + '00' + '8021'.repeat(8);
const ROUTER = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
const EXECUTOR = '0x8f10b468b06c6fd214b65f87778827f7d113f996'; // KyberSwap executor that moves the tokens on Base
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const LAUNCH_BLOCK = 60530000; // a few minutes before the first swap through the board (21 Nov 2026)
const AUTHOR = new Set([ // the author's own wallets: test swaps, never counted as users
  '0x054e3cc9469743df5aa3ee4e9bab4612901b4e42',
  '0x1bce0d52081b68b81e84193b5644af8b9a552d19',
  '0x2f225f8a538e7fd613e8ba79dcddc7d1422aed1c',
]);
const RPCS = (process.env.BASE_RPC ? [process.env.BASE_RPC] : []).concat(['https://mainnet.base.org', 'https://base-rpc.publicnode.com']);
const OUT = 'public/data/traction.json', STATE = '.traction-state.json';

let ri = 0;
async function post(body) {
  for (let a = 0; a < 8; a++) {
    try {
      const r = await fetch(RPCS[ri % RPCS.length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30e3) });
      const j = await r.json();
      if (Array.isArray(body) ? (!Array.isArray(j) || j.some(x => x.error)) : j.error) throw new Error(JSON.stringify(j.error || j).slice(0, 200));
      return Array.isArray(body) ? j : j.result;
    } catch (e) { ri++; if (a === 7) throw e; await new Promise(s => setTimeout(s, 1000 * (a + 1))); }
  }
}
const rpc = (method, params) => post({ jsonrpc: '2.0', id: 1, method, params });
const topicAddr = a => '0x' + a.slice(2).padStart(64, '0');
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };

const prev = await readJson(OUT, { swaps: [] });
const state = await readJson(STATE, { lastBlock: LAUNCH_BLOCK - 1 });
const head = parseInt(await rpc('eth_blockNumber', []), 16);
const tokens = STOCKS.map(s => s.token);
const byToken = Object.fromEntries(STOCKS.map(s => [s.token.toLowerCase(), s.t]));

// 1. every stock transfer into or out of the KyberSwap executor since the last run
const hashes = new Set(), STEP = 20000;
for (let b = state.lastBlock + 1; b <= head; b += STEP) {
  const to = Math.min(b + STEP - 1, head);
  for (const topics of [[TRANSFER, topicAddr(EXECUTOR)], [TRANSFER, null, topicAddr(EXECUTOR)]]) {
    const logs = await rpc('eth_getLogs', [{ address: tokens, topics, fromBlock: '0x' + b.toString(16), toBlock: '0x' + to.toString(16) }]);
    logs.forEach(l => hashes.add(l.transactionHash));
  }
}

// 2. keep the router calls whose calldata ends with the builder-code suffix
const known = new Set(prev.swaps.map(s => s.hash)), found = [], list = [...hashes].filter(h => !known.has(h));
let k = 0;
async function worker() {
  while (k < list.length) {
    const chunk = list.slice(k, k += 50);
    const res = await post(chunk.map((h, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getTransactionByHash', params: [h] })));
    for (const { result: tx } of res) if (tx && tx.to?.toLowerCase() === ROUTER && tx.input.toLowerCase().endsWith(SUFFIX)) found.push(tx);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// 3. describe each new swap from its receipt: side, stock, USDC amount
for (const tx of found) {
  const [rc, blk] = await Promise.all([rpc('eth_getTransactionReceipt', [tx.hash]), rpc('eth_getBlockByNumber', [tx.blockNumber, false])]);
  if (rc.status !== '0x1') continue;
  const wallet = tx.from.toLowerCase(), me = topicAddr(wallet);
  let side = null, t = null, usdc = 0;
  for (const l of rc.logs) {
    if (l.topics[0] !== TRANSFER) continue;
    const a = l.address.toLowerCase(), amt = Number(BigInt(l.data));
    if (byToken[a] && l.topics[2] === me) { side = 'buy'; t = byToken[a]; }
    if (byToken[a] && l.topics[1] === me) { side = 'sell'; t = byToken[a]; }
    if (a === USDC && (l.topics[1] === me || l.topics[2] === me)) usdc += amt / 1e6;
  }
  prev.swaps.push({ time: new Date(parseInt(blk.timestamp, 16) * 1000).toISOString(), block: parseInt(tx.blockNumber, 16), hash: tx.hash,
    wallet, side, t, usdc: +usdc.toFixed(2), author: AUTHOR.has(wallet) });
}

const swaps = prev.swaps.sort((a, b) => a.block - b.block);
const sum = list => ({ swaps: list.length, wallets: new Set(list.map(s => s.wallet)).size, volumeUsd: +list.reduce((a, s) => a + s.usdc, 0).toFixed(2) });
const out = { builderCode: BUILDER_CODE, since: '2026-11-21', users: sum(swaps.filter(s => !s.author)), author: sum(swaps.filter(s => s.author)), swaps,
  method: 'KyberSwap router calls on Base touching the 10 stock tokens, whose calldata ends with the ERC-8021 suffix for bc_il5mvrgl. Reproduce: npm run traction.' };
await writeFile(OUT, JSON.stringify(out, null, 2) + '\n');
await writeFile(STATE, JSON.stringify({ lastBlock: head, checkedAt: new Date().toISOString() }) + '\n');

console.log(`scanned to block ${head}: ${hashes.size} stock swaps via KyberSwap, ${found.length} new with the builder code`);
console.log(`users: ${out.users.swaps} swaps by ${out.users.wallets} wallets, $${out.users.volumeUsd}  |  author tests: ${out.author.swaps}`);
for (const s of swaps) console.log(`  ${s.time}  ${s.author ? 'author' : 'USER  '}  ${s.side} ${s.t}  $${s.usdc}  ${s.hash}`);
if (found.length) console.log('CHANGED');
