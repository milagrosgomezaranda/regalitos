# Regalitos - validación aislada de Mercado Libre

Esta versión NO modifica `src/main.js`, el formulario ni Supabase.

## Camino oficial implementado

- `GET /products/{productId}` -> nombre + fotos
- `GET /products/{productId}/items` -> itemId + precio

No usa `/items/{itemId}` ni `/sale_price`, porque en la prueba real con publicaciones ajenas ambos devolvieron HTTP 403.

## Variable temporal para validar

Antes de desplegar o ejecutar la prueba en vivo, configurar:

```text
MELI_ACCESS_TOKEN=<access token OAuth vigente>
```

Esto es TEMPORAL para validar el backend aislado. El token expira; el manejo de refresh token se implementará después de validar 3 links reales.

## Prueba local aislada

PowerShell:

```powershell
$env:MELI_ACCESS_TOKEN = "TU_TOKEN"
node live-check.mjs "LINK_1" "LINK_2" "LINK_3"
```

No compartir el token.

## Endpoint esperado

```text
GET /api/product?url=LINK_REAL
```

Respuesta completa esperada:

```json
{
  "title": "...",
  "price": 62066.35,
  "currency": "ARS",
  "image": "https://...",
  "url": "...",
  "source": "mercadolibre",
  "itemId": "MLA...",
  "productId": "MLA...",
  "partial": false,
  "fields": {
    "title": "ok",
    "image": "ok",
    "price": "ok"
  },
  "warnings": []
}
```

Si falla solamente precio, la respuesta conserva nombre y foto y marca `partial: true`.

## Limitación conocida

Los links directos que solo contienen un itemId y no permiten obtener un productId de catálogo no se importan todavía. La API `/items/{itemId}` de publicaciones ajenas devolvió 403 en la validación real.
