# Nuestra lista de regalos

Una wishlist privada para dos personas, con tres listas: Regalos Mami, Regalos Papi y Regalos Chunguita.

## Qué incluye

- Inicio de sesión por email y contraseña.
- Listas compartidas online.
- Mami y Papi: categorías Barato, Mediano y Caro, sin límite de regalos por categoría; cada regalo tiene prioridad del 1 al 3 y se puede repetir la prioridad para ordenar por preferencia.
- Chunguita: lista libre sin categorías ni ranking.
- Tarjetas con foto, nombre, precio, enlace y notas opcionales.
- Intenta leer título, imagen Open Graph y precio de un producto al pegar el enlace.
- Diseño adaptable a celular.

## Importante sobre la foto automática

La web intenta obtener `og:image`/`twitter:image` y otros metadatos públicos desde la página del producto. No todas las tiendas permiten lectura automática y algunas muestran una imagen genérica, no la primera foto de la galería. Si falla, pegá la URL de la foto manualmente. La importación no compra productos ni inicia sesión en las tiendas.

## Despliegue gratuito: Supabase + Vercel

Necesitás una cuenta en Supabase, una en Vercel y un repositorio de GitHub. Los niveles gratuitos pueden cambiar; revisá los límites actuales antes de publicar.

### 1. Crear la base privada en Supabase

1. Creá un proyecto nuevo en Supabase.
2. Abrí **SQL Editor** y ejecutá el contenido de `supabase/schema.sql`.
3. En **Authentication > URL Configuration**, agregá el dominio de Vercel como URL permitida.
4. Para una app privada, desactivá el registro abierto después de crear las dos cuentas, o mantenelo cerrado mediante invitaciones según las opciones disponibles en tu proyecto.
5. Copiá el Project URL y la clave pública `anon`/publishable. **Nunca pongas la `service_role` key en el frontend.**

### 2. Publicar el proyecto en GitHub y Vercel

1. Subí todos los archivos de esta carpeta a un repositorio privado de GitHub.
2. En Vercel, importá ese repositorio como proyecto.
3. En **Settings > Environment Variables**, agregá:
   - `VITE_SUPABASE_URL` = URL del proyecto Supabase.
   - `VITE_SUPABASE_ANON_KEY` = clave pública anon/publishable.
4. Desplegá el proyecto. Vercel detecta Vite y la función de `api/product.js`.

### 3. Dar acceso solamente a ustedes dos

1. Abrí la URL publicada y creá las dos cuentas con sus emails.
2. En Supabase, abrí **Authentication > Users** y copiá el UUID de cada usuario.
3. En SQL Editor ejecutá un `insert` con esos dos UUID en `public.allowed_users`, siguiendo el ejemplo al final de `supabase/schema.sql`.
4. Desactivá el registro público de nuevos usuarios en Authentication, una vez que ambas cuentas estén creadas.
5. Probá que ambos puedan entrar y que una tercera cuenta no pueda leer ni modificar regalos.

**Seguridad:** la tabla `allowed_users` tiene RLS habilitado y no tiene políticas de acceso desde el cliente. No compartas la URL con nadie más y usá contraseñas únicas.

## Desarrollo local

1. Instalá Node.js LTS.
2. Ejecutá `npm install`.
3. Copiá `.env.example` a `.env.local` y completá las dos variables de Supabase.
4. Ejecutá `npm run dev`.

## Límites conocidos

- El precio puede no detectarse o puede estar expresado en otra moneda. Revisalo antes de guardar.
- El sitio no garantiza que la primera foto sea la foto principal real: depende de los metadatos que publique la tienda.
- La ocasión elegida en la interfaz se guarda en cada regalo nuevo/editado, pero el selector de ocasión es una ayuda de organización, no un calendario de recordatorios.
- La app comparte las listas; no implementa un modo secreto de “ya compré esto” porque eso requiere reglas adicionales para que el comprador no revele la sorpresa.
