# Regalitos

Aplicación Vite + Supabase con importador de productos de Mercado Libre.

## Importador Mercado Libre

`GET /api/product?url=<URL>` usa Browserless con `BROWSERLESS_TOKEN` configurado en Vercel.

Flujo actual:

1. Normaliza la URL y recupera `item_id` / catálogo.
2. Browserless `/unblock` abre Mercado Libre con proxy residencial de Argentina.
3. No espera un selector rígido.
4. Extrae:
   - título desde DOM / JSON-LD / Open Graph;
   - precio actual desde `meta[itemprop="price"]` dentro del bloque `#price`, luego fallbacks;
   - imagen desde la galería principal / Open Graph / JSON-LD.
5. Si consigue solo parte de los datos, el frontend completa lo válido en vez de descartar todo.

## Vercel

- Framework Preset: Vite
- Output Directory: dist
- Variable de entorno requerida: `BROWSERLESS_TOKEN`

## Validación

```bash
npm test
npm run build
```
