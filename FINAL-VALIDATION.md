# Regalitos Browserless v4

Corrección puntual del importador de Mercado Libre.

- Se elimina `/function` y su `waitForSelector('h1.ui-pdp-title')` rígido.
- Se usa `/unblock` + proxy residencial AR, que ya demostró abrir la ficha desde Vercel.
- No se espera un selector único: Mercado Libre puede cambiar el DOM por A/B tests.
- Título: h1 -> JSON-LD -> Open Graph -> itemprop -> title.
- Precio: `meta itemprop="price"` dentro de `#price`/`ui-pdp-price__second-line` -> texto accesible -> fracción/centavos -> JSON-LD -> metas globales.
- Imagen: galería principal -> `ui-pdp-image` -> Open Graph -> JSON-LD.
- Si falta un campo pero hay otros válidos, la API responde parcial para que el formulario complete lo encontrado.
