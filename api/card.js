// Live share card as a PNG. /api/card?t=NVDA (1200x630 for X/Telegram/Discord), add &f=fc for 1200x800 (Farcaster 3:2).
import { ImageResponse } from '@vercel/og';
import { readFile } from 'node:fs/promises';
import { getBoard, pickRow, pct, usd, nextOpenLabel } from './_card.js';

const font = f => readFile(new URL(`./_fonts/${f}`, import.meta.url));
const fontsP = Promise.all([font('bricolage-grotesque-latin-700-normal.woff'), font('ibm-plex-sans-latin-500-normal.woff'), font('ibm-plex-sans-latin-600-normal.woff')]);

const C = { night: '#10142B', surface: '#181D3A', line: '#2A3060', ice: '#AFC8FF', amber: '#F4A53C', text: '#EEEAF4', muted: '#8C91B4' };
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter(c => c !== null && c !== false) } });

function card(b, r, tall) {
  const W = 1200, H = tall ? 800 : 630, ok = r.gap != null, open = b.clock.open;
  const scale = Math.max(3, Math.ceil(Math.max(Math.abs(r.gap ?? 0), Math.abs(r.hlMove ?? 0))));
  const pos = x => 50 + Math.max(-1, Math.min(1, x / scale)) * 50;
  const g = ok ? pos(r.gap) : 50;
  const big = tall ? 68 : 64;

  // word by word, so wrapped lines never start with a space; the number is the only accent
  const words = (txt, color) => txt.split(' ').filter(Boolean).map(w => h('span', { marginRight: '0.26em', color }, w));
  const headline = !ok
    ? words(`${r.name} has no live Base price right now.`)
    : open
      ? [...words(`${r.name} on Base is`), ...words(pct(r.gap), C.amber), ...words('against Chainlink while Wall Street is open.')]
      : [...words(`${r.name} is trading`), ...words(`${Math.abs(r.gap).toFixed(2)}%`, C.amber), ...words(`${r.gap >= 0 ? 'above' : 'below'} where Wall Street left it.`)];

  const stat = (label, value, color) => h('div', { flexDirection: 'column', gap: 6 },
    h('div', { fontSize: 22, color: C.muted, fontFamily: 'Plex', fontWeight: 500 }, label),
    h('div', { fontSize: 40, color, fontFamily: 'Bricolage' }, value));

  const end = (txt, side) => h('div', { position: 'absolute', [side]: 0, top: 62, fontSize: 20, color: C.muted }, txt);
  const track = h('div', { position: 'relative', width: '100%', height: 90, alignItems: 'center' },
    end(`−${scale}%`, 'left'), end(`+${scale}%`, 'right'),
    h('div', { position: 'absolute', left: 0, right: 0, top: 34, height: 2, background: C.line }),
    ok ? h('div', { position: 'absolute', top: 32, height: 6, borderRadius: 3, background: C.amber, opacity: 0.35, left: `${Math.min(50, g)}%`, width: `${Math.abs(g - 50)}%` }) : null,
    h('div', { position: 'absolute', left: '50%', top: 12, width: 5, height: 46, marginLeft: -2, borderRadius: 3, background: C.ice }),
    r.hlMove != null ? h('div', { position: 'absolute', left: `${pos(r.hlMove)}%`, top: 22, width: 26, height: 26, marginLeft: -13, borderRadius: 13, border: `3px solid ${C.muted}` }) : null,
    ok ? h('div', { position: 'absolute', left: `${g}%`, top: 20, width: 30, height: 30, marginLeft: -15, borderRadius: 15, background: C.amber }) : null);

  const status = open ? 'Wall Street is open' : `Wall Street reopens ${nextOpenLabel(b.clock.nextOpen)}`;

  return h('div', { width: W, height: H, flexDirection: 'column', justifyContent: 'space-between', padding: tall ? '64px 72px' : '52px 64px',
    background: `radial-gradient(900px 500px at 88% -10%, #1D2350 0%, ${C.night} 60%)`, color: C.text, fontFamily: 'Plex' },
    h('div', { justifyContent: 'space-between', alignItems: 'center' },
      h('div', { alignItems: 'center', gap: 14, fontFamily: 'Bricolage', fontSize: 30 },
        h('div', { position: 'relative', width: 44, height: 24 },
          h('div', { position: 'absolute', left: 0, right: 0, top: 11, height: 3, background: C.ice, borderRadius: 2 }),
          h('div', { position: 'absolute', right: 2, top: 4, width: 16, height: 16, borderRadius: 8, background: C.amber })),
        h('span', {}, 'After Hours')),
      h('div', { gap: 28, fontSize: 24, color: C.muted, fontWeight: 500 }, h('span', { color: C.text }, `${r.t}c on Base`), h('span', {}, status))),
    h('div', { flexWrap: 'wrap', fontFamily: 'Bricolage', fontSize: big, lineHeight: 1.06, letterSpacing: -1.5, maxWidth: 1040 }, ...headline),
    track,
    h('div', { justifyContent: 'space-between', alignItems: 'flex-end' },
      h('div', { gap: 64 },
        stat('Frozen (Chainlink)', usd(r.close), C.ice),
        stat('Live on Base', usd(r.base), C.amber),
        r.hlMove != null ? stat('Hyperliquid perp', pct(r.hlMove), C.text) : null),
      h('div', { fontSize: 22, color: C.muted, whiteSpace: 'nowrap', paddingBottom: 6 }, 'after-hours-public.vercel.app')));
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const [b, [bric, plex5, plex6]] = await Promise.all([getBoard(req), fontsP]);
    const r = pickRow(b, q.t), tall = q.f === 'fc';
    const img = new ImageResponse(card(b, r, tall), {
      width: 1200, height: tall ? 800 : 630,
      fonts: [{ name: 'Bricolage', data: bric, weight: 700 }, { name: 'Plex', data: plex5, weight: 500 }, { name: 'Plex', data: plex6, weight: 600 }],
    });
    const buf = Buffer.from(await img.arrayBuffer());
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
