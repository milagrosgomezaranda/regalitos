import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMercadoLibreIds,
  normalizeMercadoLibreUrl,
  extractProductFromHtml,
  isValidProductImage,
  looksBlocked,
} from '../mercadolibre-importer.mjs';

const irimo = 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=5PF0k8YicT0vdd8UstmNrSMZpIf3q2zzhbnr9O9SvE9PmF8#origin=share&sid=share&wid=MLA1598228317&action=copy';
const adidas = 'https://www.mercadolibre.com.ar/zapatillas-de-senderismo-terrex-skychaser-ax5-jq2226-adidas/up/MLAU3674909961?product_trigger_id=MLA56797757&attributes=COLOR%3AGris%2CSIZE%3AMLAU3674909961&pdp_filters=item_id%3AMLA2675701986&applied_product_filters=MLAU3683124066&picker=true&quantity=1';

test('extrae item y catálogo de Bolso Irimo, incluyendo wid en fragmento', () => {
  const ids = extractMercadoLibreIds(irimo);
  assert.equal(ids.itemId, 'MLA1598228317');
  assert.equal(ids.catalogId, 'MLA24365049');
  assert.deepEqual(ids.itemIds, ['MLA1598228317']);
});

test('extrae item y User Product de Adidas sin confundir product_trigger_id', () => {
  const ids = extractMercadoLibreIds(adidas);
  assert.equal(ids.itemId, 'MLA2675701986');
  assert.equal(ids.catalogId, 'MLAU3674909961');
  assert.ok(ids.catalogIds.includes('MLAU3683124066'));
  assert.ok(ids.catalogIds.includes('MLA56797757'));
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
