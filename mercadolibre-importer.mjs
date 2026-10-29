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

function browserlessError(status, bodyText = '') {
  if (status === 401 || status === 403) {
    return new Error('Browserless rechazó BROWSERLESS_TOKEN. Revisá la variable de entorno en Vercel.');
  }
  if (status === 429) return new Error('Browserless no tiene unidades/concurrencia disponibles en este momento.');
  const cleaned = String(bodyText || '').replace(/\s+/g, ' ').slice(0, 220);
  return new Error(`Browserless respondió HTTP ${status}${cleaned ? `: ${cleaned}` : ''}`);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Browserless tardó demasiado y se canceló la consulta.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function browserlessUnblock(fetchImpl, target, options = {}) {
  const token = options.browserlessToken || process.env.BROWSERLESS_TOKEN;
  if (!token) {
    const error = new Error('Falta BROWSERLESS_TOKEN en las Environment Variables de Vercel.');
    error.code = 'BROWSERLESS_CONFIG';
    throw error;
  }

  const baseUrl = String(options.browserlessBaseUrl || process.env.BROWSERLESS_BASE_URL || 'https://production-sfo.browserless.io').replace(/\/$/, '');
  const timeoutMs = options.timeoutMs ?? 30000;
  const params = new URLSearchParams({
    token,
    proxy: 'residential',
    proxyCountry: 'ar',
    proxyLocaleMatch: 'true',
    proxySticky: 'true',
    timeout: String(Math.min(timeoutMs, 45000)),
  });

  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/unblock?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({
      url: target,
      content: true,
      cookies: false,
      screenshot: false,
      browserWSEndpoint: false,
      bestAttempt: true,
      gotoOptions: {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(Math.max(timeoutMs - 6000, 8000), 22000),
      },
      // No esperamos un selector fijo. Mercado Libre tiene variantes de DOM/AB tests.
      // Dejamos un tiempo corto para que se hidraten precio e imagen.
      waitForTimeout: 2500,
      setExtraHTTPHeaders: {
        'Accept-Language': 'es-AR,es;q=0.9',
      },
    }),
  }, timeoutMs);

  const raw = await response.text();
  if (!response.ok) throw browserlessError(response.status, raw);

  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new Error('Browserless devolvió una respuesta JSON inválida.'); }

  if (!payload?.content || typeof payload.content !== 'string') {
    throw new Error('Browserless no devolvió el HTML renderizado de la ficha.');
  }
  return payload.content;
}

export async function importMercadoLibreProduct(input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch no está disponible en este runtime.');

  const ids = extractMercadoLibreIds(input);
  const normalized = normalizeMercadoLibreUrl(input);
  const html = await browserlessUnblock(fetchImpl, normalized, options);
  const product = extractProductFromHtml(html, normalized);

  if (!product.title && !product.price && !product.image) {
    throw new Error('Browserless abrió la ficha, pero no encontró datos de producto utilizables.');
  }

  return {
    ...product,
    method: 'browserless-unblock-residential-ar',
    ids,
  };
}
