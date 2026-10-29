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
const IMAGE = 'https://http2.mlstatic.com/D_NQ_NP_2X_951732-MLA99939891445_112025-F.webp';

function response({ ok = true, status = 200, body = {}, text, url }) {
  return {
    ok, status, url,
    json: async () => body,
    text: async () => text ?? JSON.stringify(body),
  };
}

test('extrae publicación y catálogo del bolso', () => {
  const ids = extractMercadoLibreIds(URL_1);
  assert.equal(ids.itemId, 'MLA1598228317');
  assert.equal(ids.catalogId, 'MLA24365049');
});

test('normaliza URL y elimina tracking', () => {
  const normalized = new URL(normalizeMercadoLibreUrl(URL_1));
  assert.equal(normalized.searchParams.get('pdp_filters'), 'item_id:MLA1598228317');
  assert.equal(normalized.searchParams.has('matt_tool'), false);
  assert.equal(normalized.searchParams.has('ua'), false);
  assert.equal(normalized.hash, '');
});

test('acepta foto mlstatic y rechaza logo', () => {
  assert.equal(isValidProductImage(IMAGE), true);
  assert.equal(isValidProductImage('https://http2.mlstatic.com/frontend-assets/ml-web-navigation/ui-navigation/logo__large.png'), false);
});

test('parser HTML obtiene og:title, og:image y precio si están disponibles', () => {
  const html = `<html><head><meta property="og:title" content="Bolso Irimo"><meta property="og:image" content="${IMAGE}"></head><body><div id="price"><meta itemprop="price" content="12345"></div></body></html>`;
  const product = extractProductFromHtml(html, URL_1);
  assert.equal(product.title, 'Bolso Irimo');
  assert.equal(product.price, 12345);
  assert.equal(product.image, IMAGE);
});

test('usa LinkMetadata para nombre y foto sin Browserless', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://www.mercadolibre.com.ar/')) return response({ ok: false, status: 403, text: 'blocked' });
    if (String(url).startsWith('https://api.linkmetadata.com/')) {
      return response({ body: { title: 'Bolso Irimo', image: { url: IMAGE }, og: { 'og:title': 'Bolso Irimo', 'og:image': IMAGE } } });
    }
    throw new Error(`URL inesperada: ${url}`);
  };

  const product = await importMercadoLibreProduct(URL_1, { fetchImpl: fakeFetch });
  assert.equal(product.title, 'Bolso Irimo');
  assert.equal(product.image, IMAGE);
  assert.equal(product.price, null);
  assert.equal(product.method, 'linkmetadata');
  assert.equal(calls.some((u) => u.includes('browserless')), false);
  assert.equal(calls.some((u) => u.startsWith('https://api.microlink.io')), false);
});

test('usa Microlink como fallback si LinkMetadata no trae imagen', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).startsWith('https://www.mercadolibre.com.ar/')) return response({ ok: false, status: 403, text: 'blocked' });
    if (String(url).startsWith('https://api.linkmetadata.com/')) return response({ body: { title: 'Bolso Irimo', image: { url: null } } });
    if (String(url).startsWith('https://api.microlink.io/')) return response({ body: { status: 'success', data: { title: 'Bolso Irimo', image: { url: IMAGE } } } });
    throw new Error(`URL inesperada: ${url}`);
  };

  const product = await importMercadoLibreProduct(URL_1, { fetchImpl: fakeFetch });
  assert.equal(product.title, 'Bolso Irimo');
  assert.equal(product.image, IMAGE);
  assert.equal(product.method, 'metadata+microlink');
  assert.equal(calls.some((u) => u.startsWith('https://api.microlink.io/')), true);
});

test('si la respuesta directa tiene todo, no llama servicios externos', async () => {
  let calls = 0;
  const html = `<html><head><meta property="og:title" content="Bolso Irimo"><meta property="og:image" content="${IMAGE}"></head><body><div id="price"><meta itemprop="price" content="78900"></div></body></html>`;
  const fakeFetch = async () => { calls += 1; return response({ text: html, url: URL_1 }); };
  const product = await importMercadoLibreProduct(URL_1, { fetchImpl: fakeFetch });
  assert.equal(product.title, 'Bolso Irimo');
  assert.equal(product.price, 78900);
  assert.equal(product.image, IMAGE);
  assert.equal(product.method, 'direct-preview');
  assert.equal(calls, 1);
});

test('falla claro si ningún proveedor devuelve foto', async () => {
  const fakeFetch = async (url) => {
    if (String(url).startsWith('https://www.mercadolibre.com.ar/')) return response({ ok: false, status: 403, text: 'blocked' });
    if (String(url).startsWith('https://api.linkmetadata.com/')) return response({ body: { title: 'Solo título', image: { url: null } } });
    if (String(url).startsWith('https://api.microlink.io/')) return response({ body: { status: 'success', data: { title: 'Solo título', image: null } } });
    throw new Error('unexpected');
  };
  await assert.rejects(() => importMercadoLibreProduct(URL_1, { fetchImpl: fakeFetch }), /foto de producto/);
});
