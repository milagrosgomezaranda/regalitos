# Regalitos - importador simple de Mercado Libre

Objetivo de esta version: priorizar nombre + foto desde el link del producto. El precio es opcional y nunca bloquea la carga.

Orden de consulta:
1. Metadatos Open Graph directos con User-Agent de link preview.
2. LinkMetadata (sin API key).
3. Microlink metadata (sin API key, fallback gratuito).

No usa Browserless, Playwright ni BROWSERLESS_TOKEN.

Vercel:
- Framework Preset: Vite
- Output Directory: dist
- Mantener VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
- BROWSERLESS_TOKEN ya no es necesario para este importador.
