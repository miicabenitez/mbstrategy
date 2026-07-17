'use strict';
/**
 * Backfill: normalizar creadoEn Timestamp → string ISO en los movimientos de proveedor.
 *
 * savePagoProveedor escribía `creadoEn: new Date()` (objeto Date → Firestore lo guarda como
 * Timestamp) en dos lugares: el pago (proveedores/{pid}/pagos) y el egreso (egresos). El resto de
 * la app usa new Date().toISOString() (string). Al mezclarse, el sort del reporte de CC de proveedor
 * (_ccBuildLedger) hacía (creadoEn||'').localeCompare(...) sobre un Timestamp → "localeCompare is not
 * a function" → reporte mudo cuando dos movimientos comparten fecha (factura esOC + pago mismo día).
 *
 * El front ya quedó blindado (window._fechaComparable en el sort + fuente ya escribe ISO string).
 * Este backfill limpia el dato viejo para dejar la colección consistente.
 *
 * Idempotente: solo toca docs cuyo creadoEn NO es string. Corre sobre TODOS los clientes
 * (el bug afectó a cualquiera que registró un pago de proveedor con el código viejo).
 *
 * Uso:
 *   node scripts/backfill-creadoEn-timestamps.js --dry-run
 *   node scripts/backfill-creadoEn-timestamps.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch (e) { console.error('FIREBASE_SERVICE_ACCOUNT no es JSON válido'); process.exit(1); }
} else {
  const localPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(localPath)) { console.error('Falta service account'); process.exit(1); }
  serviceAccount = require(localPath);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Un creadoEn "roto" es cualquiera que no sea string y sepa convertirse a Date (Timestamp/Date).
function creadoEnISO(ce) {
  if (ce == null || typeof ce === 'string') return null;         // ya está bien (o no existe)
  if (typeof ce.toDate === 'function') return ce.toDate().toISOString(); // Firestore Timestamp
  if (ce instanceof Date) return ce.toISOString();
  if (typeof ce.seconds === 'number') return new Date(ce.seconds * 1000).toISOString();
  return null;
}

async function fixColeccion(colRef, label, stats) {
  const snap = await colRef.get();
  for (const d of snap.docs) {
    const iso = creadoEnISO(d.data().creadoEn);
    if (!iso) continue;
    stats.fixed++;
    console.log(`  ${label}/${d.id}  creadoEn Timestamp → ${iso}`);
    if (!DRY_RUN) await colRef.doc(d.id).update({ creadoEn: iso });
  }
}

(async () => {
  console.log(`\n=== Backfill creadoEn Timestamp → ISO (pagos + egresos de proveedor) ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe)'}\n`);

  const clientesSnap = await db.collection('clientes').get();
  const stats = { fixed: 0, clientes: 0 };

  for (const cli of clientesSnap.docs) {
    const uid = cli.id;
    let toco = 0;
    const antes = stats.fixed;

    // Egresos del cliente
    await fixColeccion(db.collection('clientes').doc(uid).collection('egresos'), `egresos`, stats);

    // Pagos anidados bajo cada proveedor
    const provSnap = await db.collection('clientes').doc(uid).collection('proveedores').get();
    for (const prov of provSnap.docs) {
      await fixColeccion(
        db.collection('clientes').doc(uid).collection('proveedores').doc(prov.id).collection('pagos'),
        `prov(${prov.id})/pagos`, stats
      );
    }

    toco = stats.fixed - antes;
    if (toco > 0) { stats.clientes++; console.log(`  cliente ${uid}: ${toco} doc(s)\n`); }
  }

  console.log(`\nTotal: ${stats.fixed} doc(s) en ${stats.clientes} cliente(s).`);
  console.log(DRY_RUN ? '⚠️  DRY-RUN: no se escribió nada. Corré sin --dry-run para aplicar.' : '✅ Backfill completo.');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
