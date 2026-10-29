# Regalitos

Versión consolidada del proyecto.

## Importador de Mercado Libre

La aplicación usa un único endpoint:

`GET /api/product?url=<URL_DE_MERCADO_LIBRE>`

Ese endpoint abre la ficha con Chromium + Playwright y devuelve únicamente cuando obtuvo los tres datos requeridos:

```json
{
  "ok": true,
  "title": "...",
  "price": 123456,
  "image": "https://...mlstatic.com/...",
  "method": "playwright-dom"
}
```

Si Mercado Libre bloquea la navegación, si Chromium no inicia o si falta alguno de los tres campos, devuelve un JSON de error con `stage` para identificar el punto exacto del fallo. El frontend corta la espera a los 22 segundos y siempre vuelve a habilitar el botón.

## Vercel

Configuración esperada:

- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Node.js: 22.x

No configurar un Output Directory distinto ni crear reglas manuales para las funciones de `api/`.
