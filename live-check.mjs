import { extractMercadoLibreIds, importMercadoLibreProduct } from './mercadolibre-importer.mjs';

const urls = [
  ['Bolso Irimo', 'https://www.mercadolibre.com.ar/p/MLA24365049?matt_tool=89488245&pdp_filters=item_id:MLA1598228317&ua=5PF0k8YicT0vdd8UstmNrSMZpIf3q2zzhbnr9O9SvE9PmF8#origin=share&sid=share&wid=MLA1598228317&action=copy'],
  ['Producto 2', 'https://www.mercadolibre.com.ar/p/MLA78853394?matt_tool=89488245&pdp_filters=item_id:MLA2060802049&ua=ck5Fa9611MR9NEYBUiNtlTFkYzxxL5mTdmwhHzBjkckP_tY#origin=share&sid=share&wid=MLA2060802049&action=copy'],
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
