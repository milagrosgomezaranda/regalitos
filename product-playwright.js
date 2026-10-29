import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';
import {
  extractProductFromPage,
  validateMercadoLibreUrl,
  waitForMercadoLibreProduct,
} from '../mercadolibre-playwright.mjs';

chromium.setGraphicsMode = false;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;

  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return res.status(400).json({ error: 'Falta la URL del producto' });
  }

  let productUrl;
  try {
    productUrl = validateMercadoLibreUrl(rawUrl.trim());
  } catch (error) {
    return res.status(400).json({ error: error?.message || 'URL inválida' });
  }

  const userDataDir = `/tmp/regalitos-pw-${randomUUID()}`;
  let browser;

  try {
    browser = await playwrightChromium.launch({
      args: [...chromium.args, `--user-data-dir=${userDataDir}`],
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext({
      locale: 'es-AR',
      timezoneId: 'America/Argentina/Buenos_Aires',
      viewport: { width: 1440, height: 1200 },
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.7',
      },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(25000);

    const response = await page.goto(productUrl.href, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    if (response && response.status() >= 400) {
      throw new Error(`Mercado Libre respondió HTTP ${response.status()}.`);
    }

    await waitForMercadoLibreProduct(page, 10000).catch(() => {});
    const product = await extractProductFromPage(page);

    return res.status(200).json(product);
  } catch (error) {
    return res.status(502).json({
      error: error?.message || 'Playwright no pudo leer la ficha de Mercado Libre.',
      method: 'playwright-dom',
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}
