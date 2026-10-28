// Vercel serverless function. It reads public metadata only; some stores block automated requests.
const allowedProtocols = new Set(['https:']);
function clean(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}
function meta(html, keys) {
  for (const key of keys) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(':','\\\\:')}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key.replace(':','\\\\:')}["'][^>]*>`, 'i')
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return clean(m[1]);
    }
  }
  return '';
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const raw = req.query?.url;
  let url;
  try { url = new URL(raw); } catch { return res.status(400).json({ error: 'El enlace no parece válido.' }); }
  if (!allowedProtocols.has(url.protocol)) return res.status(400).json({ error: 'Solo se aceptan enlaces HTTPS.' });
  if (['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname) || url.hostname.endsWith('.local')) return res.status(400).json({ error: 'Ese enlace no está permitido.' });
  try {
    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GiftWishlist/1.0; +https://vercel.com)', 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return res.status(422).json({ error: 'La tienda no permitió leer la página.' });
    const html = (await response.text()).slice(0, 1_500_000);
    const title = meta(html, ['og:title','twitter:title']) || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g,'').trim();
    let image = meta(html, ['og:image','twitter:image','twitter:image:src']);
    if (image) { try { image = new URL(image, url).toString(); } catch { image = ''; } }
    const priceRaw = meta(html, ['product:price:amount','og:price:amount','price']);
    const price = priceRaw && Number.isFinite(Number(priceRaw.replace(',','.'))) ? Number(priceRaw.replace(',','.')) : null;
    return res.status(200).json({ title, image, price });
  } catch {
    return res.status(422).json({ error: 'No se pudo acceder a esa tienda. Probá con otra URL o cargá la foto manualmente.' });
  }
}