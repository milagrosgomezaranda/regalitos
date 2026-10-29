import {
  extractMercadoLibreIds,
  importMercadoLibreProduct,
} from '../mercadolibre-importer.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const url = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;

  if (typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'Falta la URL del producto' });
  }

  let ids;
  try {
    ids = extractMercadoLibreIds(url);
  } catch (error) {
    return res.status(400).json({
      error: error?.message || 'URL de Mercado Libre inválida',
    });
  }

  try {
    const product = await importMercadoLibreProduct(url);

    return res.status(200).json({
      title: product.title,
      price: product.price,
      image: product.image,
      method: product.method || 'html-fallback',
      itemId: ids.itemId,
      catalogId: ids.catalogId,
    });
  } catch (error) {
    return res.status(502).json({
      error: error?.message || 'No se pudo importar el producto.',
      details: Array.isArray(error?.causes) ? error.causes : undefined,
      itemId: ids.itemId,
      catalogId: ids.catalogId,
    });
  }
}
