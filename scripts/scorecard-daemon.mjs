// Runs the scorecard on time from an always-on machine (GitHub's scheduler can start jobs hours late).
// Predicts 5-15 min before each US open, scores 60-90 min after, then commits public/data and pushes.
// Start: pm2 start scripts/scorecard-daemon.mjs --name after-hours-scorecard && pm2 save
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { marketClock } from '../api/_lib.js';
const run = promisify(execFile);
const nyDate = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);
const exists = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

async function sh(cmd, args) {
  const { stdout, stderr } = await run(cmd, args, { timeout: 120e3 });
  return (stdout + stderr).trim();
}
async function commit(msg) {
  try {
    await sh('git', ['add', 'public/data']);
    const st = await sh('git', ['status', '--porcelain', 'public/data']);
    if (!st) return log('nothing to commit');
    await sh('git', ['commit', '-q', '-m', msg]);
    await sh('git', ['pull', '-q', '--rebase', '--autostash']);
    log(await sh('git', ['push', '-q']) || 'pushed');
  } catch (e) { log('git failed:', e.message); }
}
async function tick() {
  const now = Date.now(), c = marketClock(now);
  if (!c.open && c.nextOpen) {
    const mins = (c.nextOpen - now) / 60e3, date = nyDate(c.nextOpen), day = await exists(`public/data/days/${date}.json`);
    if (mins <= 15 && mins >= 3 && !day) {
      log(`predicting ${date} (${mins.toFixed(1)} min before open)`);
      log(await sh('node', ['scripts/scorecard.mjs', 'predict']));
      await commit(`scorecard: board saved before the ${date} open`);
    }
  }
  if (c.open) {
    const mins = (now - c.sessionOpen) / 60e3, date = nyDate(c.sessionOpen), day = await exists(`public/data/days/${date}.json`);
    if (mins >= 60 && mins <= 90 && day && !day.scoredAt) {
      log(`scoring ${date} (${mins.toFixed(1)} min after open)`);
      log(await sh('node', ['scripts/scorecard.mjs', 'score']));
      await commit(`scorecard: ${date} open scored`);
    }
  }
}
log('scorecard daemon started');
await tick().catch(e => log('tick error:', e.message));
setInterval(() => tick().catch(e => log('tick error:', e.message)), 60e3);
