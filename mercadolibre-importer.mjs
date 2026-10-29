const ML_HOST_RE = /(^|\.)mercadolibre\.com\.ar$/i;
const ITEM_RE = /\bMLA\d{7,}\b/i;
const PRODUCT_RE = /\b(?:MLA|MLAU)\d{7,}\b/i;
const API_BASE = 'https://api.mercadolibre.com';

function decodeRepeated(value) {
  let out = String(value ?? '');
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = decodeURIComponent(out.replace(/\+/g, '%20'));
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  return out;
}

function firstMatch(value, regex) {
  if (!value) return null;
  const match = decodeRepeated(value).match(regex);
  return match ? match[0].toUpperCase() : null;
}

function itemFromFilter(value) {
  if (!value) return null;
  const decoded = decodeRepeated(value);
  const match = decoded.match(/\bitem_id\s*[:=]\s*(MLA\d{7,})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function paramsFromFragment(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw || (!raw.includes('=') && !raw.includes('&'))) return new URLSearchParams();
  return new URLSearchParams(raw);
}

export function extractMercadoLibreIds(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('La URL no es válida.');
  }

  if (!ML_HOST_RE.test(url.hostname)) {
    throw new Error('La URL no pertenece a Mercado Libre Argentina.');
  }

  const query = url.searchParams;
  const fragment = paramsFromFragment(url.hash);
  const path = decodeRepeated(url.pathname);

  const itemCandidates = [
    itemFromFilter(query.get('pdp_filters')),
    firstMatch(query.get('item_id'), ITEM_RE),
    firstMatch(query.get('wid'), ITEM_RE),
    itemFromFilter(fragment.get('pdp_filters')),
    firstMatch(fragment.get('item_id'), ITEM_RE),
    firstMatch(fragment.get('wid'), ITEM_RE),
  ].filter(Boolean);

  const articleMatch = path.match(/\/MLA-?(\d{7,})(?:-|\/|$)/i);
  if (/articulo\./i.test(url.hostname) && articleMatch) {
    itemCandidates.push(`MLA${articleMatch[1]}`);
  }

  const catalogCandidates = [];
  const pMatch = path.match(/\/p\/(MLA\d{7,})(?:\/|$)/i);
  if (pMatch) catalogCandidates.push(pMatch[1].toUpperCase());

  const upMatch = path.match(/\/up\/(MLAU\d{7,})(?:\/|$)/i);
  if (upMatch) catalogCandidates.push(upMatch[1].toUpperCase());

  for (const key of ['applied_product_filters', 'product_trigger_id']) {
    const value = firstMatch(query.get(key), PRODUCT_RE);
    if (value) catalogCandidates.push(value);
  }

  const attributeProduct = firstMatch(query.get('attributes'), /\bMLAU\d{7,}\b/i);
  if (attributeProduct) catalogCandidates.push(attributeProduct);

  return {
    itemId: [...new Set(itemCandidates)][0] || null,
    productId: [...new Set(catalogCandidates)][0] || null,
    itemIds: [...new Set(itemCandidates)],
    productIds: [...new Set(catalogCandidates)],
  };
}

function getToken(explicitToken) {
  return explicitToken || process.env.MELI_ACCESS_TOKEN || process.env.MELI_TOKEN || null;
}

async function fetchJson(path, { token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.message || body?.error || `Mercado Libre respondió HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function firstProductImage(product) {
  const pictures = Array.isArray(product?.pictures) ? product.pictures : [];
  for (const picture of pictures) {
    const candidate = picture?.secure_url || picture?.url || picture?.id;
    if (typeof candidate === 'string' && /^https:\/\//i.test(candidate)) return candidate;
  }
  return null;
}

function normalizePrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function chooseCatalogItem(results, requestedItemId) {
  if (!Array.isArray(results) || results.length === 0) return null;

  if (requestedItemId) {
    const exact = results.find((entry) => String(entry?.item_id || '').toUpperCase() === requestedItemId);
    if (exact) return exact;
  }

  return results
    .filter((entry) => normalizePrice(entry?.price) !== null)
    .sort((a, b) => normalizePrice(a.price) - normalizePrice(b.price))[0] || results[0];
}

export async function importMercadoLibreProduct(input, options = {}) {
  const ids = extractMercadoLibreIds(input);
  const token = getToken(options.token);

  if (!token) {
    throw new Error('Falta MELI_ACCESS_TOKEN en el backend.');
  }

  if (!ids.productId) {
    const error = new Error('Este link no contiene un productId de catálogo. Con la API oficial actual no podemos importar publicaciones directas sin catálogo.');
    error.code = 'CATALOG_PRODUCT_REQUIRED';
    throw error;
  }

  const warnings = [];
  let product = null;
  let catalogItems = null;

  try {
    product = await fetchJson(`/products/${encodeURIComponent(ids.productId)}`, {
      token,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    warnings.push({
      field: 'product',
      code: 'PRODUCT_API_ERROR',
      status: error.status || null,
      message: error.message,
    });
  }

  try {
    catalogItems = await fetchJson(`/products/${encodeURIComponent(ids.productId)}/items`, {
      token,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    warnings.push({
      field: 'price',
      code: 'CATALOG_ITEMS_API_ERROR',
      status: error.status || null,
      message: error.message,
    });
  }

  const selectedItem = chooseCatalogItem(catalogItems?.results, ids.itemId);
  const resolvedItemId = selectedItem?.item_id ? String(selectedItem.item_id).toUpperCase() : ids.itemId;

  if (!ids.itemId && selectedItem?.item_id) {
    warnings.push({
      field: 'price',
      code: 'CATALOG_ITEM_SELECTED',
      message: 'El link no indicaba una publicación específica; se tomó una publicación disponible del catálogo.',
    });
  } else if (ids.itemId && catalogItems?.results?.length && !catalogItems.results.some((entry) => String(entry?.item_id || '').toUpperCase() === ids.itemId)) {
    warnings.push({
      field: 'price',
      code: 'REQUESTED_ITEM_NOT_FOUND',
      message: 'La publicación indicada por el link no apareció entre los items actuales del catálogo.',
    });
  }

  const title = typeof product?.name === 'string' && product.name.trim() ? product.name.trim() : null;
  const image = firstProductImage(product);
  const price = normalizePrice(selectedItem?.price);

  const usefulFields = [title, image, price !== null].filter(Boolean).length;
  if (usefulFields === 0) {
    const error = new Error('Mercado Libre no devolvió nombre, foto ni precio para este producto.');
    error.causes = warnings;
    throw error;
  }

  return {
    title,
    price,
    currency: selectedItem?.currency_id || 'ARS',
    image,
    url: input,
    source: 'mercadolibre',
    itemId: resolvedItemId || null,
    productId: ids.productId,
    partial: usefulFields < 3,
    fields: {
      title: title ? 'ok' : 'unavailable',
      image: image ? 'ok' : 'unavailable',
      price: price !== null ? 'ok' : 'unavailable',
    },
    warnings,
  };
}
