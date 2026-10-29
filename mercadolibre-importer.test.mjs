import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMercadoLibreIds,
  normalizeMercadoLibreUrl,
  isValidProductImage,
  importMercadoLibreProduct,
} from './mercadolibre-importer.mjs';

const URL_1 = 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=x#origin=share&sid=share&wid=MLA1598228317&action=copy';
const URL_2 = 'https://www.mercadolibre.com.ar/zapatillas/adidas/up/MLAU3674909961?pdp_filters=item_id%3AMLA2675701986&applied_product_filters=MLAU3683124066';

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
  assert.equal(isValidProductImage('https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/6.6.92/mercadolibre/logo__large.png'), false);
  assert.equal(isValidProductImage('https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA123456789-F.webp'), true);
});

test('usa Browserless /function con proxy residencial AR y devuelve producto completo', async () => {
  let capturedUrl = '';
  let capturedBody = null;
  const fakeFetch = async (url, options) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: {
          title: 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm',
          price: 110579.03,
          image: 'https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp',
          debug: { priceCandidates: [] },
        },
      }),
    };
  };

  const product = await importMercadoLibreProduct(URL_1, {
    fetchImpl: fakeFetch,
    browserlessToken: 'test-token',
    browserlessBaseUrl: 'https://browserless.test',
    timeoutMs: 1000,
  });

  const requestUrl = new URL(capturedUrl);
  assert.equal(requestUrl.pathname, '/function');
  assert.equal(requestUrl.searchParams.get('token'), 'test-token');
  assert.equal(requestUrl.searchParams.get('proxy'), 'residential');
  assert.equal(requestUrl.searchParams.get('proxyCountry'), 'ar');
  assert.equal(requestUrl.searchParams.get('proxySticky'), 'true');
  assert.match(capturedBody.code, /ui-pdp-price__second-line/);
  assert.equal(capturedBody.context.url.includes('mercadolibre.com.ar'), true);
  assert.equal(product.title, 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm');
  assert.equal(product.price, 110579.03);
  assert.match(product.image, /mlstatic\.com/);
  assert.deepEqual(product.missing, []);
  assert.equal(product.method, 'browserless-function-residential-ar');
});

test('devuelve resultado parcial en vez de descartar título e imagen si falta precio', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      data: {
        title: 'Producto real',
        price: null,
        image: 'https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA123456789-F.webp',
        debug: { priceCandidates: [] },
      },
    }),
  });

  const product = await importMercadoLibreProduct(URL_1, {
    fetchImpl: fakeFetch,
    browserlessToken: 'test-token',
    browserlessBaseUrl: 'https://browserless.test',
    timeoutMs: 1000,
  });

  assert.equal(product.title, 'Producto real');
  assert.equal(product.price, null);
  assert.match(product.image, /mlstatic\.com/);
  assert.deepEqual(product.missing, ['price']);
});

test('falla de forma explícita si falta BROWSERLESS_TOKEN', async () => {
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
