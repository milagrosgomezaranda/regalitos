# Regalitos

Versión del importador de Mercado Libre usando Browserless.

## Importador

`/api/product` envía la URL a Browserless `/unblock`, con navegador real y proxy residencial de Argentina. Browserless devuelve el HTML renderizado y la aplicación extrae:

- `h1.ui-pdp-title` para el título visible.
- `.ui-pdp-price__second-line .andes-money-amount__fraction` + cents para el precio actual.
- la primera `img.ui-pdp-image` de la galería para la foto real de `mlstatic.com`.

No se ejecuta Chromium dentro de Vercel y no se usan Jina Reader, cors.tools ni la API privada de Mercado Libre.

## Variable obligatoria en Vercel

`BROWSERLESS_TOKEN`

Guardarla en Settings > Environment Variables. No debe estar escrita en el repositorio.

## Vercel

- Framework: Vite
- Output Directory: dist

## Desarrollo

```bash
npm install
npm run test
npm run build
```
