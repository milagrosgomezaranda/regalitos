const ML_HOST_RE = /(^|\.)mercadolibre\.com\.ar$/i;
const ITEM_RE = /\bMLA\d{7,}\b/i;
const PRODUCT_RE = /\b(?:MLA|MLAU)\d{7,}\b/i;

const BLOCK_MARKERS = [
  '/gz/account-verification',
  'account-verification',
  'captcha',
  'recaptcha',
  'verify you are human',
  'verifica que eres humano',
  'verificá que sos humano',
  'access denied',
  'request blocked',
  'robot check',
];

const GENERIC_TITLES = [
  'mercado libre',
  'mercadolibre',
  'verificación',
  'verificacion',
  'account verification',
  'access denied',
  'captcha',
];

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
  const match = decodeRepeated(value).match(regex);
  return match ? match[0].toUpperCase() : null;
}

function itemFromFilter(value) {
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
  const url = new URL(input);
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

  const articuloMatch = path.match(/\/MLA-?(\d{7,})(?:-|\/|$)/i);
  if (/articulo\./i.test(url.hostname) && articuloMatch) {
    itemCandidates.push(`MLA${articuloMatch[1]}`);
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
    catalogId: [...new Set(catalogCandidates)][0] || null,
    itemIds: [...new Set(itemCandidates)],
    catalogIds: [...new Set(catalogCandidates)],
  };
}

export function normalizeMercadoLibreUrl(input) {
  const url = new URL(input);
  const ids = extractMercadoLibreIds(input);

  if (ids.itemId && !itemFromFilter(url.searchParams.get('pdp_filters'))) {
    url.searchParams.set('pdp_filters', `item_id:${ids.itemId}`);
  }

  for (const key of ['matt_tool', 'ua', 'action', 'sid', 'origin']) {
    url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function stripTags(value = '') {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim();
}

function parseTagAttributes(tag) {
  const attrs = {};
  const regex = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = regex.exec(tag))) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function normalizeTitle(value) {
  if (!value) return null;
  const title = stripTags(value)
    .replace(/\s*[|–-]\s*Mercado\s*Libre.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length < 4) return null;
  const lower = title.toLowerCase();
  if (GENERIC_TITLES.some((generic) => lower === generic || lower.startsWith(`${generic} `))) return null;
  return title;
}

function normalizePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (!value) return null;

  let text = stripTags(String(value)).replace(/[^\d.,-]/g, '');
  if (!text) return null;

  if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  }

  const price = Number(text);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function normalizeImageCandidate(value) {
  if (!value) return null;
  const raw = String(value)
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

export function isValidProductImage(value) {
  const normalized = normalizeImageCandidate(value);
  if (!normalized) return false;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (!host.endsWith('mlstatic.com')) return false;
  if (/logo|favicon|navigation|brandmark|mercado[-_]?libre/.test(path)) return false;
  return true;
}

export function looksBlocked(text, finalUrl = '') {
  const sample = `${finalUrl}\n${String(text || '').slice(0, 80000)}`.toLowerCase();
  return BLOCK_MARKERS.some((marker) => sample.includes(marker));
}

function getMetaMap(html) {
  const map = new Map();
  for (const match of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseTagAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !map.has(key)) map.set(key, attrs.content);
  }
  return map;
}

function parseJsonLd(html) {
  const values = [];
  for (const match of String(html).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw) continue;
    try {
      values.push(JSON.parse(raw));
    } catch {
      // Mercado Libre puede incluir otros scripts no JSON; se ignoran.
    }
  }
  return values;
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  if (!value || typeof value !== 'object') return;
  visitor(value);
  for (const nested of Object.values(value)) walk(nested, visitor);
}

function extractJsonLdProduct(html) {
  const result = { title: null, price: null, image: null };
  for (const doc of parseJsonLd(html)) {
    walk(doc, (node) => {
      const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
      if (!types.some((type) => String(type).toLowerCase() === 'product')) return;
      result.title ||= normalizeTitle(node.name || node.headline);
      const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      result.price ||= normalizePrice(offers?.price ?? offers?.lowPrice ?? offers?.highPrice);
      const imageValue = Array.isArray(node.image) ? node.image[0] : node.image;
      const image = normalizeImageCandidate(imageValue?.url || imageValue?.contentUrl || imageValue);
      if (!result.image && isValidProductImage(image)) result.image = image;
    });
  }
  return result;
}

function findTagTextByClass(html, className) {
  const source = String(html || '');
  const classRe = new RegExp(`<([a-z0-9]+)\\b[^>]*class=["'][^"']*\\b${className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^"']*["'][^>]*>`, 'ig');
  const open = classRe.exec(source);
  if (!open) return null;
  const tag = open[1];
  const start = classRe.lastIndex;
  const close = new RegExp(`</${tag}\\s*>`, 'ig');
  close.lastIndex = start;
  const end = close.exec(source);
  if (!end) return null;
  return stripTags(source.slice(start, end.index));
}

function sliceAroundMarker(html, markerRegex, maxLength = 30000) {
  const source = String(html || '');
  const match = markerRegex.exec(source);
  if (!match) return '';
  return source.slice(match.index, match.index + maxLength);
}

