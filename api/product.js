
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

function getMeta(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
      new RegExp(
        `<meta\\b(?=[^>]*(?:property|name)=["']${escaped}["'])(?=[^>]*content=["']([^"']*)["'])[^>]*>`,
        "i"
      ),
      new RegExp(
        `<meta\\b(?=[^>]*content=["']([^"']*)["'])(?=[^>]*(?:property|name)=["']${escaped}["'])[^>]*>`,
        "i"
      )
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return clean(match[1]);
    }
  }

  return "";
}

function getJsonLdProduct(html) {
  const scripts =
    html.match(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || [];

  for (const script of scripts) {
    try {
      const raw = script
        .replace(/^.*?>/s, "")
        .replace(/<\/script>\s*$/i, "");

      const parsed = JSON.parse(raw);
      const items = [];

      function collect(value) {
        if (!value) return;

        if (Array.isArray(value)) {
          value.forEach(collect);
          return;
        }

        if (typeof value !== "object") return;

        items.push(value);

        if (value["@graph"]) collect(value["@graph"]);
        if (value.mainEntity) collect(value.mainEntity);
      }

      collect(parsed);

      for (const item of items) {
        const types = Array.isArray(item["@type"])
          ? item["@type"]
          : [item["@type"]];

        if (!types.includes("Product")) continue;

        const offer = Array.isArray(item.offers)
          ? item.offers[0]
          : item.offers;

        const image = Array.isArray(item.image)
          ? item.image[0]
          : item.image;

        return {
          title: clean(item.name),
          image:
            typeof image === "string"
              ? image
              : image?.url || image?.contentUrl || "",
          price: offer?.price ?? offer?.lowPrice ?? null
        };
      }
    } catch {
      // Ignorar datos estructurados inválidos.
    }
  }

  return {};
}

function safeImage(value, baseUrl) {
  if (!value) return "";

  try {
    const imageUrl = new URL(value, baseUrl);

    return imageUrl.protocol === "https:"
      ? imageUrl.toString()
      : "";
  } catch {
    return "";
  }
}

function getMercadoLibreItemId(url) {
  // Los enlaces compartidos pueden contener el ID en los parámetros.
  for (const key of ["item_id", "wid"]) {
    const value = url.searchParams.get(key);

    if (/^MLA\d+$/i.test(value || "")) {
      return value.toUpperCase();
    }
  }

  // Enlaces directos de publicaciones.
  const directMatch = url.pathname.match(
    /(?:^|\/)(MLA\d+)(?:[-/]|$)/i
  );

  if (directMatch) {
    return directMatch[1].toUpperCase();
  }

  return null;
}

function isMercadoLibreHost(host) {
  return (
    /(^|\.)mercadolibre\.com\.ar$/i.test(host) ||
    /(^|\.)mercadolibre\.com$/i.test(host) ||
    /(^|\.)mercadolibre\.[a-z.]+$/i.test(host)
  );
}

async function getMercadoLibreProduct(url) {
  const itemId = getMercadoLibreItemId(url);

  if (!itemId) return null;

  const response = await fetch(
    `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(7000)
    }
  );

  if (!response.ok) return null;

  const item = await response.json();

  const title = clean(item.title);
  const image = safeImage(
    item.secure_thumbnail ||
      item.thumbnail ||
      item.pictures?.[0]?.secure_url ||
      item.pictures?.[0]?.url,
    url.toString()
  );

  const price =
    typeof item.price === "number" && Number.isFinite(item.price)
      ? item.price
      : null;

  if (!title && !image && price === null) return null;

  return { title, image, price };
}

function parsePrice(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value).replace(/[^\d.,-]/g, "");

  if (!cleaned) return null;

  // Interpretar formatos habituales:
  // 1234.56, 1.234,56 y 1234,56.
  let normalized = cleaned;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }

  const number = Number(normalized);

  return Number.isFinite(number) ? number : null;
}

function validatePublicUrl(url) {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;

  const host = url.hostname.toLowerCase();

  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }

  return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Método no permitido."
    });
  }

  const rawUrl = Array.isArray(req.query?.url)
    ? req.query.url[0]
    : req.query?.url;

  if (!rawUrl || typeof rawUrl !== "string") {
    return res.status(400).json({
      error: "Falta el enlace del producto."
    });
  }

  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    return res.status(400).json({
      error: "El enlace no parece válido."
    });
  }

  if (!validatePublicUrl(url)) {
    return res.status(400).json({
      error: "Solo se aceptan enlaces HTTPS públicos."
    });
  }

  try {
    // Primero, usar la API pública para artículos de Mercado Libre.
    if (isMercadoLibreHost(url.hostname)) {
      try {
        const product = await getMercadoLibreProduct(url);

        if (product) {
          return res.status(200).json(product);
        }
      } catch {
        // Si falla la API, intentar leer los metadatos de la página.
      }
    }

    // Fallback genérico para tiendas que permitan consultar su HTML.
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; Regalitos/1.0)",
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(9000)
    });

    if (!response.ok) {
      return res.status(422).json({
        error: "La tienda no permitió leer la página."
      });
    }

    const finalUrl = new URL(response.url || url.toString());

    if (!validatePublicUrl(finalUrl)) {
      return res.status(422).json({
        error: "La tienda redirigió a un enlace no permitido."
      });
    }

    const html = (await response.text()).slice(0, 1500000);
    const structured = getJsonLdProduct(html);

    const title =
      getMeta(html, ["og:title", "twitter:title"]) ||
      structured.title ||
      clean(
        (
          html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""
        ).replace(/<[^>]+>/g, "")
      );

    const image = safeImage(
      getMeta(html, [
        "og:image",
        "twitter:image",
        "twitter:image:src"
      ]) || structured.image,
      finalUrl.toString()
    );

    const priceRaw =
      getMeta(html, [
        "product:price:amount",
        "og:price:amount",
        "product:price"
      ]) || structured.price;

    const price = parsePrice(priceRaw);

    return res.status(200).json({
      title,
      image,
      price
    });
  } catch {
    return res.status(422).json({
      error:
        "No se pudo acceder a esa tienda. Probá con otra URL o cargá los datos manualmente."
    });
  }
}
