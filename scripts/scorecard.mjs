// Live track record. "predict" runs a few minutes before the US open and saves the board;
// "score" runs ~1 hour after the open and compares the overnight gap with where prices actually went.
// Output: public/data/scorecard.json (served by the site) and public/data/days/<date>.json.
import { board, marketClock } from '../api/_lib.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const mode = process.argv[2];
const NOW = process.env.NOW ? Date.parse(process.env.NOW) : Date.now();   // NOW override for testing only
const dir = 'public/data', daysDir = `${dir}/days`;
await mkdir(daysDir, { recursive: true });
const nyDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return d; } };

if (mode === 'predict') {
  const c = marketClock(NOW);
  if (c.open || !c.nextOpen || c.nextOpen - NOW > 3 * 3600e3) { console.log('No open within 3h; nothing to predict.'); process.exit(0); }
  const b = await board(), date = nyDate(c.nextOpen);
  const rows = b.rows.filter(r => r.gap != null).map(r => ({ t: r.t, frozen: r.close, frozenAt: r.closeUpdatedAt, base: r.base, gap: r.gap, hlMark: r.hlMark, hlMove: r.hlMove }));
  await writeFile(`${daysDir}/${date}.json`, JSON.stringify({ date, opensAt: c.nextOpen, predictedAt: b.generatedAt, rows }, null, 2) + '\n');
  console.log(`Saved prediction for ${date}: ${rows.length} stocks`);
} else if (mode === 'score') {
  const c = marketClock(NOW);
  const date = nyDate(c.open ? c.sessionOpen : c.lastClose);
  const day = await readJson(`${daysDir}/${date}.json`, null);
  if (!day) { console.log(`No prediction saved for ${date}.`); process.exit(0); }
  if (day.scoredAt) { console.log(`${date} already scored.`); process.exit(0); }
  const b = await board();
  const now = Object.fromEntries(b.rows.map(r => [r.t, r]));
  for (const r of day.rows) {
    const n = now[r.t]; if (!n?.base) continue;
    r.after = n.base;                                   // Base price ~1h after the open
    r.actual = (n.base / r.frozen - 1) * 100;           // realised move vs the same frozen reference
    r.error = Math.abs(r.gap - r.actual);
    r.naiveError = Math.abs(r.actual);
    r.directionRight = Math.abs(r.actual) >= 0.5 ? Math.sign(r.gap) === Math.sign(r.actual) : null;
  }
  const s = day.rows.filter(r => r.actual != null);
  const mean = k => s.reduce((a, r) => a + r[k], 0) / s.length;
  const called = s.filter(r => r.directionRight != null);
  day.scoredAt = b.generatedAt;
  day.summary = { n: s.length, meanError: +mean('error').toFixed(2), naiveError: +mean('naiveError').toFixed(2),
    direction: `${called.filter(r => r.directionRight).length}/${called.length}` };
  await writeFile(`${daysDir}/${date}.json`, JSON.stringify(day, null, 2) + '\n');
  const card = await readJson(`${dir}/scorecard.json`, { days: [] });
  card.days = card.days.filter(d => d.date !== date).concat([{ date, ...day.summary }]).sort((a, z) => a.date.localeCompare(z.date));
  const all = card.days, tot = all.reduce((a, d) => a + d.n, 0);
  const w = k => all.reduce((a, d) => a + d[k] * d.n, 0) / tot;
  const [hit, of] = all.reduce((a, d) => { const [h, o] = d.direction.split('/').map(Number); return [a[0] + h, a[1] + o]; }, [0, 0]);
  card.total = { opens: all.length, observations: tot, meanError: +w('meanError').toFixed(2), naiveError: +w('naiveError').toFixed(2), direction: `${hit}/${of}` };
  card.updatedAt = b.generatedAt;
  await writeFile(`${dir}/scorecard.json`, JSON.stringify(card, null, 2) + '\n');
  console.log(`Scored ${date}:`, day.summary, 'running total:', card.total);
} else { console.log('usage: node scripts/scorecard.mjs predict|score'); process.exit(1); }
