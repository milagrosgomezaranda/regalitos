# Importador Mercado Libre - fix 2

Cambios:
- Prioriza el recurso de item usando el item_id extraido del link compartido.
- No envia OAuth, API key ni credenciales.
- Conserva los fallbacks existentes: HTML directo, cors.tools/proxy y cors.tools/read.
- Rechaza imagenes que no sean de mlstatic o que parezcan logo/branding.
- Mantiene la respuesta compatible: title, price, image.
- Agrega method solo como diagnostico no disruptivo.

IDs verificados por parsing:
- MLA24365049 -> item MLA1598228317
- MLA78853394 -> item MLA2060802049

Validacion local:
- node --check mercadolibre-importer.mjs: OK
- node --check api/product.js: OK
- node --test importer.test.mjs: 8/8 PASS

Limitacion del entorno de ChatGPT:
- El runtime no resuelve DNS externo, por lo que no se pudo ejecutar aqui la llamada live a api.mercadolibre.com ni a la Vercel desplegada.
- La verificacion E2E final debe hacerse despues del deploy en Vercel con los dos links reales.
