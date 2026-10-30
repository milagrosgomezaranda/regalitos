
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT = 10000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return (
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168
        ) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    );
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('::ffff:')
    );
  }

  return true;
}

async function validateHost(url) {
  const host = url.hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('La dirección no es válida para importar.');
  }

  if (net.isIP(host)) {
    if (isPrivateIP(host)) {
      throw new Error('No se permiten direcciones IP privadas.');
    }
    return;
  }

  const addresses = await lookup(host, { all: true });

  if (!addresses.length || addresses.some((a) => isPrivateIP(a.address))) {
    throw new Error('El dominio no apunta a una dirección pública válida.');
  }
}

async function downloadPage(input) {
  let current = new URL(input);

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    if (current.protocol !== 'https:') {
      throw new Error('La tienda redirigió a una dirección no segura.');
    }

    await validateHost(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    let response;

    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; RegalitosProductImporter/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.7',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');

      if (!location) {
        throw new Error('Redirección sin destino.');
      }

      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new Error(`La tienda respondió HTTP ${response.status}.`);
    }

    const type = response.headers.get('content-type') || '';

    if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
      throw new Error('El enlace no devolvió una página HTML de producto.');
    }

    const declaredLength = Number(response.headers.get('content-length'));

    if (declaredLength > MAX_BYTES) {
      throw new Error('La página supera el tamaño permitido.');
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;

      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error('La página supera el tamaño permitido.');
      }

      chunks.push(value);
    }

    const html = new TextDecoder().decode(
      Buffer.concat(chunks)
    );

    return { html, finalUrl: current.toString() };
  }

  throw new Error('La tienda realizó demasiadas redirecciones.');
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .trim();
}

function getMeta(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};

    for (const match of tag.matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
    )) {
      attrs[match[1].toLowerCase()] =
        match[2] ?? match[3] ?? match[4] ?? '';
    }

    const names = [
      attrs.property,
      attrs.name,
      attrs.itemprop,
    ].map((v) => String(v || '').toLowerCase());

    if (names.includes(key.toLowerCase()) && attrs.content) {
      return decodeHtml(attrs.content);
    }
  }

  return null;
}

function parsePrice(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string') return null;

  let text = value.replace(/[^\d.,]/g, '');
  if (!text) return null;

  if (text.includes(',')) {
    text = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  }

  const price = Number(text);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function validImage(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(
      value.replace(/\\u002F/g, '/').replace(/\\\//g, '/'),
      baseUrl
    );

    if (url.protocol !== 'https:') return null;

    if (
      /logo|favicon|sprite|placeholder|avatar|banner/i.test(
        url.pathname
      )
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function walkJson(value, callback, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 20) return;

  callback(value);

  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, callback, depth + 1);
  } else {
    for (const item of Object.values(value)) {
      walkJson(item, callback, depth + 1);
    }
  }
}

function extractJsonLd(html, baseUrl) {
  const result = { title: null, price: null, image: null };

  const scripts = html.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  for (const script of scripts) {
    const body = script
      .replace(/^<script\b[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();

    try {
      const json = JSON.parse(body);

      walkJson(json, (node) => {
        const types = Array.isArray(node['@type'])
          ? node['@type']
          : [node['@type']];

        if (!types.some((type) =>
          /product/i.test(String(type || ''))
        )) return;

        result.title ||= node.name || node.headline || null;

        const offers = Array.isArray(node.offers)
          ? node.offers
          : [node.offers];

        for (const offer of offers) {
          result.price ||= parsePrice(
            offer?.price ?? offer?.lowPrice
          );
        }

        const images = Array.isArray(node.image)
          ? node.image
          : [node.image];

        for (const image of images) {
          const candidate =
            typeof image === 'string'
              ? image
              : image?.url || image?.contentUrl;

          result.image ||= validImage(candidate, baseUrl);
        }
      });
    } catch {
      // Ignorar bloques JSON-LD inválidos.
    }
  }

  return result;
}

export function extractGenericProduct(html, baseUrl) {
  const json = extractJsonLd(html, baseUrl);

  const title =
    json.title ||
    getMeta(html, 'og:title') ||
    getMeta(html, 'twitter:title') ||
    html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ||
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, '')
      .trim() ||
    null;

  const image =
    validImage(getMeta(html, 'og:image'), baseUrl) ||
    validImage(getMeta(html, 'twitter:image'), baseUrl) ||
    validImage(getMeta(html, 'image'), baseUrl) ||
    json.image;

  const price =
    parsePrice(getMeta(html, 'product:price:amount')) ||
    parsePrice(getMeta(html, 'og:price:amount')) ||
    parsePrice(getMeta(html, 'product:price')) ||
    json.price;

  const cleanTitle = title
    ? decodeHtml(title.replace(/\s+/g, ' ')).trim()
    : null;

  const validTitle =
    cleanTitle && cleanTitle.length >= 4 &&
    !/404|access denied|captcha|verificaci[oó]n/i.test(cleanTitle)
      ? cleanTitle
      : null;

  return {
    title: validTitle,
    price: price || null,
    image: image || null,
  };
}

export async function importGenericProduct(input) {
  const { html, finalUrl } = await downloadPage(input);

  if (
    /captcha|verify you are human|access denied|checking your browser/i
      .test(html.slice(0, 80000))
  ) {
    throw new Error(
      'La tienda bloqueó la lectura automática. Podés completar los datos manualmente.'
    );
  }

  const product = extractGenericProduct(html, finalUrl);

  const missing = [
    !product.title && 'title',
    !product.price && 'price',
    !product.image && 'image',
  ].filter(Boolean);

  if (!product.title && !product.image && !product.price) {
    const error = new Error(
      'La tienda no publicó datos de producto accesibles automáticamente.'
    );
    error.missing = ['title', 'price', 'image'];
    throw error;
  }

  return {
    ...product,
    missing,
    method: 'html-metadata',
  };
}
