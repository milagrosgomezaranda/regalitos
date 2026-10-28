// Lee metadatos públicos de productos. Algunas tiendas bloquean las consultas automáticas.
const allowedProtocols = new Set(['https:']);
const clean = value => String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
function meta(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
    ];
    for (const pattern of patterns) { const match = html.match(pattern); if (match) return clean(match[1]); }
  }
  return '';
}
function jsonLdProduct(html) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    try {
      const raw = script.replace(/^.*?>/s, '').replace(/<\/script>.*$/is, '');
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed, ...(parsed['@graph'] || [])];
      for (const item of items) {
        const type = item?.['@type'];
        if (!(type === 'Product' || (Array.isArray(type) && type.includes('Product')))) continue;
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        const image = Array.isArray(item.image) ? item.image[0] : item.image;
        return { title: clean(item.name), image: clean(typeof image === 'string' ? image : image?.url), price: offer?.price ?? offer?.lowPrice ?? null };
      }
    } catch { /* Hay tiendas con JSON-LD inválido; seguimos con las etiquetas meta. */ }
  }
  return {};
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  let url;
  try { url = new URL(req.query?.url); } catch { return res.status(400).json({ error: 'El enlace no parece válido.' }); }
  if (!allowedProtocols.has(url.protocol)) return res.status(400).json({ error: 'Solo se aceptan enlaces HTTPS.' });
  if (['localhost','127.0.0.1','0.0.0.0'].includes(url.hostname) || url.hostname.endsWith('.local')) return res.status(400).json({ error: 'Ese enlace no está permitido.' });
  try {
    const response = await fetch(url.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GiftWishlist/1.1)', 'Accept': 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(9000) });
    if (!response.ok) return res.status(422).json({ error: 'La tienda no permitió leer la página.' });
    const html = (await response.text()).slice(0, 1_500_000);
    const structured = jsonLdProduct(html);
    const title = meta(html, ['og:title','twitter:title']) || structured.title || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g,'').trim();
    let image = meta(html, ['og:image','twitter:image','twitter:image:src']) || structured.image || '';
    if (image) { try { image = new URL(image, url).toString(); } catch { image = ''; } }
    let priceRaw = meta(html, ['product:price:amount','og:price:amount','product:price','price']);
    if (!priceRaw && structured.price !== undefined && structured.price !== null) priceRaw = String(structured.price);
    const normalizedPrice = priceRaw ? priceRaw.replace(/[^\d.,]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.') : '';
    const price = normalizedPrice && Number.isFinite(Number(normalizedPrice)) ? Number(normalizedPrice) : null;
    return res.status(200).json({ title, image, price });
  } catch {
    return res.status(422).json({ error: 'No se pudo acceder a esa tienda. Probá con otra URL o cargá la foto manualmente.' });
  }
}
