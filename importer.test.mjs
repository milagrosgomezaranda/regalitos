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

const irimo = 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=5PF0k8YicT0vdd8UstmNrSMZpIf3q2zzhbnr9O9SvE9PmF8#origin=share&sid=share&wid=MLA1598228317&action=copy';
const secondProduct = 'https://www.mercadolibre.com.ar/p/MLA78853394?matt_tool=89488245&pdp_filters=item_id:MLA2060802049&ua=ck5Fa9611MR9NEYBUiNtlTFkYzxxL5mTdmwhHzBjkckP_tY#origin=share&sid=share&wid=MLA2060802049&action=copy';

test('extrae item y catálogo de Bolso Irimo, incluyendo wid en fragmento', () => {
  const ids = extractMercadoLibreIds(irimo);
  assert.equal(ids.itemId, 'MLA1598228317');
  assert.equal(ids.catalogId, 'MLA24365049');
  assert.deepEqual(ids.itemIds, ['MLA1598228317']);
});

test('extrae item y catalogo del segundo link compartido', () => {
  const ids = extractMercadoLibreIds(secondProduct);
  assert.equal(ids.itemId, 'MLA2060802049');
  assert.equal(ids.catalogId, 'MLA78853394');
});

test('normaliza tracking y conserva item_id', () => {
  const url = normalizeMercadoLibreUrl(irimo);
  assert.match(url, /pdp_filters=item_id%3AMLA1598228317/);
  assert.doesNotMatch(url, /matt_tool|ua=|#|wid=/);
});

test('extrae OG/JSON-LD y exige imagen real de mlstatic', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Producto de prueba | Mercado Libre">
    <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp">
    <script type="application/ld+json">{"@type":"Product","name":"Producto de prueba","image":["https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp"],"offers":{"@type":"Offer","price":"189999"}}</script>
  </head><body></body></html>`;
  assert.deepEqual(extractProductFromHtml(html), {
    title: 'Producto de prueba',
    price: 189999,
    image: 'https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp',
  });
});

test('rechaza logo de Mercado Libre como imagen', () => {
  assert.equal(isValidProductImage('https://http2.mlstatic.com/frontend-assets/logo__large.png'), false);
});

test('rechaza verification/challenge', () => {
  assert.equal(looksBlocked('<html>Verify you are human - captcha</html>'), true);
  assert.throws(() => extractProductFromHtml('<html>Verify you are human - captcha</html>'));
});


test('prioriza la API publica del item sin OAuth y devuelve title, price e image', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        id: 'MLA1598228317',
        title: 'Bolso Irimo de prueba',
        price: 64908,
        pictures: [
          { secure_url: 'https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp' },
        ],
      }),
    };
  };

  const product = await importMercadoLibreProduct(irimo, { fetchImpl });
  assert.deepEqual(product, {
    title: 'Bolso Irimo de prueba',
    price: 64908,
    image: 'https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp',
    method: 'public-item-api',
  });
  assert.deepEqual(calls, ['https://api.mercadolibre.com/items/MLA1598228317']);
});

test('si la API publica falla, conserva los fallbacks existentes', async () => {
  let count = 0;
  const fetchImpl = async (url) => {
    count += 1;
    if (String(url).startsWith('https://api.mercadolibre.com/items/')) {
      return {
        ok: false, status: 401, url: String(url),
        headers: { get: () => 'application/json' },
        text: async () => '{"message":"unauthorized"}',
      };
    }
    return {
      ok: true, status: 200, url: String(url),
      headers: { get: () => 'text/html' },
      text: async () => `<!doctype html><meta property="og:title" content="Producto fallback | Mercado Libre"><meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_456-MLA456_012026-O.webp"><script type="application/ld+json">{"@type":"Product","name":"Producto fallback","image":["https://http2.mlstatic.com/D_NQ_NP_456-MLA456_012026-O.webp"],"offers":{"@type":"Offer","price":"120000"}}</script>`,
    };
  };

  const product = await importMercadoLibreProduct(irimo, { fetchImpl });
  assert.equal(product.title, 'Producto fallback');
  assert.equal(product.price, 120000);
  assert.match(product.image, /mlstatic\.com/);
  assert.ok(count >= 2);
});
