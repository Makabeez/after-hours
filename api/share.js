// Share page for one stock: /s/NVDA. Link previews (X, Telegram, Discord, Farcaster) show the live card;
// people who click land on the board with that row highlighted.
import { getBoard, pickRow, sentence, usd, SITE } from './_card.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function handler(req, res) {
  const want = String(req.query?.t || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
  let title = 'After Hours', desc = 'Stocks close at 4pm. Their tokens on Base don\'t. See the gap, then trade it.', t = want;
  try {
    const b = await getBoard(req), r = pickRow(b, want);
    t = r.t; title = sentence(b, r);
    desc = r.gap == null ? desc : `Chainlink froze ${r.t} at ${usd(r.close)}. On Base it trades at ${usd(r.base)}. Live board, refreshed every 30 seconds.`;
  } catch { /* fall back to the generic preview */ }
  const bucket = Math.floor(Date.now() / 6e5); // new image URL every 10 minutes so previews don't go stale
  const img = `${SITE}/api/card?t=${t}&v=${bucket}`;
  const imgFc = `${SITE}/api/card?t=${t}&f=fc&v=${bucket}`;
  const target = `${SITE}/?t=${t}`;
  const embed = v => JSON.stringify({ version: v, imageUrl: imgFc,
    button: { title: `See ${t} live`, action: { type: v === 'next' ? 'launch_frame' : 'launch_miniapp', name: 'After Hours', url: target, splashImageUrl: `${SITE}/icon.png`, splashBackgroundColor: '#10142B' } } });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300');
  res.status(200).send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="After Hours">
<meta property="og:url" content="${esc(`${SITE}/s/${t}`)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<meta name="fc:miniapp" content="${esc(embed('1'))}">
<meta name="fc:frame" content="${esc(embed('next'))}">
<style>body{background:#10142B;color:#EEEAF4;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#AFC8FF}</style>
</head><body><p><a href="${esc(target)}">Open the After Hours board</a></p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`);
}
