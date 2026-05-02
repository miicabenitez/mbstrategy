'use strict';
/**
 * Migración de libroCaja (colección raíz) a clientes/{uid}/libroCaja/{docId}.
 *
 * Uso:
 *   node scripts/migrate-librocaja.js           → migración real
 *   node scripts/migrate-librocaja.js --dry-run → solo reporta, no escribe
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
  console.log(`\n=== Migración libroCaja → clientes/{uid}/libroCaja ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe en Firestore)'}\n`);

  const snap = await db.collection('libroCaja').get();
  console.log(`Total docs en libroCaja raíz: ${snap.size}`);

  let migrados = 0;
  let salteados = 0;
  let sinUid = [];
  let porCliente = {};

  for (const d of snap.docs) {
    const data = d.data();
    const uid  = data.uid;

    if (!uid) {
      console.warn(`  ⚠️  SALTEADO (sin uid): ${d.id}`);
      sinUid.push(d.id);
      salteados++;
      continue;
    }

    // Conteo por cliente
    porCliente[uid] = (porCliente[uid] || 0) + 1;

    if (!DRY_RUN) {
      await db
        .collection('clientes').doc(uid)
        .collection('libroCaja').doc(d.id)
        .set(data);
    }
    migrados++;
  }

  console.log('\n── Resumen ──────────────────────────────────');
  console.log(`  Docs a migrar  : ${migrados}`);
  console.log(`  Docs salteados : ${salteados} (sin uid)`);
  if (sinUid.length) console.log(`  IDs sin uid    : ${sinUid.join(', ')}`);
  console.log('\n── Docs por cliente ─────────────────────────');
  Object.entries(porCliente)
    .sort((a, b) => b[1] - a[1])
    .forEach(([uid, count]) => console.log(`  ${uid}: ${count} docs`));

  if (DRY_RUN) {
    console.log('\n⚠️  DRY-RUN: no se escribió nada. Corré sin --dry-run para migrar.');
  } else {
    console.log('\n✅ Migración completa. Los originales en libroCaja raíz NO fueron eliminados.');
    console.log('   Verificá en Firestore Console y luego podés ejecutar la limpieza.');
  }

  process.exit(0);
})();
