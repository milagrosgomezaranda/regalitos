import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import {
  extractProductFromPage,
  validateMercadoLibreUrl,
  waitForMercadoLibreProduct,
} from '../mercadolibre-playwright.mjs';

chromium.setGraphicsMode = false;

const SUCCESS_CACHE_MS = 5 * 60 * 1000;
const cache = globalThis.__regalitosProductCache || new Map();
globalThis.__regalitosProductCache = cache;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function cacheKey(url) {
  const itemFromQuery = url.search.match(/(?:item_id%3A|item_id:)(MLA\d+)/i)?.[1];
  const itemFromHash = url.hash.match(/(?:wid=|item_id%3A|item_id:)(MLA\d+)/i)?.[1];
  return (itemFromQuery || itemFromHash || url.href).toUpperCase();
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > SUCCESS_CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function saveCached(key, value) {
  cache.set(key, { savedAt: Date.now(), value });
  if (cache.size > 50) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return res.status(400).json({ ok: false, error: 'Falta la URL del producto' });
  }

  let productUrl;
  try {
    productUrl = validateMercadoLibreUrl(rawUrl.trim());
  } catch (error) {
    return res.status(400).json({ ok: false, error: error?.message || 'URL inválida' });
  }

  const key = cacheKey(productUrl);
  const cached = getCached(key);
  if (cached) {
    return res.status(200).json({
      ok: true,
      ...cached,
      method: 'playwright-dom-cache',
      elapsedMs: Date.now() - startedAt,
    });
  }

  let browser;
  let context;
  let stage = 'prepare-chromium';

  try {
    const executablePath = await withTimeout(
      chromium.executablePath(),
      8000,
      'Chromium no pudo prepararse a tiempo.'
    );

    stage = 'launch-browser';
    browser = await withTimeout(
      playwrightChromium.launch({
        args: chromium.args,
        executablePath,
        headless: true,
      }),
      9000,
      'Chromium no pudo iniciar a tiempo.'
    );

    stage = 'create-context';
    context = await browser.newContext({
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      viewport: { width: 1365, height: 900 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.7',
      },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(4500);
    page.setDefaultNavigationTimeout(10000);

    await page.route('**/*', async (route) => {
      const request = route.request();
      const type = request.resourceType();
      const requestUrl = request.url();

      if (['image', 'media', 'font'].includes(type)) {
        return route.abort();
      }

      if (/doubleclick|google-analytics|googletagmanager|facebook\.net|hotjar|newrelic/i.test(requestUrl)) {
        return route.abort();
      }

      return route.continue();
    });

    stage = 'navigate';
    const response = await withTimeout(
      page.goto(productUrl.href, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      }),
      11000,
      'Mercado Libre tardó demasiado en abrir la ficha.'
    );

    if (response && response.status() >= 400) {
      throw new Error(`Mercado Libre respondió HTTP ${response.status()}.`);
    }

    stage = 'wait-product';
    await waitForMercadoLibreProduct(page, 5000);

    stage = 'extract-product';
    const product = await withTimeout(
      extractProductFromPage(page),
      5000,
      'La ficha abrió, pero los datos no aparecieron a tiempo.'
    );

    const result = {
      title: product.title,
      price: product.price,
      image: product.image,
      selectors: product.selectors,
    };

    saveCached(key, result);

    return res.status(200).json({
      ok: true,
      ...result,
      method: 'playwright-dom',
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error?.message || 'No se pudo leer la ficha de Mercado Libre.',
      stage,
      method: 'playwright-dom',
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    if (context) {
      await Promise.race([
        context.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    if (browser) {
      await Promise.race([
        browser.close().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    }
  }
}
