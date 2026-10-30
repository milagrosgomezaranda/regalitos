 
import {
  extractMercadoLibreIds,
  importMercadoLibreProduct,
} from '../mercadolibre-importer.mjs';

import { importGenericProduct } from '../product-importer.mjs';

const isMercadoLibre = (url) =>
  /(^|\.)mercadolibre\.com\.ar$/i.test(url.hostname);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const input = Array.isArray(req.query?.url)
    ? req.query.url[0]
    : req.query?.url;

  if (typeof input !== 'string' || !input.trim()) {
    return res.status(400).json({ error: 'Falta la URL del producto' });
  }

  let url;

  try {
    url = new URL(input.trim());

    if (url.protocol !== 'https:') {
      throw new Error('Solo se admiten enlaces HTTPS.');
    }
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'URL inválida.',
    });
  }

  try {
    let product;

    if (isMercadoLibre(url)) {
      // Mantener la integración existente sin modificarla.
      const ids = extractMercadoLibreIds(url.toString());
      product = await importMercadoLibreProduct(url.toString());

      return res.status(200).json({
        title: product.title,
        price: product.price,
        image: product.image,
        itemId: ids.itemId,
        catalogId: ids.catalogId,
      });
    }

    // Todas las demás tiendas pasan por el extractor universal.
    product = await importGenericProduct(url.toString());

    return res.status(200).json({
      title: product.title,
      price: product.price,
      image: product.image,
      missing: product.missing,
      method: product.method,
    });
  } catch (error) {
    return res.status(502).json({
      error: error?.message || 'No se pudieron obtener los datos.',
      missing: error?.missing || ['title', 'price', 'image'],
    });
  }
}
