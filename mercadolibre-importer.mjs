const ML_HOST_RE = /(^|\.)mercadolibre\.com\.ar$/i;
const ITEM_RE = /\bMLA\d{7,}\b/i;
const PRODUCT_RE = /\bMLAU?\d{7,}\b/i;

const GENERIC_TITLES = [
  'mercado libre',
  'mercadolibre',
  'verificación',
  'verificacion',
  'account verification',
  'access denied',
  'iniciá sesión',
  'inicia sesión',
  'captcha',
];

const BLOCK_MARKERS = [
  '/gz/account-verification',
  'account-verification',
  'captcha',
  'recaptcha',
  'verify you are human',
  'verificá que sos humano',
  'verifica que eres humano',
  'access denied',
  'request blocked',
  'robot check',
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
  const m = decodeRepeated(value).match(regex);
  return m ? m[0].toUpperCase() : null;
}

function itemFromFilter(value) {
  const decoded = decodeRepeated(value);
  const m = decoded.match(/(?:^|[,&;|\s])item_id\s*[:=]\s*(MLA\d{7,})\b/i)
    || decoded.match(/\bitem_id\s*[:=]\s*(MLA\d{7,})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function paramsFromFragment(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw || (!raw.includes('=') && !raw.includes('&'))) return new URLSearchParams();
  return new URLSearchParams(raw);
}

export function extractMercadoLibreIds(input) {
  const url = new URL(input);
  if (!ML_HOST_RE.test(url.hostname) && !/(^|\.)mercadolibre\.com$/i.test(url.hostname)) {
    throw new Error('La URL no pertenece a Mercado Libre Argentina.');
  }

  const fragment = paramsFromFragment(url.hash);
  const query = url.searchParams;
  const path = decodeRepeated(url.pathname);

  const itemCandidates = [
    itemFromFilter(query.get('pdp_filters')),
    firstMatch(query.get('item_id'), ITEM_RE),
    firstMatch(fragment.get('wid'), ITEM_RE),
    firstMatch(query.get('wid'), ITEM_RE),
  ].filter(Boolean);

  // Sólo tratamos como publicación el MLA de una URL articulo/MLA-...;
  // un /p/MLA... es un producto de catálogo, no un item.
  const articuloMatch = path.match(/\/MLA-?(\d{7,})(?:-|\/|$)/i);
  if (/articulo\./i.test(url.hostname) && articuloMatch) {
    itemCandidates.push(`MLA${articuloMatch[1]}`);
  }

  const catalogCandidates = [];
  const pMatch = path.match(/\/p\/(MLA\d{7,})(?:\/|$)/i);
  if (pMatch) catalogCandidates.push(pMatch[1].toUpperCase());
  const upMatch = path.match(/\/up\/(MLAU\d{7,})(?:\/|$)/i);
  if (upMatch) catalogCandidates.push(upMatch[1].toUpperCase());

  // IDs auxiliares de catálogo/User Product. No deben pisar el item_id real.
  for (const key of ['applied_product_filters', 'product_trigger_id']) {
    const value = firstMatch(query.get(key), PRODUCT_RE);
    if (value) catalogCandidates.push(value);
  }
  const attributesProduct = firstMatch(query.get('attributes'), /\bMLAU\d{7,}\b/i);
  if (attributesProduct) catalogCandidates.push(attributesProduct);

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

  // El fragmento no llega al servidor. Si el único item_id estaba en #wid,
  // lo trasladamos a pdp_filters para preservar la publicación seleccionada.
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
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodeHtml(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

function getMetaMap(html) {
  const map = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseTagAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content && !map.has(key)) map.set(key, attrs.content);
  }
  return map;
}

function parseJsonLd(html) {
  const values = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw) continue;
    try { values.push(JSON.parse(raw)); } catch { /* malformed block */ }
  }
  return values;
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visitor);
    return;
  }
  if (!value || typeof value !== 'object') return;
  visitor(value);
  for (const v of Object.values(value)) walk(v, visitor);
}

