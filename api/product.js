
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

        if (!types.some(type => String(type).toLowerCase() === "product")) {
          continue;
        }

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

function isValidMLAId(value) {
  return /^MLA\d+$/i.test(String(value || ""));
}

// Obtiene el ID de la publicación, que es el que necesitamos
// para recuperar el precio y las fotos de esa oferta concreta.
function getMercadoLibreIds(url) {
  const itemCandidates = [];
  const catalogCandidates = [];

  function addItem(value) {
    if (isValidMLAId(value)) {
      const id = value.toUpperCase();
      if (!itemCandidates.includes(id)) itemCandidates.push(id);
    }
  }

  function addCatalog(value) {
    if (isValidMLAId(value)) {
      const id = value.toUpperCase();
      if (!catalogCandidates.includes(id)) {
        catalogCandidates.push(id);
      }
    }
  }

  // Enlaces del tipo ?pdp_filters=item_id:MLA123456789
  const pdpFilters = url.searchParams.get("pdp_filters") || "";

  const itemFromFilter = pdpFilters.match(
    /(?:^|[,:;])\s*item_id\s*:\s*(MLA\d+)/i
  );

  if (itemFromFilter) addItem(itemFromFilter[1]);

  // Parámetros normales de la URL.
  addItem(url.searchParams.get("item_id"));
  addItem(url.searchParams.get("wid"));

  // Mercado Libre suele poner wid dentro del fragmento (#...).
  // Los fragmentos no se envían al servidor, así que hay que leerlos
  // explícitamente desde la URL recibida.
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));

  addItem(fragment.get("wid"));
  addItem(fragment.get("item_id"));

  // URL de publicación directa, por ejemplo:
  // /MLA123456789-producto...
  const directPath = url.pathname.match(
    /\/(MLA\d+)(?:-|\/|$)/i
  );

  // En una ruta /p/MLA... el código es del catálogo, no de la publicación.
  const catalogPath = url.pathname.match(
    /\/p\/(MLA\d+)(?:\/|$)/i
  );

  if (catalogPath) {
    addCatalog(catalogPath[1]);
  } else if (directPath) {
    addItem(directPath[1]);
  }

  return {
    itemIds: itemCandidates,
    catalogIds: catalogCandidates
  };
}

function isMercadoLibreHost(host) {
  return (
    /(^|\.)mercadolibre\.com\.ar$/i.test(host) ||
    /(^|\.)mercadolibre\.com$/i.test(host) ||
    /(^|\.)mercadolibre\.[a-z.]+$/i.test(host)
  );
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

function normalizeItem(item, baseUrl) {
  if (!item || typeof item !== "object") return null;

  const title = clean(item.title || item.name);

  const image = safeImage(
    item.secure_thumbnail ||
      item.thumbnail ||
      item.pictures?.[0]?.secure_url ||
      item.pictures?.[0]?.url ||
      item.pictures?.[0],
    baseUrl
  );

  const price = parsePrice(item.price);

  if (!title && !image && price === null) return null;

  return { title, image, price };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(7000)
  });

  if (!response.ok) return null;

  return response.json();
}

async function getMercadoLibreProduct(url) {
  const { itemIds, catalogIds } = getMercadoLibreIds(url);

  // Primero probamos la publicación específica.
  // Así el precio corresponde a esa oferta y no a otra del catálogo.
  for (const itemId of itemIds) {
    try {
      const item = await fetchJson(
        `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`
      );

      const product = normalizeItem(item, url.toString());

      if (product) return product;
    } catch {
      // Intentar el siguiente identificador o método.
    }
  }

  // Si no pudimos obtener la publicación, intentamos el catálogo.
  // Puede aportar nombre e imagen, pero no necesariamente el precio
  // actual de la oferta elegida.
  for (const catalogId of catalogIds) {
    try {
      const catalog = await fetchJson(
        `https://api.mercadolibre.com/products/${encodeURIComponent(catalogId)}`
      );

      if (!catalog) continue;

      const title = clean(catalog.name || catalog.title);

      const image = safeImage(
        catalog.pictures?.[0]?.url ||
          catalog.pictures?.[0]?.secure_url ||
          catalog.main_picture?.url ||
          catalog.thumbnail,
        url.toString()
      );

      if (title || image) {
        return {
          title,
          image,
          // No inventar el precio: el del catálogo no garantiza
          // que coincida con el de la publicación elegida.
          price: null
        };
      }
    } catch {
      // Continuar con la lectura de la página.
    }
  }

  return null;
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
  res.setHeader(
    "Cache-Control",
    "s-maxage=300, stale-while-revalidate=600"
  );

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
    if (isMercadoLibreHost(url.hostname)) {
      try {
        const product = await getMercadoLibreProduct(url);

        if (product) {
          return res.status(200).json(product);
        }
      } catch {
        // Intentar obtener los datos desde el HTML de la página.
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Regalitos/1.0)",
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
        "No se pudieron obtener los datos automáticamente. Probá de nuevo o cargalos manualmente."
    });
  }
}
