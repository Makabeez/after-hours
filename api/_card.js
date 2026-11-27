// Shared helpers for share cards and share pages: fetch the (CDN-cached) board, pick a row, word the gap.
import { board } from './_lib.js';

export const SITE = 'https://after-hours-public.vercel.app';

export async function getBoard(req) {
  // Reuse the cached /api/board response when we can, so a burst of link previews costs one data fetch.
  const host = req?.headers?.host;
  if (host) {
    const proto = host.startsWith('localhost') ? 'http' : 'https';
    try {
      const r = await fetch(`${proto}://${host}/api/board`, { signal: AbortSignal.timeout(9000) });
      if (r.ok) return await r.json();
    } catch { /* fall through to a direct fetch */ }
  }
  return board();
}

export function pickRow(b, t) {
  const rows = b.rows.filter(r => r.gap != null);
  const want = String(t || '').toUpperCase();
  return b.rows.find(r => r.t === want) || [...rows].sort((a, z) => Math.abs(z.gap) - Math.abs(a.gap))[0] || b.rows[0];
}

export const pct = (x, d = 2) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) + '%';
export const usd = x => x == null ? '–' : x >= 1000 ? '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '$' + x.toFixed(2);

export function nextOpenLabel(ms) {
  if (!ms) return '';
  const d = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long' }).format(new Date(ms));
  return `${d} 9:30 ET`;
}

// One sentence used by the card, the share page and the post text.
export function sentence(b, r) {
  if (r.gap == null) return `${r.name} has no live price on Base right now.`;
  if (b.clock.open) return `${r.name} on Base is ${pct(r.gap)} against the latest Chainlink price while Wall Street is open.`;
  return `${r.name} is trading ${Math.abs(r.gap).toFixed(2)}% ${r.gap >= 0 ? 'above' : 'below'} where Wall Street left it.`;
}
