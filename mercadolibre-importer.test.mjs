import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMercadoLibreIds,
  normalizeMercadoLibreUrl,
  isValidProductImage,
  extractProductFromHtml,
  importMercadoLibreProduct,
} from './mercadolibre-importer.mjs';

const URL_1 = 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=x#origin=share&sid=share&wid=MLA1598228317&action=copy';
const URL_2 = 'https://www.mercadolibre.com.ar/zapatillas/adidas/up/MLAU3674909961?pdp_filters=item_id%3AMLA2675701986&applied_product_filters=MLAU3683124066';
const IMAGE = 'https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp';

const REALISTIC_HTML = `<!doctype html><html><head>
<meta property="og:title" content="Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm">
<meta property="og:image" content="${IMAGE}">
</head><body>
<h1 class="ui-pdp-title">Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm</h1>
<div id="price" class="ui-pdp-container__row ui-pdp-container__row--price">
  <div class="ui-pdp-price__original-value"><span class="andes-money-amount__fraction">181.999</span></div>
  <div class="ui-pdp-price__second-line">
    <span class="andes-money-amount ui-pdp-price__part" itemProp="offers" itemscope>
      <span class="andes-visually-hidden">110579 pesos con 03 centavos</span>
      <meta itemProp="price" content="110579.03"/>
      <span class="andes-money-amount__fraction">110.579</span>
      <span class="andes-money-amount__cents">03</span>
    </span>
  </div>
</div>
<figure class="ui-pdp-gallery__figure"><img class="ui-pdp-image" src="${IMAGE}"></figure>
</body></html>`;

test('extrae publicación y catálogo del bolso', () => {
  const ids = extractMercadoLibreIds(URL_1);
  assert.equal(ids.itemId, 'MLA1598228317');
  assert.equal(ids.catalogId, 'MLA24365049');
});

test('extrae publicación y user product de /up/', () => {
  const ids = extractMercadoLibreIds(URL_2);
  assert.equal(ids.itemId, 'MLA2675701986');
  assert.equal(ids.catalogId, 'MLAU3674909961');
});

test('mueve wid del fragmento a pdp_filters y elimina tracking', () => {
  const input = 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=1#wid=MLA1598228317&action=copy';
  const normalized = new URL(normalizeMercadoLibreUrl(input));
  assert.equal(normalized.searchParams.get('pdp_filters'), 'item_id:MLA1598228317');
  assert.equal(normalized.searchParams.has('matt_tool'), false);
  assert.equal(normalized.hash, '');
});

test('rechaza logo como imagen de producto', () => {
  assert.equal(isValidProductImage('https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/logo__large.png'), false);
  assert.equal(isValidProductImage(IMAGE), true);
});

test('extrae título, precio actual e imagen del DOM realista y no el precio tachado', () => {
  const product = extractProductFromHtml(REALISTIC_HTML, URL_1);
  assert.equal(product.title, 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm');
  assert.equal(product.price, 110579.03);
  assert.equal(product.image, IMAGE);
  assert.deepEqual(product.missing, []);
});

test('si no hay h1 usa Open Graph + meta itemprop price + og:image', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Producto desde Open Graph">
    <meta property="og:image" content="${IMAGE}">
  </head><body>
    <div id="price"><div class="ui-pdp-price__second-line"><meta itemprop="price" content="62066"></div></div>
  </body></html>`;
  const product = extractProductFromHtml(html, URL_1);
  assert.equal(product.title, 'Producto desde Open Graph');
  assert.equal(product.price, 62066);
  assert.equal(product.image, IMAGE);
});

test('usa JSON-LD Product como fallback completo', () => {
  const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product', name: 'Producto JSON-LD', image: IMAGE,
    offers: { '@type': 'Offer', price: '99999.50', priceCurrency: 'ARS' },
  })}</script></head><body></body></html>`;
  const product = extractProductFromHtml(html, URL_1);
  assert.equal(product.title, 'Producto JSON-LD');
  assert.equal(product.price, 99999.5);
  assert.equal(product.image, IMAGE);
});

test('Browserless usa /chromium/unblock v2 con body oficial y navegador CDP remoto', async () => {
  let capturedUrl = '';
  let capturedBody = null;
  let capturedWs = '';
  const fakeFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: REALISTIC_HTML,
        browserWSEndpoint: 'wss://browserless.test/devtools/browser/abc',
      }),
    };
  };

  const fakePage = {
    url: () => 'https://www.mercadolibre.com.ar/p/MLA24365049',
    waitForTimeout: async () => {},
    evaluate: async () => ({
      title: 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm',
      price: 110579.03,
      image: IMAGE,
      url: 'https://www.mercadolibre.com.ar/p/MLA24365049',
      documentTitle: 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm',
    }),
  };
  const fakeBrowser = {
    contexts: () => [{ pages: () => [fakePage] }],
    close: async () => {},
  };

  const product = await importMercadoLibreProduct(URL_1, {
    fetchImpl: fakeFetch,
    connectBrowser: async (ws) => { capturedWs = ws; return fakeBrowser; },
    browserlessToken: 'test-token',
    browserlessBaseUrl: 'https://browserless.test',
    timeoutMs: 10000,
  });

  const requestUrl = new URL(capturedUrl);
  assert.equal(requestUrl.pathname, '/chromium/unblock');
  assert.equal(requestUrl.searchParams.get('token'), 'test-token');
  assert.equal(requestUrl.searchParams.get('proxy'), 'residential');
  assert.equal(requestUrl.searchParams.get('proxyCountry'), 'ar');
  assert.equal(requestUrl.searchParams.get('proxySticky'), 'true');
  assert.equal(requestUrl.searchParams.get('timeout'), '10000');
  assert.deepEqual(Object.keys(capturedBody).sort(), ['browserWSEndpoint', 'content', 'cookies', 'screenshot', 'ttl', 'url'].sort());
  assert.equal(capturedBody.content, true);
  assert.equal(capturedBody.browserWSEndpoint, true);
  assert.match(capturedWs, /token=test-token/);
  assert.equal(product.price, 110579.03);
  assert.equal(product.method, 'browserless-unblock+remote-dom');
});

test('devuelve resultado parcial si Browserless trae solo título e imagen', async () => {
  const partial = `<html><head><meta property="og:title" content="Producto real"><meta property="og:image" content="${IMAGE}"></head><body></body></html>`;
  const fakeFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ content: partial }) });
  const product = await importMercadoLibreProduct(URL_1, {
    fetchImpl: fakeFetch,
    browserlessToken: 'test-token',
    browserlessBaseUrl: 'https://browserless.test',
    timeoutMs: 10000,
  });
  assert.equal(product.title, 'Producto real');
  assert.equal(product.price, null);
  assert.equal(product.image, IMAGE);
  assert.deepEqual(product.missing, ['price']);
});

test('falla explícitamente si falta BROWSERLESS_TOKEN', async () => {
  const original = process.env.BROWSERLESS_TOKEN;
  delete process.env.BROWSERLESS_TOKEN;
  try {
    await assert.rejects(
      () => importMercadoLibreProduct(URL_1, { fetchImpl: async () => { throw new Error('no debería llamar fetch'); }, browserlessToken: '' }),
      /BROWSERLESS_TOKEN/,
    );
  } finally {
    if (original === undefined) delete process.env.BROWSERLESS_TOKEN;
    else process.env.BROWSERLESS_TOKEN = original;
  }
});
