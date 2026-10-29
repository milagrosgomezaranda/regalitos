# Regalitos — Browserless v5

Integración corregida contra Browserless BaaS v2.

- Endpoint oficial: `POST /chromium/unblock`
- Query: `token`, `timeout`, `proxy=residential`, `proxyCountry=ar`, `proxySticky=true`
- Body oficial: `url`, `browserWSEndpoint`, `cookies`, `content`, `screenshot`, `ttl`
- Conexión Playwright: `chromium.connectOverCDP(...)`
- Extracción tolerante: DOM visible + meta + JSON-LD
- No levanta Chromium dentro de Vercel.

Variable requerida en Vercel: `BROWSERLESS_TOKEN`.
