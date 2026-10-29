# Validación ejecutada

## Automatizadas

- `npm test`: PASS, 6/6.
- `npm run build`: PASS (`node --check` sobre importador y handler).

Estas validaciones pertenecen al módulo de corrección autocontenido. No equivalen al build del repositorio Regalitos, porque el repositorio no fue accesible desde este entorno.

## IDs verificados con las URLs provistas

### Bolso Irimo
- itemId: `MLA1598228317`
- catalogId: `MLA24365049`

### Adidas Terrex
- itemId: `MLA2675701986`
- catalogId primario de la ruta: `MLAU3674909961`
- IDs auxiliares detectados: `MLAU3683124066`, `MLA56797757`

El `product_trigger_id` no reemplaza al `item_id` de la publicación.

## Live check

`npm run live` se ejecutó con las dos URLs reales. El runtime no tiene salida HTTPS, por lo que fallaron tanto el fetch directo como `cors.tools` con `fetch failed`. El detalle bruto está en `LIVE-VALIDATION.txt`.

El importador no transforma ese fallo en un resultado parcial: exige simultáneamente `title`, `price` e `image`, rechaza páginas de verificación y no acepta logos de Mercado Libre como imagen.
