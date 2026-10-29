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
    ids = extractMercadoLibreIds(url.trim());
  } catch (error) {
    return res.status(422).json({
      error: error?.message || 'URL de Mercado Libre inválida',
    });
  }

  if (!ids.productId) {
    return res.status(422).json({
      error: 'Por ahora solo podemos importar links de Mercado Libre que tengan un productId de catálogo (/p/MLA...).',
      source: 'mercadolibre',
      itemId: ids.itemId,
      productId: null,
      partial: true,
    });
  }

  try {
    const product = await importMercadoLibreProduct(url.trim());
    return res.status(200).json(product);
  } catch (error) {
    const causes = Array.isArray(error?.causes) ? error.causes : [];
    const statusFromMeli = causes.find((cause) => Number.isInteger(cause?.status))?.status;

    return res.status(statusFromMeli === 401 || statusFromMeli === 403 ? 502 : 502).json({
      error: error?.message || 'No se pudo importar el producto.',
      source: 'mercadolibre',
      itemId: ids.itemId,
      productId: ids.productId,
      details: causes.length ? causes : undefined,
    });
  }
}
