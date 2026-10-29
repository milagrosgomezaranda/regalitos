
const ALLOWED_PROTOCOLS = new Set(["https:"]);

function clean(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function safeImage(value, baseUrl) {
  if (!value || typeof value !== "string") return "";
  try {
    const u = new URL(value, baseUrl);
    return u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

function parsePrice(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const s = String(value).replace(/[^\d.,-]/g, "");
  if (!s) return null;

  let n = s;
  if (s.includes(",") && s.includes(".")) {
    n = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    n = s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    n = s.replace(/\./g, "");
  }

  const result = Number(n);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function getMeta(html, keys) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const key of keys) {
    for (const tag of tags) {
      const name = tag.match(
        /\b(?:property|name|itemprop)=["']([^"']+)["']/i
      )?.[1];
      const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];

      if (name?.toLowerCase() === key.toLowerCase() && content) {
        return clean(content);
      }
    }
  }
  return "";
}

function getMercadoLibreIds(url) {
  const items = [];
  const catalogs = [];

  const addItem = value => {
    if (/^MLA\d+$/i.test(value || "")) {
      const id = value.toUpperCase();
      if (!items.includes(id)) items.push(id);
    }
  };

  const addCatalog = value => {
    if (/^MLA\d+$/i.test(value || "")) {
      const id = value.toUpperCase();
      if (!catalogs.includes(id)) catalogs.push(id);
    }
  };

  const filters = url.searchParams.get("pdp_filters") || "";
  const match = filters.match(/item_id\s*:\s*(MLA\d+)/i);
  if (match) addItem(match[1]);

  addItem(url.searchParams.get("item_id"));
  addItem(url.searchParams.get("wid"));

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  addItem(fragment.get("wid"));
  addItem(fragment.get("item_id"));

  const catalogMatch = url.pathname.match(/\/p\/(MLA\d+)/i);
  if (catalogMatch) addCatalog(catalogMatch[1]);

  const directMatch = url.pathname.match(/\/(MLA-?\d+)(?:-|\/|$)/i);
  if (directMatch) addItem(directMatch[1].replace("-", ""));

  return { items, catalogs };
}

function isMercadoLibreHost(host) {
  return /(^|\.)mercadolibre\.[a-z.]+$/i.test(host);
}

/*
 * Busca el precio dentro de la sección "Mejor precio".
 * No utiliza el primer precio global de la página, porque puede ser
 * el precio en cuotas o el de una tienda distinta.
 *
 * Si no puede identificar un precio en esa sección, devuelve null
 * y permite que continúe la extracción habitual.
 */
function getBestPriceFromSection(html) {
  const decoded = clean(
    html
      .replace(/\\u0024/gi, "$")
      .replace(/\\u003c/gi, "<")
      .replace(/\\u003e/gi, ">")
      .replace(/\\n/g, " ")
      .replace(/\\t/g, " ")
  );

  const text = decoded
    .replace(/<sup[^>]*>(\d{2})<\/sup>/gi, ",$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");

  const marker = /mejor\s+precio/i;
  let searchFrom = 0;

  while (searchFrom < text.length) {
    const match = marker.exec(text.slice(searchFrom));
    if (!match) break;

    const start = searchFrom + match.index + match[0].length;
    const section = text.slice(start, start + 900);

    // La sección puede incluir el precio anterior tachado y el vigente.
    const prices = [
      ...section.matchAll(
        /\$\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)/g
      )
    ]
      .map(m => parsePrice(m[1]))
      .filter(n => n !== null);

    if (prices.length) {
      // El precio vigente suele ser menor que el precio tachado.
      // Solo lo usamos si hay una diferencia entre precios visibles.
      const unique = [...new Set(prices)];
      if (unique.length > 1) return Math.min(...unique);
      return unique[0];
    }

    searchFrom = start;
  }

  return null;
}

