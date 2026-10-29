import { importMercadoLibreProduct } from './mercadolibre-importer.mjs';

const token = process.env.MELI_ACCESS_TOKEN || process.env.MELI_TOKEN;
const urls = process.argv.slice(2);

if (!token) {
  console.error('Falta MELI_ACCESS_TOKEN. Ejemplo PowerShell: $env:MELI_ACCESS_TOKEN = "..."');
  process.exit(1);
}

if (urls.length === 0) {
  console.error('Pasá uno o más links reales de Mercado Libre como argumentos.');
  process.exit(1);
}

for (const url of urls) {
  console.log('\n============================================================');
  console.log(url);
  console.log('============================================================');
  try {
    const result = await importMercadoLibreProduct(url, { token });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      error: error.message,
      details: error.causes || null,
    }, null, 2));
  }
}