function isProductNode(node) {
  const type = node?.['@type'];
  return (Array.isArray(type) ? type : [type]).some((v) => String(v).toLowerCase() === 'product');
}

function normalizeImageCandidate(value) {
  if (Array.isArray(value)) return value.map(normalizeImageCandidate).find(Boolean) || null;
  if (value && typeof value === 'object') return normalizeImageCandidate(value.url || value.contentUrl || value.src);
  if (!value) return null;
  const s = decodeHtml(String(value)).replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  try { return new URL(s).toString(); } catch { return null; }
}

export function isValidProductImage(value) {
  const normalized = normalizeImageCandidate(value);
  if (!normalized) return false;
  let url;
  try { url = new URL(normalized); } catch { return false; }
  const host = url.hostname.toLowerCase();
  const path = `${url.pathname}${url.search}`.toLowerCase();
  if (!host.endsWith('mlstatic.com')) return false;
  if (/logo|favicon|navigation|brandmark|mercado[-_]?libre/.test(path)) return false;
  return true;
}

function normalizeTitle(value) {
  if (!value) return null;
  const title = stripTags(value)
    .replace(/\s*[|–-]\s*Mercado\s*Libre.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title.length < 4) return null;
  const lower = title.toLowerCase();
  if (GENERIC_TITLES.some((x) => lower === x || lower.startsWith(`${x} `))) return null;
  return title;
}

function normalizePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (!value) return null;
  let s = stripTags(String(value)).replace(/[^\d.,-]/g, '');
  if (!s) return null;

  // Formato AR: 189.999 o 12.345,67. Si sólo hay punto y 3 dígitos finales,
  // es separador de miles; si hay coma, la coma es decimal.
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function offerPrice(offers) {
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const p = offerPrice(offer);
      if (p) return p;
    }
    return null;
  }
  if (!offers || typeof offers !== 'object') return null;
  return normalizePrice(offers.price ?? offers.lowPrice ?? offers.highPrice);
}

function fromJsonLd(html) {
  let result = {};
  for (const doc of parseJsonLd(html)) {
    walk(doc, (node) => {
      if (!isProductNode(node)) return;
      result = {
        title: result.title || normalizeTitle(node.name || node.headline),
        price: result.price || offerPrice(node.offers),
        image: result.image || normalizeImageCandidate(node.image),
      };
    });
  }
  return result;
}

