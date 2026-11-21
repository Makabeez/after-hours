// One-command judge demo: no wallet, no keys. Prints the live gap board in the terminal.
import { board } from '../api/_lib.js';
const b = await board();
const c = b.clock, fmt = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
console.log(`\nAFTER HOURS — US market ${c.open ? 'OPEN' : `CLOSED since ${fmt(c.lastClose)} · reopens ${fmt(c.nextOpen)}`}\n`);
console.log('TICKER  FROZEN(Chainlink)  BASE(Aerodrome)    GAP   HYPERLIQUID   FROZEN FOR');
for (const r of b.rows) {
  const age = r.closeUpdatedAt ? ((Date.now() - r.closeUpdatedAt) / 36e5).toFixed(1) + 'h' : '—';
  const p = (x, d = 2) => x == null ? '—'.padStart(8) : x.toFixed(d).padStart(8);
  const s = x => x == null ? '     —' : ((x >= 0 ? '+' : '') + x.toFixed(2) + '%').padStart(7);
  console.log(`${r.t.padEnd(6)}  ${p(r.close).padStart(15)}  ${p(r.base).padStart(15)}  ${s(r.gap)}  ${s(r.hlMove).padStart(11)}   ${age}`);
}
console.log(`\nsources: ${JSON.stringify(b.sources)}\n`);
