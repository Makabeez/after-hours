// Country from Vercel's edge header. Used only to hide the swap button for US visitors.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({ country: req.headers['x-vercel-ip-country'] || null });
}
