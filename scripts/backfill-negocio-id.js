'use strict';
/**
 * Backfill de negocioId para clientes que quedaron sin él
 * (ej. Café Miga y cualquier alta por webhook MP previa al fix que asigna
 * negocioId en el alta).
 *
 * Asigna MB-<n> secuencial reutilizando el counter transaccional
 * config/negocioCounter (mismo contrato que la migración one-shot original).
 * No pisa clientes que ya tienen negocioId.
 *
 * Uso:
 *   node scripts/backfill-negocio-id.js           → backfill real
 *   node scripts/backfill-negocio-id.js --dry-run → solo reporta, no escribe
 *
 * Requiere FIREBASE_SERVICE_ACCOUNT en env o serviceAccountKey.json en raíz.
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

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
  console.log(`\n=== Backfill negocioId (clientes sin ID) ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe en Firestore)'}\n`);

  // ── 1. Clientes sin negocioId (fuera de la transacción) ──
  const snap = await db.collection('clientes').get();
  const sinId = snap.docs.filter(d => !d.data().negocioId);

  console.log(`Total clientes: ${snap.size}`);
  console.log(`Sin negocioId : ${sinId.length}`);

  if (sinId.length === 0) {
    console.log('\n✅ Todos los clientes ya tienen negocioId. Nada que hacer.');
    process.exit(0);
  }

  sinId.forEach(d => {
    const c = d.data();
    console.log(`  · ${d.id} — ${c.negocioNombre || c.nombre || '(sin nombre)'} <${c.email || ''}>`);
  });

  // Una transacción de Firestore admite hasta ~500 writes. Reservamos 1 para el counter.
  if (sinId.length > 450) {
    console.error(`\n❌ Demasiados (${sinId.length}). Procesá en batches de 450.`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n⚠️  DRY-RUN: no se escribió nada. Corré sin --dry-run para asignar.');
    process.exit(0);
  }

  // ── 2. Transacción: leer counter, asignar rango, actualizar counter + clientes ──
  const counterRef = db.collection('config').doc('negocioCounter');
  const asignados = await db.runTransaction(async (tx) => {
    const counterSnap = await tx.get(counterRef);
    if (!counterSnap.exists) {
      throw new Error('config/negocioCounter no existe. Crearlo primero con { ultimoId: <numero> }.');
    }
    const ultimoId = parseInt(counterSnap.data().ultimoId, 10);
    if (isNaN(ultimoId)) throw new Error('config/negocioCounter.ultimoId no es un número válido.');

    const res = [];
    sinId.forEach((d, i) => {
      const nid = `MB-${ultimoId + i + 1}`;
      tx.update(d.ref, { negocioId: nid });
      res.push({ uid: d.id, negocioId: nid, nombre: d.data().negocioNombre || d.data().nombre || '' });
    });
    tx.update(counterRef, { ultimoId: ultimoId + sinId.length });
    return res;
  });

  console.log('\n── Asignados ────────────────────────────────');
  asignados.forEach(a => console.log(`  ${a.negocioId}  ${a.uid}  ${a.nombre}`));
  console.log(`\n✅ Backfill completo: ${asignados.length} cliente(s).`);
  process.exit(0);
})();
