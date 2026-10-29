const ITEM_RE = /\bMLA\d{7,}\b/i;
const PRODUCT_RE = /\b(?:MLA|MLAU)\d{7,}\b/i;

function firstMatch(value, regex) {
  const match = String(value || '').match(regex);
  return match ? match[0].toUpperCase() : null;
}

function itemFromFilter(value) {
  const decoded = decodeURIComponent(String(value || ''));
  const match = decoded.match(/(?:^|[,&])\s*item_id\s*[:=]\s*(MLA\d{7,})/i);
  return match ? match[1].toUpperCase() : null;
}

function parseHashParams(hash = '') {
  const raw = String(hash || '').replace(/^#/, '');
  return new URLSearchParams(raw);
}

export function extractMercadoLibreIds(input) {
  const url = new URL(input);
  const query = url.searchParams;
  const hash = parseHashParams(url.hash);
  const path = url.pathname;

  const itemCandidates = [];
  for (const value of [
    query.get('pdp_filters'),
    query.get('item_id'),
    query.get('wid'),
    hash.get('pdp_filters'),
    hash.get('item_id'),
    hash.get('wid'),
  ]) {
    const item = itemFromFilter(value) || firstMatch(value, ITEM_RE);
    if (item) itemCandidates.push(item);
  }

  const articuloMatch = path.match(/\/articulo\/(MLA\d{7,})/i);
  if (articuloMatch) itemCandidates.push(articuloMatch[1].toUpperCase());

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
  for (const key of ['matt_tool', 'ua', 'action', 'sid', 'origin']) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
}

export function isValidProductImage(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    const full = `${url.pathname}${url.search}`.toLowerCase();
    return host.endsWith('mlstatic.com') && !/logo|favicon|navigation|brandmark|mercado[-_]?libre/.test(full);
  } catch {
    return false;
  }
}

function normalizePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  let text = String(value || '').trim().replace(/[^\d.,-]/g, '');
  if (!text) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function browserlessError(status, bodyText = '') {
  if (status === 401 || status === 403) {
    return new Error('Browserless rechazó BROWSERLESS_TOKEN. Revisá la variable de entorno en Vercel.');
  }
  if (status === 429) return new Error('Browserless no tiene unidades/concurrencia disponibles en este momento.');
  const cleaned = String(bodyText || '').replace(/\s+/g, ' ').slice(0, 240);
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

const BROWSER_FUNCTION = String.raw`
export default async ({ page, context }) => {
  const out = { title: null, price: null, image: null, debug: {} };

  try {
    await page.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1 });
    await page.goto(context.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('h1.ui-pdp-title', { timeout: 12000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));

    out.title = await page.$eval('h1.ui-pdp-title', (el) => el.textContent?.trim() || null).catch(() => null);

    const priceData = await page.evaluate(() => {
      const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const parseAmount = (el) => {
        if (!el || !visible(el)) return null;
        const fraction = clean(el.querySelector('.andes-money-amount__fraction')?.textContent);
        const cents = clean(el.querySelector('.andes-money-amount__cents')?.textContent);
        if (!fraction) return null;
        const integer = fraction.replace(/\./g, '').replace(/\D/g, '');
        if (!integer) return null;
        return cents ? Number(integer + '.' + cents.replace(/\D/g, '').slice(0, 2)) : Number(integer);
      };

      const selectors = [
        '#price .ui-pdp-price__second-line .andes-money-amount',
        '#price .ui-pdp-price__main-container .andes-money-amount',
        '#price .andes-money-amount',
        '[itemprop="offers"] [itemprop="price"]',
        'meta[itemprop="price"]'
      ];

      const candidates = [];
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const original = el.closest('.ui-pdp-price__original-value, s, del, [data-testid*="original"]');
          const amount = el.tagName === 'META'
            ? Number(el.getAttribute('content'))
            : parseAmount(el);
          candidates.push({
            selector,
            amount: Number.isFinite(amount) && amount > 0 ? amount : null,
            text: clean(el.textContent || el.getAttribute?.('content')),
            original: Boolean(original),
            visible: el.tagName === 'META' ? true : visible(el),
          });
        }
      }

      const preferred = candidates.find((c) => c.amount && !c.original && c.selector.includes('second-line'))
        || candidates.find((c) => c.amount && !c.original && c.visible)
        || candidates.find((c) => c.amount && !c.original)
        || null;

      return { value: preferred?.amount || null, candidates: candidates.slice(0, 12) };
    }).catch(() => ({ value: null, candidates: [] }));

    out.price = priceData.value;
    out.debug.priceCandidates = priceData.candidates;

    const imageData = await page.evaluate(() => {
      const selectors = [
        'figure.ui-pdp-gallery__figure img.ui-pdp-image',
        '.ui-pdp-gallery__figure img',
        'img.ui-pdp-image',
        'meta[property="og:image"]'
      ];
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (!el) continue;
        if (el.tagName === 'META') return el.getAttribute('content');
        const srcset = String(el.getAttribute('srcset') || '').split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean);
        return el.currentSrc || srcset[srcset.length - 1] || el.getAttribute('data-zoom') || el.getAttribute('data-src') || el.getAttribute('src');
      }
      return null;
    }).catch(() => null);

    out.image = imageData;
    out.debug.url = page.url();
    out.debug.pageTitle = await page.title().catch(() => null);
  } catch (error) {
    out.debug.error = error?.message || String(error);
    out.debug.url = page.url();
  }

  return { data: out, type: 'application/json' };
};
`;

async function fetchViaBrowserlessFunction(fetchImpl, target, options = {}) {
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

  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/function?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
    body: JSON.stringify({ code: BROWSER_FUNCTION, context: { url: target } }),
  }, timeoutMs);

  const raw = await response.text();
  if (!response.ok) throw browserlessError(response.status, raw);

  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new Error('Browserless devolvió una respuesta JSON inválida.'); }

  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return data || {};
}

export async function importMercadoLibreProduct(input, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch no está disponible en este runtime.');

  const ids = extractMercadoLibreIds(input);
  const normalized = normalizeMercadoLibreUrl(input);
  const raw = await fetchViaBrowserlessFunction(fetchImpl, normalized, options);

  const title = String(raw.title || '').trim() || null;
  const price = normalizePrice(raw.price);
  const image = isValidProductImage(raw.image) ? String(raw.image) : null;
  const missing = [!title && 'title', !price && 'price', !image && 'image'].filter(Boolean);

  if (!title && !price && !image) {
    const debugError = raw?.debug?.error ? ` ${raw.debug.error}` : '';
    throw new Error(`Browserless abrió la ficha pero no pudo extraer datos.${debugError}`);
  }

  return {
    title,
    price,
    image,
    missing,
    debug: raw.debug || {},
    method: 'browserless-function-residential-ar',
    ids,
  };
}
