import { board } from './_lib.js';
export default async function handler(req, res) {
  try {
    const b = await board();
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
    res.status(200).json(b);
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
}
