'use strict';
/**
 * Backfill puntual: convertir creadoEn + membresia.activoDesde de la cuenta certificada (Olivia,
 * corrida cero) de Timestamp → string ISO, para que la cuenta creada por el webhook viejo quede
 * alineada a la convención (new Date().toISOString()) — no solo las futuras.
 *
 * El webhook ya se corrigió (serverTimestamp → new Date().toISOString()); esto arregla el dato
 * existente. proximoCobro se deja como Timestamp a propósito (el panel admin lo lee con .seconds).
 *
 * Idempotente: solo convierte campos que son Timestamp (no toca si ya son string). Dry-run por defecto.
 *
 * Uso:
 *   node scripts/backfill-olivia-creadoEn-string.js --dry-run
 *   node scripts/backfill-olivia-creadoEn-string.js
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const OLIVIA = 'YEYAZlTjG5NMZTOoQWgBj71H6Fn2';

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
else {
  const p = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(p)) { console.error('Falta service account'); process.exit(1); }
  serviceAccount = require(p);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Devuelve {esTimestamp, iso} para un valor de fecha.
function analizar(v) {
  if (v == null) return { esTimestamp: false, iso: null };
  if (typeof v === 'string') return { esTimestamp: false, iso: v };
  if (typeof v.toDate === 'function') return { esTimestamp: true, iso: v.toDate().toISOString() };
  if (v._seconds != null) return { esTimestamp: true, iso: new Date(v._seconds * 1000).toISOString() };
  if (v.seconds != null) return { esTimestamp: true, iso: new Date(v.seconds * 1000).toISOString() };
  return { esTimestamp: false, iso: String(v) };
}

(async () => {
  console.log(`\n=== Backfill creadoEn/activoDesde string · Olivia ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe)'}\n`);
  const ref = db.collection('clientes').doc(OLIVIA);
  const snap = await ref.get();
  if (!snap.exists) { console.error('❌ doc no existe'); process.exit(1); }
  const c = snap.data();
  const m = c.membresia || {};

  const ce = analizar(c.creadoEn);
  const ad = analizar(m.activoDesde);
  console.log(`  creadoEn            : ${ce.esTimestamp ? 'Timestamp' : 'string'} → ${ce.iso}`);
  console.log(`  membresia.activoDesde: ${ad.esTimestamp ? 'Timestamp' : 'string'} → ${ad.iso}`);

  const upd = {};
  if (ce.esTimestamp) upd['creadoEn'] = ce.iso;
  if (ad.esTimestamp) upd['membresia.activoDesde'] = ad.iso;

  if (Object.keys(upd).length === 0) { console.log('\n✓ Ambos ya son string, nada que hacer (idempotente).'); process.exit(0); }
  console.log(`\n  A convertir: ${Object.keys(upd).join(', ')}`);
  if (!DRY_RUN) {
    await ref.update(upd);
    const a = (await ref.get()).data();
    console.log(`\n✅ Convertido. creadoEn tipo=${typeof a.creadoEn} · activoDesde tipo=${typeof (a.membresia||{}).activoDesde}`);
  } else {
    console.log(`\n⚠️  DRY-RUN: no se escribió. Correr sin --dry-run para aplicar.`);
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
