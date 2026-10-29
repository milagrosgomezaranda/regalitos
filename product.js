import { importMercadoLibreProduct } from '../mercadolibre-importer.mjs';

const cache = globalThis.__regalitosProductCache || new Map();
globalThis.__regalitosProductCache = cache;
const CACHE_MS = 5 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function saveCached(key, value) {
  cache.set(key, { savedAt: Date.now(), value });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return res.status(400).json({ ok: false, error: 'Falta la URL del producto.' });
  }

  const cacheKey = rawUrl.trim();
  const cached = getCached(cacheKey);
  if (cached) {
    return res.status(200).json({
      ok: true,
      ...cached,
      method: `${cached.method}-cache`,
      elapsedMs: Date.now() - startedAt,
    });
  }

  try {
    const product = await importMercadoLibreProduct(rawUrl.trim());
    const result = {
      title: product.title,
      price: product.price,
      image: product.image,
      method: product.method,
      ids: product.ids,
    };
    saveCached(cacheKey, result);

    return res.status(200).json({
      ok: true,
      ...result,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.message || 'No se pudo leer el producto.',
      causes: Array.isArray(error?.causes) ? error.causes : [],
      elapsedMs: Date.now() - startedAt,
    });
  }
}
