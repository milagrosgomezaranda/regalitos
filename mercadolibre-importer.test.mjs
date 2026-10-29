import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMercadoLibreIds,
  importMercadoLibreProduct,
} from './mercadolibre-importer.mjs';

const URL_WITH_ITEM = 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=x#origin=share&sid=share&wid=MLA1598228317&action=copy';
const URL_CATALOG_ONLY = 'https://www.mercadolibre.com.ar/p/MLA24365049';
const IMAGE = 'https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp';

function response({ ok = true, status = 200, body = {} }) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

test('extrae productId e itemId de un link de catálogo', () => {
  const ids = extractMercadoLibreIds(URL_WITH_ITEM);
  assert.equal(ids.productId, 'MLA24365049');
  assert.equal(ids.itemId, 'MLA1598228317');
});

test('rechaza dominios que no son Mercado Libre Argentina', () => {
  assert.throws(
    () => extractMercadoLibreIds('https://example.com/p/MLA24365049'),
    /no pertenece a Mercado Libre Argentina/i,
  );
});

test('usa la API oficial de catálogo para nombre, foto y precio exacto del item', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/products/MLA24365049')) {
      return response({
        body: {
          name: 'Bolso porta-herramientas Irimo',
          pictures: [{ secure_url: IMAGE }],
        },
      });
    }
    if (String(url).endsWith('/products/MLA24365049/items')) {
      return response({
        body: {
          results: [
            { item_id: 'MLA9999999999', price: 64908, currency_id: 'ARS' },
            { item_id: 'MLA1598228317', price: 62066.35, currency_id: 'ARS' },
          ],
        },
      });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const product = await importMercadoLibreProduct(URL_WITH_ITEM, {
    token: 'test-token',
    fetchImpl: fakeFetch,
  });

  assert.equal(product.title, 'Bolso porta-herramientas Irimo');
  assert.equal(product.image, IMAGE);
  assert.equal(product.price, 62066.35);
  assert.equal(product.itemId, 'MLA1598228317');
  assert.equal(product.productId, 'MLA24365049');
  assert.equal(product.partial, false);
  assert.equal(calls.length, 2);
  assert.equal(calls.some((url) => url.includes('/items/MLA1598228317')), false);
  assert.equal(calls.some((url) => url.includes('/sale_price')), false);
});

test('si falla precio conserva nombre y foto como respuesta parcial', async () => {
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/products/MLA24365049')) {
      return response({
        body: {
          name: 'Bolso porta-herramientas Irimo',
          pictures: [{ secure_url: IMAGE }],
        },
      });
    }
    if (String(url).endsWith('/products/MLA24365049/items')) {
      return response({ ok: false, status: 403, body: { message: 'Forbidden' } });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const product = await importMercadoLibreProduct(URL_WITH_ITEM, {
    token: 'test-token',
    fetchImpl: fakeFetch,
  });

  assert.equal(product.title, 'Bolso porta-herramientas Irimo');
  assert.equal(product.image, IMAGE);
  assert.equal(product.price, null);
  assert.equal(product.partial, true);
  assert.equal(product.fields.price, 'unavailable');
  assert.equal(product.warnings[0].status, 403);
});

test('si el link no trae itemId toma una publicación disponible del catálogo', async () => {
  const fakeFetch = async (url) => {
    if (String(url).endsWith('/products/MLA24365049')) {
      return response({ body: { name: 'Bolso', pictures: [{ secure_url: IMAGE }] } });
    }
    if (String(url).endsWith('/products/MLA24365049/items')) {
      return response({
        body: {
          results: [
            { item_id: 'MLA2000000001', price: 70000, currency_id: 'ARS' },
            { item_id: 'MLA2000000002', price: 65000, currency_id: 'ARS' },
          ],
        },
      });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const product = await importMercadoLibreProduct(URL_CATALOG_ONLY, {
    token: 'test-token',
    fetchImpl: fakeFetch,
  });

  assert.equal(product.itemId, 'MLA2000000002');
  assert.equal(product.price, 65000);
  assert.ok(product.warnings.some((warning) => warning.code === 'CATALOG_ITEM_SELECTED'));
});

test('rechaza links directos sin productId porque /items de terceros está bloqueado', async () => {
  await assert.rejects(
    () => importMercadoLibreProduct('https://articulo.mercadolibre.com.ar/MLA-1598228317-producto-_JM', {
      token: 'test-token',
      fetchImpl: async () => { throw new Error('no debería llamar API'); },
    }),
    /productId de catálogo/i,
  );
});
