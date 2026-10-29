# Regalitos

Versión consolidada del proyecto con importación liviana de productos de Mercado Libre.

## Importador de producto

El frontend llama a un único endpoint:

`GET /api/product?url=<URL_MERCADOLIBRE>`

El backend no levanta Chromium ni usa API keys. Prueba en paralelo:

1. Jina Reader con renderizado de navegador.
2. `cors.tools/read?render=true`.
3. HTML directo.

Si los tres fallan, usa `cors.tools/proxy` como último fallback.

Solo devuelve éxito cuando obtiene los tres datos requeridos:

- `title`
- `price`
- `image`

La imagen debe pertenecer a `mlstatic.com` y no puede ser un logo. Las páginas de verificación/CAPTCHA se rechazan.

## Vercel

Mantener:

- Framework Preset: `Vite`
- Output Directory: `dist`

No requiere variables de entorno nuevas para el importador.

Las variables existentes de Supabase se mantienen:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Comandos

```bash
npm install
npm test
npm run build
```
