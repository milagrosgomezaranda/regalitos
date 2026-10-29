
const clean = (v) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";

const first = (...values) =>
  values.find((v) => v !== null && v !== undefined && v !== "");

function getMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const name = tag.match(/\b(?:property|name|itemprop)=["']([^"']+)["']/i)?.[1];
    if (name?.toLowerCase() !== key.toLowerCase()) continue;

    const content = tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) return clean(content.replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
  }

  return null;
}

function parsePrice(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[^\d.,]/g, "").trim();
    if (!normalized) return null;

    // Formatos argentinos: 62.066,35 o 62066,35
    if (normalized.includes(",")) {
      const n = Number(normalized.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) && n > 0 ? n : null;
    }

    // Evita interpretar separadores de miles como decimales.
    const n = Number(normalized.replace(/,/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  return null;
}

function getIds(url) {
  const ids = {
    item: null,
    product: null,
  };

  try {
    const u = new URL(url);
    ids.item =
      u.searchParams.get("wid") ||
      u.searchParams.get("item_id") ||
      u.searchParams.get("pdp_filters")?.match(/item_id:(MLA\d+)/)?.[1] ||
      u.hash.match(/wid=(MLA\d+)/)?.[1] ||
      u.pathname.match(/MLA\d{6,}/)?.[0] ||
      null;

    ids.product = u.pathname.match(/\/p\/(MLA\d+)/)?.[1] || null;
  } catch {}

  return ids;
}

function walk(value, callback, depth = 0) {
  if (!value || typeof value !== "object" || depth > 18) return;

  callback(value);

  if (Array.isArray(value)) {
    for (const item of value) walk(item, callback, depth + 1);
  } else {
    for (const item of Object.values(value)) {
      walk(item, callback, depth + 1);
    }
  }
}

function extractJson(html) {
  const results = [];
  const scripts = html.match(
    /<script\b[^>]*type=["']application\/(?:ld\+json|json)["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  for (const script of scripts) {
    const body = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "");
    try {
      results.push(JSON.parse(body));
    } catch {}
  }

  // Mercado Libre también puede incluir estado de la aplicación
  // en scripts sin type="application/json".
  const statePatterns = [
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});\s*(?:<\/script>|$)/,
    /window\.MELI\s*=\s*({[\s\S]*?});\s*(?:<\/script>|$)/,
  ];

  for (const pattern of statePatterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        results.push(JSON.parse(match[1]));
      } catch {}
    }
  }

  return results;
}

function extract(html, url) {
  const ids = getIds(url);
  const roots = extractJson(html);

  let winnerPrice = null;
  let matchingItemPrice = null;
  let jsonTitle = null;
  let jsonImage = null;

  for (const root of roots) {
    walk(root, (obj) => {
      const winner = obj.buy_box_winner;

      if (winner && typeof winner === "object") {
        const winnerId = winner.item_id || winner.id;
        const price = parsePrice(winner.price);

        if (
          price &&
          (!ids.item || !winnerId || winnerId === ids.item)
        ) {
          winnerPrice = price;
        }
      }

      if (ids.item && obj.id === ids.item) {
        matchingItemPrice = first(
          parsePrice(obj.price),
          parsePrice(obj.amount)
        );
      }

      if (!jsonTitle) {
        const type = obj["@type"];
        if (
          type === "Product" ||
          (Array.isArray(type) && type.includes("Product"))
        ) {
          jsonTitle = clean(obj.name);
          const image = obj.image;
          jsonImage = Array.isArray(image) ? image[0] : image;
          jsonImage = typeof jsonImage === "object"
            ? jsonImage?.url
            : jsonImage;
        }
      }
    });
  }

  const title = first(
    jsonTitle,
    getMeta(html, "og:title"),
    getMeta(html, "twitter:title")
  );

  const image = first(
    jsonImage,
    getMeta(html, "og:image"),
    getMeta(html, "twitter:image")
  );

  // No usar cuotas ni recorrer números arbitrarios del HTML.
  const price = first(
    winnerPrice,
    matchingItemPrice,
    parsePrice(getMeta(html, "product:price:amount")),
    parsePrice(getMeta(html, "og:price:amount"))
  );

  return {
    title: title || null,
    image: image || null,
    price: price ?? null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const url = req.query?.url;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Falta la URL del producto" });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: "URL inválida" });
  }

  if (
    parsed.protocol !== "https:" ||
    !["mercadolibre.com.ar", "www.mercadolibre.com.ar"].includes(parsed.hostname)
  ) {
    return res.status(400).json({ error: "Solo se admiten enlaces de Mercado Libre Argentina" });
  }

  try {
    const response = await fetch(parsed.href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "es-AR,es;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(200).json({
        title: null,
        image: null,
        price: null,
        warning: `Mercado Libre respondió HTTP ${response.status}.`,
      });
    }

    const html = await response.text();
    const product = extract(html, parsed.href);

    return res.status(200).json({
      ...product,
      warning:
        !product.title || !product.image || product.price == null
          ? "Mercado Libre no expuso todos los datos. Completá los campos faltantes manualmente."
          : null,
    });
  } catch {
    return res.status(200).json({
      title: null,
      image: null,
      price: null,
      warning: "No se pudo leer el producto. Completá los campos manualmente.",
    });
  }
}
