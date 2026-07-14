'use strict';
/**
 * Backfill de las 4 cuentas base del blindaje (Efectivo/Mercado Pago/Banco/Caja mostrador)
 * para clientes a los que les falte alguna. No pisa las cuentas existentes.
 *
 * Motivo: el circuito cajero espera una cuenta de efectivo llamada 'Caja mostrador' y una
 * cuenta 'Banco' (tipo banco = Transferencia). Las cuentas creadas antes del blindaje del alta
 * (ej. Café Miga) sólo tienen Efectivo + Mercado Pago, y el modal de venta del cajero no ofrece
 * Efectivo ni Transferencia.
 *
 * Sólo toca clientes que YA tienen al menos una cuenta (activos). Los que tienen 0 cuentas se
 * saltean: el seed client-side las crea en el primer login.
 *
 * Uso:
 *   node scripts/backfill-cuentas-base.js --dry-run           → reporta, no escribe (TODOS)
 *   node scripts/backfill-cuentas-base.js                     → backfill real (TODOS)
 *   node scripts/backfill-cuentas-base.js --uid=<UID> --dry-run  → sólo ese cliente
 *
 * Requiere FIREBASE_SERVICE_ACCOUNT en env o serviceAccountKey.json en raíz.
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const DRY_RUN  = process.argv.includes('--dry-run');
const UID_ARG  = (process.argv.find(a => a.startsWith('--uid=')) || '').split('=')[1] || '';

// Las mismas 4 base que crea el alta (mp-webhook.js) y el seed client-side.
const CUENTAS_BASE = [
  { nombre: 'Efectivo',       tipo: 'efectivo', orden: 0 },
  { nombre: 'Mercado Pago',   tipo: 'mp',       orden: 1 },
  { nombre: 'Banco',          tipo: 'banco',    orden: 2 },
  { nombre: 'Caja mostrador', tipo: 'efectivo', orden: 3 }
];

// ── Service account ──
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.error('FIREBASE_SERVICE_ACCOUNT no es JSON válido');
    process.exit(1);
  }
} else {
  const localPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(localPath)) {
    console.error('Falta service account. Opciones:');
    console.error('  1) export FIREBASE_SERVICE_ACCOUNT=\'{"type":"service_account",...}\'');
    console.error('  2) Colocá serviceAccountKey.json en la raíz del proyecto');
    process.exit(1);
  }
  serviceAccount = require(localPath);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  console.log(`\n=== Backfill cuentas base (Efectivo/Mercado Pago/Banco/Caja mostrador) ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe en Firestore)'}${UID_ARG ? ` · sólo ${UID_ARG}` : ''}\n`);

  const clientesSnap = UID_ARG
    ? [await db.collection('clientes').doc(UID_ARG).get()]
    : (await db.collection('clientes').get()).docs;

  let tocados = 0, escritos = 0;

  for (const d of clientesSnap) {
    if (!d.exists) { console.log(`  ⚠️  ${UID_ARG} no existe`); continue; }
    const c = d.data();
    const nombre = c.negocioNombre || c.nombre || d.id;
    const cuentasSnap = await d.ref.collection('cuentas').get();

    // Saltear clientes sin ninguna cuenta (los sembrará el seed en el primer login)
    if (cuentasSnap.empty) { continue; }

    const existentes = new Set(cuentasSnap.docs.map(x => x.data().nombre));
    const faltan = CUENTAS_BASE.filter(b => !existentes.has(b.nombre));
    if (!faltan.length) continue;

    tocados++;
    console.log(`  ${nombre} (${d.id}) — falta: ${faltan.map(f => f.nombre).join(', ')}`);

    if (!DRY_RUN) {
      const batch = db.batch();
      faltan.forEach(b => batch.set(d.ref.collection('cuentas').doc(), { nombre: b.nombre, tipo: b.tipo, saldo: 0, orden: b.orden }));
      await batch.commit();
      escritos += faltan.length;
    }
  }

  console.log('\n── Resumen ──────────────────────────────────');
  console.log(`  Clientes con faltantes: ${tocados}`);
  if (DRY_RUN) {
    console.log('\n⚠️  DRY-RUN: no se escribió nada. Corré sin --dry-run para aplicar.');
  } else {
    console.log(`  Cuentas creadas       : ${escritos}`);
    console.log('\n✅ Backfill completo.');
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
