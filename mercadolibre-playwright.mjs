const ML_HOST_RE = /(^|\.)mercadolibre\.com\.ar$/i;

export const MERCADOLIBRE_LOCATORS = Object.freeze({
  title: [
    'h1.ui-pdp-title',
    '[data-testid="product-title"]',
    'h1',
  ],
  price: [
    '#price .ui-pdp-price__second-line .andes-money-amount',
    '#price .ui-pdp-price__main-container .ui-pdp-price__second-line .andes-money-amount',
    '.ui-pdp-price__second-line .andes-money-amount',
    'meta[itemprop="price"]',
    'meta[property="product:price:amount"]',
  ],
  image: [
    'figure.ui-pdp-gallery__figure img.ui-pdp-image',
    '.ui-pdp-gallery__figure img.ui-pdp-image',
    '.ui-pdp-gallery__figure img',
    'img.ui-pdp-image',
    'meta[property="og:image"]',
  ],
});

const BLOCK_MARKERS = [
  '/gz/account-verification',
  'account verification',
  'verificá que sos humano',
  'verifica que eres humano',
  'verify you are human',
  'recaptcha',
  'captcha',
  'access denied',
  'request blocked',
];

const GENERIC_TITLES = new Set([
  'mercado libre',
  'mercadolibre',
  'verificación',
  'verificacion',
]);

export function validateMercadoLibreUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error('URL inválida.');
  }

  if (url.protocol !== 'https:' || !ML_HOST_RE.test(url.hostname)) {
    throw new Error('Solo se admiten enlaces HTTPS de Mercado Libre Argentina.');
  }

  return url;
}

export function normalizeTitle(value) {
  const title = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[|–-]\s*Mercado\s*Libre.*$/i, '')
    .trim();

  if (title.length < 4 || GENERIC_TITLES.has(title.toLowerCase())) return null;
  return title;
}

export function normalizePrice(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  let text = String(value || '').trim();
  if (!text) return null;

  text = text.replace(/[^\d.,]/g, '');
  if (!text) return null;

  if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  }

  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function isValidMercadoLibreImage(value) {
  if (!value) return false;

  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const path = `${url.pathname}${url.search}`.toLowerCase();

  if (!host.endsWith('mlstatic.com')) return false;
  if (/logo|favicon|brandmark|navigation|mercado[-_]?libre/.test(path)) return false;
  return true;
}

async function firstExistingLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) return { selector, locator };
  }
  return null;
}

async function readTitle(page) {
  for (const selector of MERCADOLIBRE_LOCATORS.title) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;

    const value = normalizeTitle(await locator.textContent().catch(() => null));
    if (value) return { value, selector };
  }

  return { value: null, selector: null };
}

async function readPrice(page) {
  for (const selector of MERCADOLIBRE_LOCATORS.price) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;

    if (selector.startsWith('meta')) {
      const value = normalizePrice(await locator.getAttribute('content').catch(() => null));
      if (value) return { value, selector };
      continue;
    }

    const fraction = await locator
      .locator('.andes-money-amount__fraction')
      .first()
      .textContent()
      .catch(() => null);

    if (fraction) {
      const cents = await locator
        .locator('.andes-money-amount__cents')
        .first()
        .textContent()
        .catch(() => null);

      const integer = normalizePrice(fraction);
      if (integer) {
        const value = cents && /^\d{1,2}$/.test(cents.trim())
          ? Number(`${integer}.${cents.trim().padEnd(2, '0')}`)
          : integer;
        return { value, selector };
      }
    }

    const aria = await locator.getAttribute('aria-label').catch(() => null);
    const ariaPrice = normalizePrice(aria);
    if (ariaPrice) return { value: ariaPrice, selector };

    const text = await locator.textContent().catch(() => null);
    const textPrice = normalizePrice(text);
    if (textPrice) return { value: textPrice, selector };
  }

  return { value: null, selector: null };
}

async function imageFromLocator(locator, selector) {
  if (selector.startsWith('meta')) {
    return locator.getAttribute('content').catch(() => null);
  }

  const currentSrc = await locator.evaluate((node) => node.currentSrc || '').catch(() => null);
  if (currentSrc) return currentSrc;

  return (
    (await locator.getAttribute('src').catch(() => null)) ||
    (await locator.getAttribute('data-src').catch(() => null)) ||
    null
  );
}

async function readImage(page) {
  for (const selector of MERCADOLIBRE_LOCATORS.image) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;

    const value = await imageFromLocator(locator, selector);
    if (isValidMercadoLibreImage(value)) return { value, selector };
  }

  return { value: null, selector: null };
}

export async function detectBlockedPage(page) {
  const currentUrl = String(page.url?.() || '').toLowerCase();
  if (BLOCK_MARKERS.some((marker) => currentUrl.includes(marker))) return true;

  const body = await page.locator('body').first().textContent().catch(() => '');
  const text = String(body || '').toLowerCase();
  return BLOCK_MARKERS.some((marker) => text.includes(marker));
}

export async function extractProductFromPage(page) {
  if (await detectBlockedPage(page)) {
    throw new Error('Mercado Libre mostró una página de verificación o bloqueo.');
  }

  const [title, price, image] = await Promise.all([
    readTitle(page),
    readPrice(page),
    readImage(page),
  ]);

  const missing = [
    !title.value && 'title',
    !price.value && 'price',
    !image.value && 'image',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Playwright no encontró todos los datos; faltan: ${missing.join(', ')}.`);
  }

  return {
    title: title.value,
    price: price.value,
    image: image.value,
    method: 'playwright-dom',
    selectors: {
      title: title.selector,
      price: price.selector,
      image: image.selector,
    },
  };
}

export async function waitForMercadoLibreProduct(page, timeout = 10000) {
  const candidate = await firstExistingLocator(page, MERCADOLIBRE_LOCATORS.title);
  if (candidate) return;

  await page.locator(MERCADOLIBRE_LOCATORS.title.join(', ')).first().waitFor({
    state: 'attached',
    timeout,
  });
}