function metaPriceFromFragment(fragment) {
  for (const tagMatch of String(fragment || '').matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseTagAttributes(tagMatch[0]);
    if (String(attrs.itemprop || '').toLowerCase() === 'price') {
      const price = normalizePrice(attrs.content);
      if (price) return price;
    }
  }
  return null;
}

function hiddenPriceFromFragment(fragment) {
  for (const match of String(fragment || '').matchAll(/<[^>]+class=["'][^"']*andes-visually-hidden[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)) {
    const text = stripTags(match[1]);
    const amount = text.match(/(\d[\d.]*)\s*(?:pesos?|reais?|ars|\$)/i);
    if (!amount) continue;
    const cents = text.match(/(?:con|e)\s+(\d{1,2})\s+cent/i);
    const price = normalizePrice(cents ? `${amount[1]},${cents[1]}` : amount[1]);
    if (price) return price;
  }
  return null;
}

function visibleMoneyFromFragment(fragment) {
  const source = String(fragment || '');
  const fractionMarker = /class=["'][^"']*andes-money-amount__fraction[^"']*["'][^>]*>/i.exec(source);
  if (!fractionMarker) return null;
  const after = source.slice(fractionMarker.index + fractionMarker[0].length, fractionMarker.index + fractionMarker[0].length + 100);
  const fractionText = stripTags(after.split(/<\//)[0]);
  if (!fractionText) return null;

  const centsMarker = /class=["'][^"']*andes-money-amount__cents[^"']*["'][^>]*>/i.exec(source.slice(fractionMarker.index));
  let cents = null;
  if (centsMarker) {
    const centsAfter = source.slice(fractionMarker.index + centsMarker.index + centsMarker[0].length, fractionMarker.index + centsMarker.index + centsMarker[0].length + 40);
    cents = stripTags(centsAfter.split(/<\//)[0]);
  }
  return normalizePrice(cents ? `${fractionText},${cents}` : fractionText);
}

function extractPriceFromHtml(html, meta, jsonLd) {
  // 1) Mercado Libre publica el precio actual como <meta itemProp="price" content="...">
  // dentro del bloque #price. Es la fuente mas estable y evita confundir cuotas/precio tachado.
  const priceBlock = sliceAroundMarker(html, /<[^>]+(?:id=["']price["']|class=["'][^"']*ui-pdp-container__row--price[^"']*["'])[^>]*>/i, 35000);
  const secondLine = sliceAroundMarker(priceBlock || html, /class=["'][^"']*ui-pdp-price__second-line[^"']*["']/i, 12000);

  return metaPriceFromFragment(secondLine)
    || metaPriceFromFragment(priceBlock)
    || hiddenPriceFromFragment(secondLine)
    || visibleMoneyFromFragment(secondLine)
    || jsonLd.price
    || normalizePrice(meta.get('product:price:amount'))
    || normalizePrice(meta.get('og:price:amount'))
    || normalizePrice(meta.get('price'))
    || null;
}

function firstValidImageInHtml(fragment) {
  for (const match of String(fragment || '').matchAll(/<img\b[^>]*>/gi)) {
    const attrs = parseTagAttributes(match[0]);
    const srcset = String(attrs.srcset || '')
      .split(',')
      .map((entry) => entry.trim().split(/\s+/)[0])
      .filter(Boolean)
      .reverse();
    const candidates = [attrs['data-zoom'], ...srcset, attrs['data-src'], attrs.src];
    for (const candidate of candidates) {
      const normalized = normalizeImageCandidate(candidate);
      if (isValidProductImage(normalized)) return normalized;
    }
  }
  return null;
}

function extractTitleFromHtml(html, meta, jsonLd) {
  const h1 = String(html || '').match(/<h1\b[^>]*class=["'][^"']*ui-pdp-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i);
  const itemName = String(html || '').match(/<[^>]+itemprop=["']name["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  const pageTitle = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

  return normalizeTitle(h1?.[1])
    || jsonLd.title
    || normalizeTitle(meta.get('og:title'))
    || normalizeTitle(meta.get('twitter:title'))
    || normalizeTitle(itemName?.[1])
    || normalizeTitle(pageTitle?.[1])
    || null;
}

function extractImageFromHtml(html, meta, jsonLd) {
  const gallery = sliceAroundMarker(html, /class=["'][^"']*ui-pdp-gallery__figure[^"']*["']/i, 30000);
  return firstValidImageInHtml(gallery)
    || firstValidImageInHtml(sliceAroundMarker(html, /class=["'][^"']*ui-pdp-image[^"']*["']/i, 20000))
    || [meta.get('og:image'), meta.get('twitter:image'), meta.get('image')]
      .map(normalizeImageCandidate)
      .find(isValidProductImage)
    || jsonLd.image
    || null;
}

export function extractProductFromHtml(html, finalUrl = '') {
  if (!html || looksBlocked(html, finalUrl)) {
    throw new Error('Browserless recibió una página de verificación o bloqueo de Mercado Libre.');
  }

  const meta = getMetaMap(html);
  const jsonLd = extractJsonLdProduct(html);
  const title = extractTitleFromHtml(html, meta, jsonLd);
  const price = extractPriceFromHtml(html, meta, jsonLd);
  const image = extractImageFromHtml(html, meta, jsonLd);
  const missing = [!title && 'title', !price && 'price', !image && 'image'].filter(Boolean);

  return { title, price, image, missing };
}


function normalizeProviderImage(value) {
  const candidate = typeof value === 'string' ? value : value?.url;
  const normalized = normalizeImageCandidate(candidate);
  return isValidProductImage(normalized) ? normalized : null;
}

function normalizeProviderTitle(value) {
  return normalizeTitle(value);
}

function normalizeMetadataPayload(payload = {}) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const image = normalizeProviderImage(data?.image)
    || normalizeProviderImage(data?.og?.['og:image'])
    || normalizeProviderImage(data?.twitter?.['twitter:image'])
    || null;
  const title = normalizeProviderTitle(data?.title)
    || normalizeProviderTitle(data?.og?.['og:title'])
    || normalizeProviderTitle(data?.twitter?.['twitter:title'])
    || null;
  const price = normalizePrice(
    data?.price
      ?? data?.og?.['product:price:amount']
      ?? data?.og?.['og:price:amount']
      ?? null,
  );
  return { title, price, image };
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryDirectPreviewHtml(fetchImpl, target, timeoutMs) {
  try {
    const response = await fetchWithTimeout(fetchImpl, target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'facebookexternalhit/1.1 (+https://www.facebook.com/externalhit_uatext.php)',
        'Accept-Language': 'es-AR,es;q=0.9',
      },
    }, timeoutMs);
    if (!response.ok) return null;
    const html = await response.text();
    if (!html || looksBlocked(html, response.url || target)) return null;
    return extractProductFromHtml(html, response.url || target);
  } catch {
    return null;
  }
}

async function tryLinkMetadata(fetchImpl, target, timeoutMs) {
  try {
    const endpoint = new URL('https://api.linkmetadata.com/v1/metadata');
    endpoint.searchParams.set('url', target);
    endpoint.searchParams.set('prefer', 'og');
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, timeoutMs);
    if (!response.ok) return null;
    const payload = await response.json();
    return normalizeMetadataPayload(payload);
  } catch {
    return null;
  }
}

async function tryMicrolink(fetchImpl, target, timeoutMs) {
  try {
    const endpoint = new URL('https://api.microlink.io/');
    endpoint.searchParams.set('url', target);
    endpoint.searchParams.set('meta', 'true');
    endpoint.searchParams.set('filter', 'title,image.url,url');
    const response = await fetchWithTimeout(fetchImpl, endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, timeoutMs);
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.status && payload.status !== 'success') return null;
    return normalizeMetadataPayload(payload);
  } catch {
    return null;
  }
}

function mergeProducts(...products) {
  const valid = products.filter(Boolean);
  const title = valid.map((p) => normalizeProviderTitle(p.title)).find(Boolean) || null;
  const price = valid.map((p) => normalizePrice(p.price)).find(Boolean) || null;
  const image = valid.map((p) => normalizeProviderImage(p.image)).find(Boolean) || null;
  return {
    title,
    price,
    image,
    missing: [!title && 'title', !price && 'price', !image && 'image'].filter(Boolean),
  };
}

export async function importMercadoLibreProduct(input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch no está disponible en este runtime.');

  const ids = extractMercadoLibreIds(input);
  const normalized = normalizeMercadoLibreUrl(input);
  const attempts = [];

  const direct = await tryDirectPreviewHtml(fetchImpl, normalized, options.directTimeoutMs ?? 4500);
  attempts.push({ source: 'direct-preview', ok: Boolean(direct), hasImage: Boolean(direct?.image) });
  if (direct?.image && direct?.title && direct?.price) {
    return { ...direct, method: 'direct-preview', ids, debug: undefined };
  }

  const linkMetadata = await tryLinkMetadata(fetchImpl, normalized, options.metadataTimeoutMs ?? 8000);
  attempts.push({ source: 'linkmetadata', ok: Boolean(linkMetadata), hasImage: Boolean(linkMetadata?.image) });

  let merged = mergeProducts(direct, linkMetadata);
  if (merged.image && merged.title) {
    return {
      ...merged,
      method: direct?.image ? 'direct-preview+linkmetadata' : 'linkmetadata',
      ids,
      debug: merged.missing.length ? { attempts } : undefined,
    };
  }

  const microlink = await tryMicrolink(fetchImpl, normalized, options.microlinkTimeoutMs ?? 12000);
  attempts.push({ source: 'microlink', ok: Boolean(microlink), hasImage: Boolean(microlink?.image) });
  merged = mergeProducts(direct, linkMetadata, microlink);

  if (!merged.image) {
    const error = new Error('No se pudo obtener una foto de producto desde los metadatos del enlace.');
    error.code = 'NO_PRODUCT_IMAGE';
    error.debug = { attempts };
    throw error;
  }

  return {
    ...merged,
    method: microlink?.image ? 'metadata+microlink' : 'metadata',
    ids,
    debug: merged.missing.length ? { attempts } : undefined,
  };
}
