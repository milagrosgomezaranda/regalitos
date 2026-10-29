# Browserless validation

- Browserless API: `/unblock`
- Proxy: residential
- Country: Argentina (`ar`)
- Token: `BROWSERLESS_TOKEN` desde Vercel
- No Chromium local en Vercel
- No Playwright/Chromium dependency
- Parser: título visible, precio vigente, imagen principal mlstatic
- Cache del resultado: 10 minutos por instancia

La validación live final debe ejecutarse desde el deployment de Vercel porque el token está guardado allí y no se expone al repositorio ni al chat.
