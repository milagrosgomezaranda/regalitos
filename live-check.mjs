import { extractMercadoLibreIds, importMercadoLibreProduct } from './mercadolibre-importer.mjs';

const urls = [
  ['Bolso Irimo', 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=5PF0k8YicT0vdd8UstmNrSMZpIf3q2zzhbnr9O9SvE9PmF8#origin=share&sid=share&wid=MLA1598228317&action=copy'],
  ['Adidas Terrex', 'https://www.mercadolibre.com.ar/zapatillas-de-senderismo-terrex-skychaser-ax5-jq2226-adidas/up/MLAU3674909961?product_trigger_id=MLA56797757&attributes=COLOR%3AGris%2CSIZE%3AMLAU3674909961&pdp_filters=item_id%3AMLA2675701986&applied_product_filters=MLAU3683124066&picker=true&quantity=1'],
];

for (const [name, url] of urls) {
  console.log(`\n[${name}]`, extractMercadoLibreIds(url));
  try {
    console.log(await importMercadoLibreProduct(url));
  } catch (error) {
    console.error('FAIL:', error.message);
    for (const cause of error.causes || []) console.error(' -', cause);
    process.exitCode = 1;
  }
}
