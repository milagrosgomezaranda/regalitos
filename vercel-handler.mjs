import { importMercadoLibreProduct } from './mercadolibre-importer.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const url = body.url || body.link;
    if (!url) return res.status(400).json({ error: 'Falta url.' });

    const product = await importMercadoLibreProduct(url);
    return res.status(200).json(product); // compatibilidad: { title, price, image }
  } catch (error) {
    return res.status(502).json({
      error: error?.message || 'No se pudo importar el producto.',
      details: Array.isArray(error?.causes) ? error.causes : undefined,
    });
  }
}