function firstClassText(html, classFragment) {
  const re = new RegExp(`<[^>]+class=["'][^"']*${classFragment}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  const m = html.match(re);
  return m ? stripTags(m[1]) : null;
}

function firstImageByClass(html, classFragment) {
  const re = new RegExp(`<img\\b[^>]*class=["'][^"']*${classFragment}[^"']*["'][^>]*>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  const attrs = parseTagAttributes(m[0]);
  return normalizeImageCandidate(attrs.src || attrs['data-src'] || attrs.srcset?.split(/\s+/)[0]);
}

function embeddedJsonFallback(html) {
  const decoded = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  const titleMatch = decoded.match(/"(?:title|name)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
  const priceMatch = decoded.match(/"(?:price|current_price|amount)"\s*:\s*(?:"([\d.,]+)"|([\d.]+))/i);
  const imageMatches = [...decoded.matchAll(/https?:\/\/[^"'\s<>\\]+mlstatic\.com\/[^"'\s<>\\]+/gi)];
  return {
    title: normalizeTitle(titleMatch?.[1]?.replace(/\\"/g, '"')),
    price: normalizePrice(priceMatch?.[1] ?? priceMatch?.[2]),
    image: imageMatches.map((m) => normalizeImageCandidate(m[0])).find(isValidProductImage) || null,
  };
}

export function looksBlocked(text, finalUrl = '') {
  const sample = `${finalUrl}\n${String(text || '').slice(0, 50000)}`.toLowerCase();
  return BLOCK_MARKERS.some((marker) => sample.includes(marker));
}

export function extractProductFromHtml(html, finalUrl = '') {
  if (!html || looksBlocked(html, finalUrl)) throw new Error('Mercado Libre devolvió una página de verificación/bloqueo.');
  const meta = getMetaMap(html);
  const json = fromJsonLd(html);
  const embedded = embeddedJsonFallback(html);

  const title = json.title
    || normalizeTitle(meta.get('og:title'))
    || normalizeTitle(meta.get('twitter:title'))
    || normalizeTitle(firstClassText(html, 'ui-pdp-title'))
    || embedded.title;

  const price = json.price
    || normalizePrice(meta.get('product:price:amount'))
    || normalizePrice(meta.get('og:price:amount'))
    || normalizePrice(meta.get('price'))
    || normalizePrice(firstClassText(html, 'andes-money-amount__fraction'))
    || embedded.price;

  const imageCandidates = [
    json.image,
    meta.get('og:image'),
    meta.get('twitter:image'),
    meta.get('image'),
    firstImageByClass(html, 'ui-pdp-image'),
    embedded.image,
  ].map(normalizeImageCandidate);
  const image = imageCandidates.find(isValidProductImage) || null;

  if (!title || !price || !image) {
    const missing = [!title && 'title', !price && 'price', !image && 'image'].filter(Boolean).join(', ');
    throw new Error(`Respuesta incompleta o no confiable; faltan: ${missing}.`);
  }
  return { title, price, image };
}

function extractFromMarkdown(markdown, finalUrl = '') {
  if (!markdown || looksBlocked(markdown, finalUrl)) throw new Error('El lector devolvió una página de verificación/bloqueo.');
  const lines = String(markdown).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const title = lines
    .filter((x) => /^#{1,3}\s+/.test(x))
    .map((x) => normalizeTitle(x.replace(/^#{1,3}\s+/, '')))
    .find(Boolean) || null;

  let price = null;
  for (const line of lines) {
    if (line.includes('~~')) continue;
    const m = line.match(/\$\s*([\d.]+(?:,\d{1,2})?)/);
    if (m) { price = normalizePrice(m[1]); if (price) break; }
  }

  const image = [...String(markdown).matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((m) => normalizeImageCandidate(m[1]))
    .find(isValidProductImage) || null;

  if (!title || !price || !image) {
    const missing = [!title && 'title', !price && 'price', !image && 'image'].filter(Boolean).join(', ');
    throw new Error(`Respuesta renderizada incompleta o no confiable; faltan: ${missing}.`);
  }
  return { title, price, image };
}

async function fetchText(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12000);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/156 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'es-AR,es;q=0.9,en;q=0.7',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text, finalUrl: res.url || url, contentType: res.headers?.get?.('content-type') || '' };
  } finally {
    clearTimeout(timer);
  }
}

export async function importMercadoLibreProduct(input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch no está disponible en este runtime.');

  const normalized = normalizeMercadoLibreUrl(input);
  const targets = [...new Set([input, normalized])];
  const errors = [];

  for (const target of targets) {
    try {
      const r = await fetchText(fetchImpl, target, { timeoutMs: options.timeoutMs });
      return extractProductFromHtml(r.text, r.finalUrl);
    } catch (error) {
      errors.push(`direct:${error.message}`);
    }
  }

  for (const target of targets) {
    try {
      const proxyUrl = `https://cors.tools/proxy?url=${encodeURIComponent(target)}`;
      const r = await fetchText(fetchImpl, proxyUrl, { timeoutMs: options.timeoutMs ?? 18000 });
      return extractProductFromHtml(r.text, r.finalUrl);
    } catch (error) {
      errors.push(`cors-proxy:${error.message}`);
    }
  }

  for (const target of targets) {
    try {
      const readUrl = `https://cors.tools/read?url=${encodeURIComponent(target)}&format=markdown&render=true`;
      const r = await fetchText(fetchImpl, readUrl, { timeoutMs: options.timeoutMs ?? 20000 });
      return extractFromMarkdown(r.text, r.finalUrl);
    } catch (error) {
      errors.push(`cors-read:${error.message}`);
    }
  }

  const e = new Error('No se pudieron obtener title, price e image de forma confiable.');
  e.causes = errors;
  throw e;
}
