'use strict';
/**
 * Backfill: la etiqueta fechaFin del primer cierre (2026-0001) refleja la fecha REAL de ejecución.
 *
 * El cierre guarda cerradoEn (timestamp del instante) pero fechaFin salía del date-picker (una quincena
 * rodante decorativa): decía "hasta 2026-07-18" cuando en realidad ejecutó el 2026-07-19 00:55 ART e
 * incluyó (vía snapshot de saldos) un ingreso fechado 19/07. Es el primer cierre de la historia y queda
 * en "Ver cierre anterior" para siempre → que cuente la verdad: fechaFin = fecha ART de cerradoEn.
 *
 * Idempotente: solo escribe si fechaFin != fecha ART de cerradoEn. Dry-run por defecto.
 *
 * Uso:
 *   node scripts/backfill-cierre-2026-0001-fechafin.js --dry-run
 *   node scripts/backfill-cierre-2026-0001-fechafin.js
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const UID = 'xypeb5lnRmP07QErFBSDOhYasfP2';   // Café Miga
const CIERRE_ID = 'l0kor6AG0KhtFFMGu008';     // 2026-0001

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
else {
  const p = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(p)) { console.error('Falta service account'); process.exit(1); }
  serviceAccount = require(p);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// cerradoEn puede ser string ISO (así lo guarda el front) o Timestamp. Normaliza a ms.
function tsToMs(ts) {
  if (ts == null) return NaN;
  if (typeof ts === 'string') return new Date(ts).getTime();
  if (ts._seconds != null) return ts._seconds * 1000;
  if (ts.seconds != null) return ts.seconds * 1000;
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  return new Date(ts).getTime();
}
// Fecha ART (YYYY-MM-DD) de cerradoEn.
function fechaARGdeTs(ts) {
  const d = new Date(tsToMs(ts));
  return d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
    .split('/').reverse().map(p => p.padStart(2, '0')).join('-');
}

(async () => {
  console.log(`\n=== Backfill fechaFin Cierre 2026-0001 ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe)'}\n`);
  const ref = db.collection('cierres').doc(CIERRE_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.error('❌ cierre no existe'); process.exit(1); }
  const c = snap.data();
  if (c.uid !== UID || c.numero !== '2026-0001') { console.error('❌ doc no coincide (uid/numero)', c.uid, c.numero); process.exit(1); }

  const nuevaFechaFin = fechaARGdeTs(c.cerradoEn);

  // fechaInicio del PRIMER cierre = arranque real de la cuenta: fecha del primer movimiento del libro
  // (excluye el propio cierre y eliminados). Fallback: fecha ART del alta de la cuenta (clientes.creadoEn).
  const movsSnap = await db.collection('clientes').doc(UID).collection('libroCaja').get();
  let minFecha = null;
  movsSnap.forEach(d => {
    const m = d.data();
    if (m.eliminado || m.origen === 'cierre') return;
    const f = m.fecha;
    if (typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && (!minFecha || f < minFecha)) minFecha = f;
  });
  let nuevaFechaInicio = minFecha;
  let fuente = 'primer movimiento del libro';
  if (!nuevaFechaInicio) {
    const cli = (await db.collection('clientes').doc(UID).get()).data() || {};
    nuevaFechaInicio = fechaARGdeTs(cli.creadoEn || (cli.membresia && cli.membresia.activoDesde));
    fuente = 'alta de la cuenta (fallback)';
  }

  console.log(`  cerradoEn (UTC)        : ${new Date(tsToMs(c.cerradoEn)).toISOString()}`);
  console.log(`  → fecha ART ejecución  : ${nuevaFechaFin}`);
  console.log(`  fechaInicio actual     : ${c.fechaInicio}   → nueva: ${nuevaFechaInicio}   (${fuente})`);
  console.log(`  fechaFin   actual      : ${c.fechaFin}   → nueva: ${nuevaFechaFin}`);

  if (c.fechaFin === nuevaFechaFin && c.fechaInicio === nuevaFechaInicio) { console.log('\n✓ Ya está correcto, nada que hacer (idempotente).'); process.exit(0); }
  if (!DRY_RUN) {
    await ref.update({ fechaInicio: nuevaFechaInicio, fechaFin: nuevaFechaFin });
    const a = (await ref.get()).data();
    console.log(`\n✅ Actualizado. fechaInicio = ${a.fechaInicio} · fechaFin = ${a.fechaFin}`);
  } else {
    console.log(`\n⚠️  DRY-RUN: no se escribió. Correr sin --dry-run para aplicar.`);
  }
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
