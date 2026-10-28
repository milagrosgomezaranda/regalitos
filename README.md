# Regalitos para nosotros 🫰🏼

Lista de regalos compartida para Mami, Papi y Chunguita. Interfaz cálida, más simple y en español argentino.

## Cambios incluidos
- Título “Regalitos para nosotros 🫰🏼”, sin subtítulo.
- Diseño más limpio, con menos elementos decorativos y categorías vacías ocultas.
- Al tocar **Completar con datos de la tienda**, la app prioriza el nombre, la foto y el precio actual que la página permita leer, incluso si ya había un precio anterior cargado.
- Vista previa de la foto dentro del formulario.
- El formulario no se reconstruye por actualizaciones en vivo mientras lo estás completando, para no perder lo escrito.
- Mensaje claro si se intenta guardar un regalo sin identificador o si la sesión venció.
- Lectura de metadatos habituales y JSON-LD de productos para mejorar la detección de imagen y precio.

## Importante
No todas las tiendas permiten leer automáticamente el precio o la foto. Si una tienda bloquea el acceso o no publica esos datos, completalos a mano. Revisá siempre el precio antes de guardar.

## Publicarlo en tu proyecto actual
Tu app está alojada en Vercel y el código está en GitHub. Para que los cambios se vean online, tenés que actualizar los archivos del repositorio `regalitos`; Vercel debería desplegarlos automáticamente.

1. Descargá el ZIP y extraelo en tu PC.
2. Entrá a tu repositorio privado de GitHub `milagrosgomezaranda/regalitos`.
3. Elegí **Add file → Upload files**.
4. Desde la carpeta extraída, subí los archivos conservando sus carpetas (`src`, `api`, `supabase`) y los archivos de la raíz. Si GitHub avisa que reemplazará archivos existentes, confirmá que querés actualizar los archivos del proyecto.
5. Abajo, escribí como mensaje de commit `Mejoras visuales y formulario de regalos` y confirmá con **Commit changes**.
6. Entrá a Vercel → proyecto `regalitos` → **Deployments**. Esperá que el despliegue más nuevo termine en **Ready**.
7. Abrí la URL de la app y actualizá con Ctrl+F5.

No borres las variables de entorno que ya configuraste en Vercel. No hace falta volver a crear el proyecto de Supabase ni cargar los regalos otra vez.

## Variables de entorno de Vercel
- `VITE_SUPABASE_URL`: URL del proyecto Supabase.
- `VITE_SUPABASE_ANON_KEY`: clave pública `sb_publishable_...` de Supabase.

No uses una clave `sb_secret_...` en el frontend.

## Desarrollo local
Requiere Node.js LTS. Ejecutá `npm install`, creá `.env.local` a partir de `.env.example`, completá las dos variables y corré `npm run dev`.
