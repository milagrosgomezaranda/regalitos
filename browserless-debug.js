import {
  normalizeMercadoLibreUrl,
  extractMercadoLibreIds,
  extractProductFromHtml,
  looksBlocked,
} from '../mercadolibre-importer.mjs';

const BROWSERLESS_BASE = 'https://production-sfo.browserless.io/stealth/bql';

function safeMessage(error) {
  return String(error?.message || error || 'Error desconocido')
    .replace(/token=[^&\s]+/gi, 'token=[REDACTED]')
    .slice(0, 1000);
}

function compactText(value, max = 1600) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function htmlSignals(html) {
  const source = String(html || '');
  const lower = source.toLowerCase();
  return {
    hasPdpTitleClass: lower.includes('ui-pdp-title'),
    hasPriceId: /id=["']price["']/i.test(source),
    hasMoneyFraction: lower.includes('andes-money-amount__fraction'),
    hasItempropPrice: /itemprop=["']price["']/i.test(source),
    hasPdpImage: lower.includes('ui-pdp-image'),
    hasOgTitle: /property=["']og:title["']/i.test(source),
    hasOgImage: /property=["']og:image["']/i.test(source),
    hasJsonLd: /application\/ld\+json/i.test(source),
  };
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    return res.status(500).json({ ok: false, stage: 'config', error: 'Falta BROWSERLESS_TOKEN.' });
  }

  const rawUrl = Array.isArray(req.query?.url) ? req.query.url[0] : req.query?.url;
  if (!rawUrl) {
    return res.status(400).json({ ok: false, stage: 'input', error: 'Falta ?url=' });
  }

  let normalized;
  let ids;
  try {
    normalized = normalizeMercadoLibreUrl(rawUrl);
    ids = extractMercadoLibreIds(rawUrl);
  } catch (error) {
    return res.status(400).json({ ok: false, stage: 'input', error: safeMessage(error) });
  }

  const query = `
    mutation DiagnoseMercadoLibre($url: String!) {
      goto(url: $url, waitUntil: domContentLoaded) {
        status
        time
        url
        text
      }
      pause: waitForTimeout(time: 2500) {
        time
      }
      pageHtml: html {
        html
      }
      bodyText: text(selector: "body", timeout: 3000) {
        text
      }
    }
  `;

  const endpoint = new URL(BROWSERLESS_BASE);
  endpoint.searchParams.set('token', token);
  endpoint.searchParams.set('timeout', '45000');
  endpoint.searchParams.set('proxy', 'residential');
  endpoint.searchParams.set('proxyCountry', 'ar');
  endpoint.searchParams.set('proxySticky', 'true');

  const startedAt = Date.now();
  let response;
  let payload;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { url: normalized },
        operationName: 'DiagnoseMercadoLibre',
      }),
      signal: AbortSignal.timeout(50000),
    });

    const raw = await response.text();
    try {
      payload = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        ok: false,
        stage: 'browserql-json',
        browserlessStatus: response.status,
        body: compactText(raw),
        elapsedMs: Date.now() - startedAt,
      });
    }
  } catch (error) {
    return res.status(502).json({
      ok: false,
      stage: 'browserql-fetch',
      error: safeMessage(error),
      elapsedMs: Date.now() - startedAt,
    });
  }

  const html = payload?.data?.pageHtml?.html || '';
  const bodyText = payload?.data?.bodyText?.text || '';
  const goto = payload?.data?.goto || null;
  let parsed = null;
  let parseError = null;

  if (html) {
    try {
      parsed = extractProductFromHtml(html, goto?.url || normalized);
    } catch (error) {
      parseError = safeMessage(error);
    }
  }

  return res.status(response.ok ? 200 : 502).json({
    ok: response.ok,
    browserlessStatus: response.status,
    elapsedMs: Date.now() - startedAt,
    requestedUrl: normalized,
    ids,
    goto,
    graphqlErrors: Array.isArray(payload?.errors)
      ? payload.errors.map((e) => ({ message: safeMessage(e), path: e?.path || null }))
      : [],
    htmlLength: html.length,
    signals: htmlSignals(html),
    blocked: looksBlocked(`${html}\n${bodyText}`, goto?.url || ''),
    bodyPreview: compactText(bodyText),
    parsed,
    parseError,
  });
}
