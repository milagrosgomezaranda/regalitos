import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMercadoLibreIds,
  normalizeMercadoLibreUrl,
  extractProductFromHtml,
  extractProductFromMarkdown,
  isValidProductImage,
  looksBlocked,
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

test('extrae título, precio actual e imagen principal del HTML visible', () => {
  const html = `
  <html><head><meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_999-product.webp"></head>
  <body>
    <h1 class="ui-pdp-title">Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm</h1>
    <div id="price">
      <span class="andes-money-amount ui-pdp-price__original-value"><span class="andes-money-amount__fraction">181.999</span></span>
      <div class="ui-pdp-price__second-line"><span class="andes-money-amount"><span class="andes-money-amount__fraction">110.579</span><span class="andes-money-amount__cents">03</span></span></div>
    </div>
    <figure class="ui-pdp-gallery__figure"><img class="ui-pdp-image ui-pdp-gallery__figure__image" src="https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp"></figure>
  </body></html>`;
  const product = extractProductFromHtml(html);
  assert.equal(product.title, 'Taladro 20v 13mm Brushless TOTAL 2000rpm 66nm');
  assert.equal(product.price, 110579.03);
  assert.equal(product.image, 'https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp');
});

test('extrae datos de markdown renderizado', () => {
  const markdown = `Title: Bolso porta-herramientas Irimo\n\n# Bolso porta-herramientas Irimo\n\n~~$ 99.999~~\n\n$ 75.712\n\n![Bolso](https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA123456789-F.webp)`;
  const product = extractProductFromMarkdown(markdown);
  assert.equal(product.title, 'Bolso porta-herramientas Irimo');
  assert.equal(product.price, 75712);
  assert.match(product.image, /mlstatic\.com/);
});

test('rechaza logo como imagen de producto', () => {
  assert.equal(isValidProductImage('https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/6.6.92/mercadolibre/logo__large.png'), false);
  assert.equal(isValidProductImage('https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA123456789-F.webp'), true);
});

test('detecta páginas de verificación', () => {
  assert.equal(looksBlocked('<title>Account verification</title>', 'https://www.mercadolibre.com.ar/gz/account-verification'), true);
});

test('usa el primer lector que devuelve los tres campos válidos', async () => {
  const html = `<h1 class="ui-pdp-title">Producto real</h1><div class="ui-pdp-price__second-line"><span class="andes-money-amount__fraction">12.345</span></div><figure class="ui-pdp-gallery__figure"><img src="https://http2.mlstatic.com/D_NQ_NP_2X_123456-MLA123456789-F.webp"></figure>`;

  const fakeFetch = async (url) => {
    const text = String(url).startsWith('https://r.jina.ai/') ? html : 'captcha';
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => 'text/html' },
      text: async () => text,
    };
  };

  const product = await importMercadoLibreProduct(URL_1, { fetchImpl: fakeFetch, primaryTimeoutMs: 100, fallbackTimeoutMs: 100 });
  assert.equal(product.title, 'Producto real');
  assert.equal(product.price, 12345);
  assert.equal(product.method, 'jina-reader');
});
