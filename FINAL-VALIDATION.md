# Validación

- `api/product.js`: único endpoint del importador.
- `mercadolibre-importer.mjs`: extracción de IDs, HTML visible, Open Graph/JSON-LD y lectores renderizados.
- Sin Playwright, Chromium, Gemini, OAuth ni API keys.
- Jina Reader y cors.tools se ejecutan en paralelo para reducir tiempo de espera.
- Se prioriza el precio actual visible y se descarta el precio anterior tachado.
- La imagen debe ser una URL `mlstatic.com` y no un logo.
- Las páginas de verificación/CAPTCHA se rechazan.
- Tests locales: 8/8 PASS.
- Sintaxis de API, frontend e importador: OK.

La validación live contra Mercado Libre debe completarse desde el deployment de Vercel, porque este runtime de trabajo no permite navegar hacia esas fichas reales.
