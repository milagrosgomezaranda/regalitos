# Validación final

Esta versión elimina los endpoints y fallbacks anteriores para evitar rutas duplicadas y esperas encadenadas.

Estructura usada por el importador:

- `api/product.js`: único endpoint serverless.
- `mercadolibre-playwright.mjs`: locators y extracción reutilizable.
- `src/main.js`: llama solamente a `/api/product` y aborta a los 22 segundos.

El endpoint devuelve siempre uno de estos estados:

- HTTP 200 + `ok: true` con `title`, `price`, `image`.
- HTTP 4xx/5xx + `ok: false`, `error`, `stage` y `elapsedMs`.

No se considera éxito una página de verificación/CAPTCHA, un título genérico, una imagen que no sea de `mlstatic.com` o una respuesta incompleta.
