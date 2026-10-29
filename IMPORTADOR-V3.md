# Importador Mercado Libre v3

Cambio puntual para Regalitos.

Qué obtiene de la ficha visible de Mercado Libre:
- `title`: título visible (`ui-pdp-title`)
- `price`: precio actual visible (`ui-pdp-price__second-line`), ignorando el precio anterior tachado y cuotas
- `image`: primera imagen principal de la galería (`ui-pdp-gallery__figure` / `ui-pdp-image`) y sólo si es una imagen real de `mlstatic.com`

Orden de extracción:
1. Jina Reader renderizado (`https://r.jina.ai/<URL>`) sin API key, con navegador y espera de `.ui-pdp-title`.
2. HTML directo de Mercado Libre.
3. `cors.tools/proxy`.
4. `cors.tools/read?render=true`.

Se eliminó como estrategia principal `/items/{id}` porque la documentación actual de Mercado Libre requiere Authorization Bearer para ese recurso.

Validación local:
- `node --test importer.test.mjs`: 10/10 PASS
- `node --check api/product.js`: PASS
- `node --check src/main.js`: PASS
- `node --check mercadolibre-importer.mjs`: PASS

El build Vite no se ejecutó en este runtime porque no hay `node_modules` y el entorno no resuelve DNS externo. Vercel instalará las dependencias al desplegar.
