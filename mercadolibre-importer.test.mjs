import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMercadoLibreIds,
  normalizeMercadoLibreUrl,
  extractProductFromHtml,
  isValidProductImage,
  looksBlocked,
  importMercadoLibreProduct,
} from './mercadolibre-importer.mjs';

const URL_1 = 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=x#origin=share&sid=share&wid=MLA1598228317&action=copy';
const URL_2 = 'https://www.mercadolibre.com.ar/zapatillas/adidas/up/MLAU3674909961?pdp_filters=item_id%3AMLA2675701986&applied_product_filters=MLAU3683124066';

const PRODUCT_HTML = `
<html><head><meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_999-product.webp"></head>
<body>
  <h1 class="ui-pdp-title">Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm</h1>
  <div id="price">
    <span class="andes-money-amount ui-pdp-price__original-value"><span class="andes-money-amount__fraction">181.999</span></span>
    <div class="ui-pdp-price__second-line"><span class="andes-money-amount"><span class="andes-money-amount__fraction">110.579</span><span class="andes-money-amount__cents">03</span></span></div>
  </div>
  <figure class="ui-pdp-gallery__figure"><img class="ui-pdp-image ui-pdp-gallery__figure__image" src="https://http2.mlstatic.com/D_NQ_NP_951732-MLA99939891445_112025-F.webp" srcset="https://http2.mlstatic.com/D_NQ_NP_951732-MLA99939891445_112025-F.webp 500w, https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp 1000w"></figure>
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

test('extrae título, precio actual e imagen principal del HTML renderizado', () => {
  const product = extractProductFromHtml(PRODUCT_HTML);
  assert.equal(product.title, 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm');
  assert.equal(product.price, 110579.03);
  assert.equal(product.image, 'https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp');
});

test('rechaza logo como imagen de producto', () => {
  assert.equal(isValidProductImage('https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/6.6.92/mercadolibre/logo__large.png'), false);
  assert.equal(isValidProductImage('https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA123456789-F.webp'), true);
});

test('detecta páginas de verificación', () => {
  assert.equal(looksBlocked('<title>Account verification</title>', 'https://www.mercadolibre.com.ar/gz/account-verification'), true);
});

test('usa Browserless /unblock con proxy residencial AR y devuelve producto', async () => {
  let capturedUrl = '';
  let capturedBody = null;
  const fakeFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: PRODUCT_HTML }),
    };
  };

  const product = await importMercadoLibreProduct(URL_1, {
    fetchImpl: fakeFetch,
    browserlessToken: 'test-token',
    browserlessBaseUrl: 'https://browserless.test',
    timeoutMs: 1000,
  });

  const requestUrl = new URL(capturedUrl);
  assert.equal(requestUrl.pathname, '/unblock');
  assert.equal(requestUrl.searchParams.get('token'), 'test-token');
  assert.equal(requestUrl.searchParams.get('proxy'), 'residential');
  assert.equal(requestUrl.searchParams.get('proxyCountry'), 'ar');
  assert.equal(capturedBody.content, true);
  assert.equal(capturedBody.waitForSelector.selector, 'h1.ui-pdp-title');
  assert.equal(product.title, 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm');
  assert.equal(product.price, 110579.03);
  assert.match(product.image, /mlstatic\.com/);
  assert.equal(product.method, 'browserless-unblock-residential-ar');
});

test('falla de forma explícita si falta BROWSERLESS_TOKEN', async () => {
  await assert.rejects(
    () => importMercadoLibreProduct(URL_1, { fetchImpl: async () => { throw new Error('no debería llamar fetch'); }, browserlessToken: '' }),
    /BROWSERLESS_TOKEN/,
  );
});
