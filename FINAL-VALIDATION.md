# Validación Browserless DOM

- Browserless `/function` ejecuta Puppeteer remoto y extrae directamente del DOM.
- Proxy residencial Argentina + sesión sticky.
- Título: `h1.ui-pdp-title`.
- Precio: prioriza `#price .ui-pdp-price__second-line .andes-money-amount`; excluye precio original/tachado y conserva candidatos de diagnóstico.
- Imagen: prioriza primera imagen principal de la galería y valida dominio `mlstatic.com`.
- El frontend acepta respuestas parciales: si falta un campo, completa los demás.

Validación local:
- `node --check mercadolibre-importer.mjs`: PASS
- `node --check api/product.js`: PASS
- `node --check src/main.js`: PASS
- `node --test mercadolibre-importer.test.mjs`: 7/7 PASS
