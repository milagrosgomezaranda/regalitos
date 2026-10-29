
const clean = (value) =>
  typeof value === "string"
    ? value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim()
    : value;

function getMeta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
      attrs[match[1].toLowerCase()] = match[2];
    }

    if (
      [attrs.property, attrs.name, attrs.itemprop]
        .some((value) => value?.toLowerCase() === key.toLowerCase())
    ) {
      if (attrs.content) return clean(attrs.content);
    }
  }

  return null;
}

function parsePrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  const text = value.replace(/[^\d.,]/g, "");
  if (!text) return null;

  let normalized;

  if (text.includes(",")) {
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if ((text.match(/\./g) || []).length > 1) {
    normalized = text.replace(/\./g, "");
  } else if (/\.\d{3}$/.test(text)) {
    normalized = text.replace(/\./g, "");
  } else {
    normalized = text;
  }

  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function getIds(url) {
  const ids = { item: null, product: null };

  try {
    const parsed = new URL(url);
    const filters = parsed.searchParams.get("pdp_filters") || "";
    const filterItem = filters.match(/item_id:(MLA\d+)/i);

    ids.item =
      parsed.searchParams.get("wid") ||
      parsed.searchParams.get("item_id") ||
      filterItem?.[1] ||
      parsed.hash.match(/wid=(MLA\d+)/i)?.[1] ||
      null;

    ids.product =
      parsed.pathname.match(/\/p\/(MLA\d+)/i)?.[1] ||
      parsed.pathname.match(/\/up\/(MLA\w+)/i)?.[1] ||
      null;
  } catch {}

  return ids;
}

function extractJson(html) {
  const results = [];
  const scripts =
    html.match(
      /<script\b[^>]*type=["']application\/(?:ld\+json|json)["'][^>]*>[\s\S]*?<\/script>/gi
    ) || [];

  for (const script of scripts) {
    const body = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "");

    try {
      results.push(JSON.parse(body));
    } catch {}
  }

  return results;
}

function walk(value, callback, depth = 0) {
  if (!value || typeof value !== "object" || depth > 20) return;

  callback(value);

  if (Array.isArray(value)) {
    for (const child of value) walk(child, callback, depth + 1);
  } else {
    for (const child of Object.values(value)) {
      walk(child, callback, depth + 1);
    }
  }
}

function extract(html, url) {
  const ids = getIds(url);
  const roots = extractJson(html);

  let title = null;
  let image = null;
  let winnerPrice = null;
  let itemPrice = null;

  for (const root of roots) {
    walk(root, (obj) => {
      const type = obj["@type"];
      const isProduct =
        type === "Product" ||
        (Array.isArray(type) && type.includes("Product"));

      if (isProduct) {
        title ||= clean(obj.name);

        const images = Array.isArray(obj.image) ? obj.image : [obj.image];
        for (const candidate of images) {
          const src =
            typeof candidate === "string"
              ? candidate
              : candidate?.url || candidate?.contentUrl;

          if (src && /^https?:\/\//i.test(src)) {
            image ||= src;
            break;
          }
        }
      }

      const winner = obj.buy_box_winner;

      if (winner && typeof winner === "object") {
        const winnerId = winner.item_id || winner.id;
        const candidate = parsePrice(winner.price);

        if (
          candidate &&
          (!ids.item || !winnerId || winnerId === ids.item)
        ) {
          winnerPrice = candidate;
        }
      }

      if (ids.item && obj.id === ids.item) {
        itemPrice ||= parsePrice(obj.price);
      }
    });
  }

  title ||= getMeta(html, "og:title");
  title ||= getMeta(html, "twitter:title");

  image ||= getMeta(html, "og:image");
  image ||= getMeta(html, "twitter:image");

  // Solo precios explícitos del producto; no cuotas.
  const metaPrice =
    parsePrice(getMeta(html, "product:price:amount")) ??
    parsePrice(getMeta(html, "og:price:amount"));

  return {
    title: title || null,
    image: image || null,
    price: winnerPrice ?? itemPrice ?? metaPrice ?? null,
  };
}

function extractFromReader(text) {
  const result = { title: null, image: null, price: null };

  const title =
    text.match(/^Title:\s*(.+)$/im)?.[1] ||
    text.match(/^#\s+(.+)$/m)?.[1];

  if (title) {
    result.title = clean(title.replace(/\s*\|\s*Mercado Libre.*$/i, ""));
  }

  const image =
    text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ||
    text.match(/!\[[^\]]*\]\((https?:\/\/[^ )]+)\)/)?.[1];

  if (image && /^https?:\/\//i.test(image)) {
    result.image = image;
  }

  // El precio solo se acepta si está cerca de la etiqueta "Mejor precio".
  const label = text.search(/mejor precio/i);

  if (label >= 0) {
    const section = text.slice(label, label + 300);
    const match = section.match(/\$\s*([\d.]+(?:,\d{1,2})?)/);

    if (match) result.price = parsePrice(match[1]);
  }

  return result;
}

function mergeProducts(primary, fallback) {
  return {
    title: primary.title || fallback.title || null,
    image: primary.image || fallback.image || null,
    price: primary.price ?? fallback.price ?? null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const url = req.query?.url;

  if (typeof url !== "string" || !url) {
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
    !["mercadolibre.com.ar", "www.mercadolibre.com.ar"].includes(
      parsed.hostname
    )
  ) {
    return res.status(400).json({
      error: "Solo se admiten enlaces de Mercado Libre Argentina",
    });
  }

  let directProduct = { title: null, image: null, price: null };
  let directError = null;

  // Intento 1: leer la página directamente.
  try {
    const response = await fetch(parsed.href, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "es-AR,es;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (response.ok) {
      const html = await response.text();
      directProduct = extract(html, parsed.href);
    } else {
      directError = `Mercado Libre respondió HTTP ${response.status}`;
    }
  } catch {
    directError = "No se pudo acceder directamente a Mercado Libre";
  }

  // Si faltan datos, intento 2: Jina Reader.
  if (
    !directProduct.title ||
    !directProduct.image ||
    directProduct.price == null
  ) {
    try {
      const readerUrl = "https://r.jina.ai/" + parsed.href;

      const response = await fetch(readerUrl, {
        headers: {
          Accept: "text/plain",
          "X-Respond-With": "markdown",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (response.ok) {
        const text = await response.text();
        const readerProduct = extractFromReader(text);
        directProduct = mergeProducts(directProduct, readerProduct);
      } else if (!directError) {
        directError = `El lector alternativo respondió HTTP ${response.status}`;
      }
    } catch {
      if (!directError) {
        directError = "No se pudo acceder al lector alternativo";
      }
    }
  }

  const complete =
    directProduct.title &&
    directProduct.image &&
    directProduct.price != null;

  return res.status(200).json({
    ...directProduct,
    warning: complete
      ? null
      : "No se pudieron confirmar todos los datos. Revisá los campos antes de guardar.",
    diagnostic: complete ? undefined : directError || "Datos incompletos",
  });
}
