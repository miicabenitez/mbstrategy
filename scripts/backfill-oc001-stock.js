'use strict';
/**
 * Backfill Café Miga — OC-001 "Café en grano" que se recibió sin vínculo a stock.
 *
 * 1. Setea insumoId en el prodCompra "Café en grano".
 * 2. Setea insumoId (+nombre/unidad) en el ítem de la OC-001.
 * 3. Suma los 5 kg recibidos al insumo "Café en grano" con movimiento retroactivo
 *    (tipo entrada, origen compra, motivo "Compra OC-001").
 *
 * Idempotente: si ya existe un movimiento de stock para (OC-001, insumo) NO vuelve a sumar.
 * Los vínculos se setean solo si faltan.
 *
 * Uso:
 *   node scripts/backfill-oc001-stock.js --dry-run
 *   node scripts/backfill-oc001-stock.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const UID = 'xypeb5lnRmP07QErFBSDOhYasfP2';
const OC_ID = 'Oqqnwngwnwvljkku6yUS';           // OC-001
const PRODCOMPRA_ID = 'D0nVGC9C2YTy41qAImhh';    // prodCompra "Café en grano"
const INSUMO_ID = '0rJcOE5ei8YRBbXUOqcJ';        // insumo "Café en grano"

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch (e) { console.error('FIREBASE_SERVICE_ACCOUNT no es JSON válido'); process.exit(1); }
} else {
  const p = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(p)) { console.error('Falta service account'); process.exit(1); }
  serviceAccount = require(p);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const cli = db.collection('clientes').doc(UID);

(async () => {
  console.log(`\n=== Backfill OC-001 → stock (Café en grano) ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe)'}\n`);

  const insSnap = await cli.collection('insumos').doc(INSUMO_ID).get();
  if (!insSnap.exists) { console.error('❌ Insumo no existe'); process.exit(1); }
  const insumo = insSnap.data();
  const unidad = (insumo.unidad || 'kg');

  // 1. prodCompra.insumoId
  const pcSnap = await cli.collection('prodCompra').doc(PRODCOMPRA_ID).get();
  if (pcSnap.exists) {
    const pc = pcSnap.data();
    if (pc.insumoId === INSUMO_ID) console.log('prodCompra: ya vinculado ✓');
    else {
      console.log(`prodCompra "${pc.nombre}" → set insumoId=${INSUMO_ID}` + (pc.unidad !== unidad ? ` (+ unidad ${pc.unidad}→${unidad})` : ''));
      if (!DRY_RUN) await cli.collection('prodCompra').doc(PRODCOMPRA_ID).update({ insumoId: INSUMO_ID, unidad });
    }
  } else console.log('⚠️  prodCompra no encontrado (se saltea)');

  // 2. Ítem de la OC-001
  const ocSnap = await cli.collection('ordenesCompra').doc(OC_ID).get();
  if (!ocSnap.exists) { console.error('❌ OC-001 no existe'); process.exit(1); }
  const oc = ocSnap.data();
  const items = (oc.items || []).map(it => ({ ...it }));
  const idx = items.findIndex(it => !it.insumoId && !it.productoId && (it.nombre || '').toLowerCase().trim() === (insumo.nombre || '').toLowerCase().trim());
  let itemVinculado = false;
  if (idx >= 0) {
    console.log(`OC-001 item[${idx}] "${items[idx].nombre}" → set insumoId=${INSUMO_ID}`);
    items[idx] = { ...items[idx], insumoId: INSUMO_ID, insumoNombre: insumo.nombre, insumoUnidad: unidad };
    itemVinculado = true;
    if (!DRY_RUN) await cli.collection('ordenesCompra').doc(OC_ID).update({ items });
  } else {
    console.log('OC-001: el ítem ya tiene vínculo o no matchea (se saltea la vinculación del ítem)');
  }

  // 3. Stock retroactivo (idempotente por movimiento existente)
  const cantidad = parseFloat((oc.items || [])[0]?.cantidadRecibida) || 5;
  const movQ = await cli.collection('movimientosStock').where('referenciaId', '==', OC_ID).get();
  const yaSumado = movQ.docs.some(d => d.data().insumoId === INSUMO_ID && d.data().origen === 'compra');
  if (yaSumado) {
    console.log('Stock: ya existe un movimiento de compra para (OC-001, insumo) → NO se vuelve a sumar ✓');
  } else {
    const nuevoStock = (parseFloat(insumo.stockActual) || 0) + cantidad;
    console.log(`Stock insumo "${insumo.nombre}": ${insumo.stockActual} + ${cantidad} = ${nuevoStock} ${unidad}  (+ movimiento "Compra OC-001")`);
    if (!DRY_RUN) {
      await cli.collection('insumos').doc(INSUMO_ID).update({ stockActual: admin.firestore.FieldValue.increment(cantidad) });
      await cli.collection('movimientosStock').add({
        tipo: 'entrada', insumoId: INSUMO_ID, insumoNombre: insumo.nombre, cantidad, unidad,
        origen: 'compra', referenciaId: OC_ID, notas: 'Compra OC-001 (backfill retroactivo)',
        fecha: (oc.fechaRecepcion || new Date().toISOString().slice(0, 10)),
        creadoEn: new Date().toISOString()
      });
    }
  }

  console.log(DRY_RUN ? '\n⚠️  DRY-RUN: no se escribió nada.' : '\n✅ Backfill completo.');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
