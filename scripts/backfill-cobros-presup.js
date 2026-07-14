'use strict';
/**
 * Backfill: vincular los cobros del test a su presupuesto (setear presupId) y recalcular
 * cobradoPorPresup + estado del presupuesto.
 *
 * Café Miga, corrida de test:
 *   - Estudio Contable Ríos: cobro $50.000  → presupuesto 0001-00000002 (id ESchEkuc0fE2Uxjw2vJO)
 *   - Coworking Nube:        cobro $88.000  → presupuesto 0001-00000001 (id XkDp4wuQ53AWNeQRn9Wd)
 *
 * Idempotente: cobradoPorPresup se RECALCULA como la suma de los cobros vinculados (no incrementa),
 * así correrlo dos veces no duplica. estado = 'Cobrado' si cobrado >= total, si no 'Aprobado'.
 *
 * Uso:
 *   node scripts/backfill-cobros-presup.js --dry-run
 *   node scripts/backfill-cobros-presup.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const UID = 'xypeb5lnRmP07QErFBSDOhYasfP2';

const TARGETS = [
  { cliente: 'WIBs8Z5fqvchrpPmnVFv', presupId: 'ESchEkuc0fE2Uxjw2vJO', label: 'Estudio Contable Ríos → 0001-00000002' },
  { cliente: 'f2a7dkW3DN1qiXG7ojMm', presupId: 'XkDp4wuQ53AWNeQRn9Wd', label: 'Coworking Nube → 0001-00000001' }
];

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

// Mismo criterio que getPresupMonto del front (monto directo o suma de items).
function presupMonto(p) {
  if (typeof p.monto === 'number' && p.monto > 0) return p.monto;
  if (Array.isArray(p.items)) return p.items.reduce((a, it) => a + (parseFloat(it.subtotal) || (parseFloat(it.precioUnitario)||0)*(parseFloat(it.qty)||1) || 0), 0);
  return parseFloat(p.monto) || 0;
}

(async () => {
  console.log(`\n=== Backfill cobros → presupuesto ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe)'}\n`);

  for (const t of TARGETS) {
    console.log(`── ${t.label} ──`);
    const presRef = db.collection('clientes').doc(UID).collection('presupuestos').doc(t.presupId);
    const presSnap = await presRef.get();
    if (!presSnap.exists) { console.error(`  ❌ presupuesto ${t.presupId} no existe — salteado`); continue; }
    const p = presSnap.data();
    const total = presupMonto(p);

    const cobrosCol = db.collection('clientes').doc(UID).collection('misClientes').doc(t.cliente).collection('cobros');
    const cobrosSnap = await cobrosCol.get();
    const cobros = cobrosSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => !c.eliminado);

    // Vincular los cobros sin presupId a este presupuesto (caso test: 1 cobro suelto por cliente).
    const sueltos = cobros.filter(c => !c.presupId);
    if (sueltos.length === 0) {
      console.log('  (no hay cobros sin vincular)');
    } else {
      for (const c of sueltos) {
        console.log(`  vincular cobro ${c.id}  $${c.monto}  "${c.concepto||''}"  → presupId ${t.presupId}`);
        if (!DRY_RUN) await cobrosCol.doc(c.id).update({ presupId: t.presupId });
        c.presupId = t.presupId; // reflejar para el recálculo de abajo
      }
    }

    // Recalcular cobradoPorPresup = suma de cobros vinculados a este presupuesto.
    const cobrado = cobros.filter(c => c.presupId === t.presupId).reduce((a, c) => a + (parseFloat(c.monto) || 0), 0);
    const estado = cobrado >= total ? 'Cobrado' : 'Aprobado';
    const pend = Math.max(0, total - cobrado);
    console.log(`  presupuesto: total $${total} · cobrado $${cobrado} · pendiente $${pend} · estado → ${estado}`);
    if (!DRY_RUN) await presRef.update({ cobradoPorPresup: cobrado, estado });
  }

  console.log(DRY_RUN ? '\n⚠️  DRY-RUN: no se escribió nada. Corré sin --dry-run para aplicar.' : '\n✅ Backfill completo.');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
