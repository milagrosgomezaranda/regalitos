import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MERCADOLIBRE_LOCATORS,
  extractProductFromPage,
  isValidMercadoLibreImage,
  normalizePrice,
  validateMercadoLibreUrl,
} from './mercadolibre-playwright.mjs';

class MockLocator {
  constructor(page, selector) {
    this.page = page;
    this.selector = selector;
  }

  first() { return this; }

  async count() {
    return Object.hasOwn(this.page.nodes, this.selector) ? 1 : 0;
  }

  locator(child) {
    return new MockLocator(this.page, `${this.selector} ${child}`);
  }

  async textContent() {
    return this.page.nodes[this.selector]?.text ?? null;
  }

  async getAttribute(name) {
    return this.page.nodes[this.selector]?.attrs?.[name] ?? null;
  }

  async evaluate() {
    return this.page.nodes[this.selector]?.currentSrc ?? '';
  }

  async waitFor() {
    if ((await this.count()) === 0) throw new Error('not found');
  }
}

class MockPage {
  constructor(nodes, currentUrl = 'https://www.mercadolibre.com.ar/p/MLA24365049') {
    this.nodes = nodes;
    this.currentUrl = currentUrl;
  }

  locator(selector) {
    if (selector.includes(', ')) {
      const firstExisting = selector.split(', ').find((part) => Object.hasOwn(this.nodes, part));
      return new MockLocator(this, firstExisting || selector);
    }
    return new MockLocator(this, selector);
  }

  url() { return this.currentUrl; }
}

test('acepta una URL real de Mercado Libre Argentina', () => {
  const url = validateMercadoLibreUrl('https://www.mercadolibre.com.ar/p/MLA24365049?pdp_filters=item_id:MLA1598228317');
  assert.equal(url.hostname, 'www.mercadolibre.com.ar');
});

test('normaliza precio argentino con punto de miles', () => {
  assert.equal(normalizePrice('$ 189.999'), 189999);
});

test('rechaza logos como foto de producto', () => {
  assert.equal(isValidMercadoLibreImage('https://http2.mlstatic.com/frontend-assets/logo__large.png'), false);
  assert.equal(isValidMercadoLibreImage('https://http2.mlstatic.com/D_NQ_NP_123456-MLA99999999999_122026-O.webp'), true);
});

test('extrae titulo, precio actual e imagen principal con los locators reutilizables', async () => {
  const titleSelector = MERCADOLIBRE_LOCATORS.title[0];
  const priceSelector = MERCADOLIBRE_LOCATORS.price[0];
  const imageSelector = MERCADOLIBRE_LOCATORS.image[0];

  const page = new MockPage({
    body: { text: 'Ficha normal del producto' },
    [titleSelector]: { text: 'Zapatillas De Senderismo Terrex Skychaser Ax5' },
    [priceSelector]: { text: '$ 189.999' },
    [`${priceSelector} .andes-money-amount__fraction`]: { text: '189.999' },
    [imageSelector]: {
      currentSrc: 'https://http2.mlstatic.com/D_NQ_NP_123456-MLA99999999999_122026-O.webp',
    },
  });

  const product = await extractProductFromPage(page);

  assert.equal(product.title, 'Zapatillas De Senderismo Terrex Skychaser Ax5');
  assert.equal(product.price, 189999);
  assert.match(product.image, /mlstatic\.com/);
  assert.equal(product.method, 'playwright-dom');
});

test('prioriza el precio actual de second-line sobre otros montos', async () => {
  const titleSelector = MERCADOLIBRE_LOCATORS.title[0];
  const priceSelector = MERCADOLIBRE_LOCATORS.price[0];
  const imageSelector = MERCADOLIBRE_LOCATORS.image[0];

  const page = new MockPage({
    body: { text: 'Ficha normal del producto' },
    [titleSelector]: { text: 'Bolso Irimo' },
    '#price .andes-money-amount': { text: '$ 250.000' },
    [priceSelector]: { text: '$ 64.908' },
    [`${priceSelector} .andes-money-amount__fraction`]: { text: '64.908' },
    [imageSelector]: {
      currentSrc: 'https://http2.mlstatic.com/D_NQ_NP_654321-MLA99999999999_122026-O.webp',
    },
  });

  const product = await extractProductFromPage(page);
  assert.equal(product.price, 64908);
});

test('rechaza una pagina de verificacion', async () => {
  const page = new MockPage({
    body: { text: 'Verificá que sos humano para continuar' },
  }, 'https://www.mercadolibre.com.ar/gz/account-verification');

  await assert.rejects(() => extractProductFromPage(page), /verificación|bloqueo/i);
});
