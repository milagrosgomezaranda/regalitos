# Regalitos – fix del importador Mercado Libre

Archivos:
- `mercadolibre-importer.mjs`: extracción de IDs + fetch directo/cors.tools + OG/JSON-LD + validación estricta.
- `vercel-handler.mjs`: handler POST que conserva la respuesta `{ title, price, image }`.
- `test/importer.test.mjs`: pruebas de IDs, parsing, rechazo de logo y challenge.
- `live-check.mjs`: prueba los dos enlaces reales; requiere salida HTTPS del runtime.

El importador no devuelve éxito si falta cualquiera de los tres campos o si Mercado Libre responde verification/captcha. Sólo acepta imágenes de `mlstatic.com` que no parezcan logos/navigation assets.