function extractEmbeddedData(html, baseUrl) {
  const scripts = html.match(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  const best = { title: "", image: "", price: null };

  function inspect(value, depth = 0) {
    if (!value || depth > 12) return;

    if (Array.isArray(value)) {
      for (const item of value) inspect(item, depth + 1);
      return;
    }

    if (typeof value !== "object") return;

    const title = clean(
      value.title || value.name || value.productTitle || ""
    );

    const picture =
      value.secure_thumbnail ||
      value.thumbnail ||
      value.picture ||
      value.image ||
      value.secure_url ||
      value.url;

    const image = typeof picture === "string"
      ? safeImage(picture, baseUrl)
      : safeImage(picture?.url || picture?.secure_url, baseUrl);

    const price = parsePrice(
      value.price ??
      value.amount ??
      value.sale_price ??
      value.current_price
    );

    if (title.length > best.title.length) best.title = title;
    if (!best.image && image) best.image = image;
    if (best.price === null && price !== null) best.price = price;

    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object") {
        inspect(child, depth + 1);
      } else if (
        typeof child === "string" &&
        child.length > 20 &&
        /state|product|data/i.test(key)
      ) {
        try {
          inspect(JSON.parse(child), depth + 1);
        } catch {
          // El valor no era JSON.
        }
      }
    }
  }

  for (const script of scripts) {
    const raw = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    if (!raw || raw.length > 5000000) continue;

    try {
      inspect(JSON.parse(raw));
    } catch {
      // Algunos scripts contienen JavaScript.
    }
  }

  return best;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(6000)
  });

  if (!response.ok) return null;
  return response.json();
}

async function getApiProduct(url) {
  const { items, catalogs } = getMercadoLibreIds(url);

  for (const id of items) {
    try {
      const item = await fetchJson(
        `https://api.mercadolibre.com/items/${id}`
      );
      if (!item) continue;

      const result = {
        title: clean(item.title),
        image: safeImage(
          item.secure_thumbnail ||
          item.thumbnail ||
          item.pictures?.[0]?.secure_url ||
          item.pictures?.[0]?.url,
          url.href
        ),
        price: parsePrice(item.price)
      };

      if (result.title || result.image || result.price !== null) {
        return result;
      }
    } catch {
      // Continuar con la página pública.
    }
  }

  for (const id of catalogs) {
    try {
      const product = await fetchJson(
        `https://api.mercadolibre.com/products/${id}`
      );
      if (!product) continue;

      const result = {
        title: clean(product.name || product.title),
        image: safeImage(
          product.pictures?.[0]?.url ||
          product.main_picture?.url,
          url.href
        ),
        price: null
      };

      if (result.title || result.image) return result;
    } catch {
      // Continuar con la página pública.
    }
  }

  return null;
}

function validateUrl(url) {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;

  const host = url.hostname.toLowerCase();

  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) return false;

  return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=60");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  const rawUrl = Array.isArray(req.query?.url)
    ? req.query.url[0]
    : req.query?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).json({ error: "Falta el enlace del producto." });
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: "El enlace no parece válido." });
  }

  if (!validateUrl(url)) {
    return res.status(400).json({ error: "El enlace no es válido." });
  }

  try {
    if (isMercadoLibreHost(url.hostname)) {
      const apiProduct = await getApiProduct(url).catch(() => null);

      // Mantener el método actual cuando la API entrega los tres datos.
      if (
        apiProduct?.title &&
        apiProduct?.image &&
        apiProduct.price !== null
      ) {
        return res.status(200).json(apiProduct);
      }
    }

    const response = await fetch(url.href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml,application/json",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.8"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      return res.status(422).json({
        error: "Mercado Libre no permitió leer la página desde el servidor."
      });
    }

    const finalUrl = new URL(response.url || url.href);
    if (!validateUrl(finalUrl)) {
      return res.status(422).json({
        error: "La página redirigió a una dirección no permitida."
      });
    }

    const html = (await response.text()).slice(0, 5000000);
    const embedded = extractEmbeddedData(html, finalUrl.href);

    const metaTitle = getMeta(html, ["og:title", "twitter:title"]);
    const pageTitle = clean(
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.replace(/<[^>]+>/g, "") || ""
    );

    let title = metaTitle || embedded.title || pageTitle;

    // No aceptar el nombre genérico de la tienda como producto.
    if (/^mercado libre(?:\s*[-|].*)?$/i.test(title)) title = "";

    const image = safeImage(
      getMeta(html, [
        "og:image",
        "og:image:url",
        "twitter:image",
        "twitter:image:src"
      ]) || embedded.image,
      finalUrl.href
    );

    // Prioridad: precio visible en "Mejor precio", después metadatos,
    // y finalmente el precio estructurado que ya se utilizaba.
    const selectedPrice = getBestPriceFromSection(html);

    const metaPrice = parsePrice(
      getMeta(html, [
        "product:price:amount",
        "og:price:amount",
        "product:price"
      ])
    );

    const price =
      selectedPrice ??
      metaPrice ??
      embedded.price;

    if (!title && !image && price === null) {
      return res.status(422).json({
        error:
          "Mercado Libre no entregó datos legibles al servidor. No se pudo completar la importación."
      });
    }

    return res.status(200).json({ title, image, price });
  } catch {
    return res.status(422).json({
      error: "No pudimos leer los datos automáticamente. Probá de nuevo."
    });
  }
}
