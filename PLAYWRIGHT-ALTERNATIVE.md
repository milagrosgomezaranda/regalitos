# Importador Mercado Libre con Playwright

La app intenta primero `GET /api/product-playwright?url=...`.

Ese endpoint abre la ficha real con Chromium serverless y Playwright y lee locators reutilizables:

- Titulo: `h1.ui-pdp-title` (con fallbacks)
- Precio actual: `#price .ui-pdp-price__second-line .andes-money-amount` (con fallbacks)
- Imagen principal: `figure.ui-pdp-gallery__figure img.ui-pdp-image` (con fallbacks)

Si Playwright falla, el frontend llama automaticamente al endpoint anterior `/api/product` como respaldo.

No requiere API keys ni OAuth.

## Vercel

Mantener:
- Framework Preset: Vite
- Output Directory: dist
- Node.js: 22.x (tambien definido en package.json)

El primer request puede tardar mas porque Chromium se descomprime en `/tmp`.
