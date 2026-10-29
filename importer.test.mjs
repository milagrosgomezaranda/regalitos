import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMercadoLibreIds,
  normalizeMercadoLibreUrl,
  extractProductFromHtml,
  isValidProductImage,
  looksBlocked,
  importMercadoLibreProduct,
  extractProductFromMarkdown,
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



test('prioriza los datos visibles de la PDP: titulo, precio actual e imagen principal', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Titulo viejo de metadata | Mercado Libre">
    <meta property="og:image" content="https://http2.mlstatic.com/D_NQ_NP_999-MLA999_012026-O.webp">
    <script type="application/ld+json">{"@type":"Product","name":"Titulo JSON viejo","image":["https://http2.mlstatic.com/D_NQ_NP_999-MLA999_012026-O.webp"],"offers":{"@type":"Offer","price":"99999"}}</script>
  </head><body>
    <h1 class="ui-pdp-title">Producto visible real</h1>
    <div class="ui-pdp-price__original-value"><span class="andes-money-amount--previous"><span class="andes-money-amount__fraction">250.000</span></span></div>
    <div class="ui-pdp-price__second-line"><span class="andes-money-amount"><span class="andes-money-amount__fraction">189.999</span></span></div>
    <figure class="ui-pdp-gallery__figure"><img class="ui-pdp-image" src="https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp"></figure>
  </body></html>`;

  assert.deepEqual(extractProductFromHtml(html), {
    title: 'Producto visible real',
    price: 189999,
    image: 'https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp',
  });
});

test('extrae del markdown renderizado titulo, precio actual e imagen mlstatic', () => {
  const markdown = `Title: Producto visible real | Mercado Libre\nURL Source: https://www.mercadolibre.com.ar/p/MLA123\n\n~~$250.000~~\n\n$189.999\n\n6 cuotas de $31.666\n\n![Producto](https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp)`;
  assert.deepEqual(extractProductFromMarkdown(markdown), {
    title: 'Producto visible real',
    price: 189999,
    image: 'https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp',
  });
});

test('prioriza Jina Reader renderizado y no llama a la API /items con OAuth', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: { get: () => 'text/plain' },
      text: async () => `Title: Bolso Irimo visible | Mercado Libre\n\n$64.908\n\n![Bolso](https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp)`,
    };
  };

  const product = await importMercadoLibreProduct(irimo, { fetchImpl });
  assert.deepEqual(product, {
    title: 'Bolso Irimo visible',
    price: 64908,
    image: 'https://http2.mlstatic.com/D_NQ_NP_123-MLA123_012026-O.webp',
    method: 'jina-reader',
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/r\.jina\.ai\/https:\/\/www\.mercadolibre\.com\.ar\//);
  assert.doesNotMatch(calls[0], /api\.mercadolibre\.com\/items/);
});

test('si Jina falla, usa HTML directo como fallback', async () => {
  let count = 0;
  const fetchImpl = async (url) => {
    count += 1;
    if (String(url).startsWith('https://r.jina.ai/')) {
      return {
        ok: false, status: 503, url: String(url),
        headers: { get: () => 'text/plain' },
        text: async () => 'unavailable',
      };
    }
    return {
      ok: true, status: 200, url: String(url),
      headers: { get: () => 'text/html' },
      text: async () => `<!doctype html><h1 class="ui-pdp-title">Producto fallback</h1><div class="ui-pdp-price__second-line"><span class="andes-money-amount__fraction">120.000</span></div><figure class="ui-pdp-gallery__figure"><img class="ui-pdp-image" src="https://http2.mlstatic.com/D_NQ_NP_456-MLA456_012026-O.webp"></figure>`,
    };
  };

  const product = await importMercadoLibreProduct(irimo, { fetchImpl });
  assert.equal(product.title, 'Producto fallback');
  assert.equal(product.price, 120000);
  assert.match(product.image, /mlstatic\.com/);
  assert.equal(product.method, 'direct-html');
  assert.ok(count >= 2);
});
