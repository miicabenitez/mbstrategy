'use strict';
/**
 * Backfill del espejo faltante de V-0003 (Café Miga, turno 1 de Diego).
 *
 * V-0003 ($13.000) nació como Tarjeta Débito (no espeja) y luego se cambió a Mercado Pago
 * con "Modificar medio", que en su momento NO reconciliaba el espejo → quedó MP sin reflejo
 * en la cuenta del dueño. Como el turno está CERRADO (inmutable), lo saneamos por script,
 * no por UI.
 *
 * Crea un venta_caja_espejo en cuenta 'Mercado Pago' con estructura idéntica a los otros
 * espejos MP del turno. Idempotente: si ya existe un espejo activo para V-0003, no hace nada.
 *
 * Uso:
 *   node scripts/backfill-espejo-v0003.js --dry-run   → reporta, no escribe
 *   node scripts/backfill-espejo-v0003.js             → crea el espejo
 *
 * Requiere FIREBASE_SERVICE_ACCOUNT en env o serviceAccountKey.json en raíz.
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

const DRY_RUN = process.argv.includes('--dry-run');

const UID           = 'xypeb5lnRmP07QErFBSDOhYasfP2';   // Café Miga
const PRIMARIO_ID   = 'OK3nSyOKRZV58Nn8t5an';           // V-0003 (venta_caja primaria)
const CUENTA_DESTINO = 'Mercado Pago';

// ── Service account ──
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch (e) { console.error('FIREBASE_SERVICE_ACCOUNT no es JSON válido'); process.exit(1); }
} else {
  const localPath = path.join(__dirname, '..', 'serviceAccountKey.json');
  if (!fs.existsSync(localPath)) {
    console.error('Falta service account (FIREBASE_SERVICE_ACCOUNT o serviceAccountKey.json en raíz)');
    process.exit(1);
  }
  serviceAccount = require(localPath);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  console.log(`\n=== Backfill espejo V-0003 ===`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (solo lectura)' : 'REAL (escribe en Firestore)'}\n`);

  const lcRef = db.collection('clientes').doc(UID).collection('libroCaja');

  // 1. Primario
  const primSnap = await lcRef.doc(PRIMARIO_ID).get();
  if (!primSnap.exists) { console.error(`❌ Primario ${PRIMARIO_ID} no existe`); process.exit(1); }
  const p = primSnap.data();
  console.log(`Primario V-0003: ${p.ticketNum} · ${p.medioPago} · $${p.monto} · cuenta "${p.cuenta}" · turno ${p.turnoId}`);
  if (p.medioPago !== CUENTA_DESTINO) {
    console.error(`❌ El primario tiene medioPago "${p.medioPago}", esperaba "${CUENTA_DESTINO}". Abortando por seguridad.`);
    process.exit(1);
  }

  // 2. Idempotencia: ¿ya hay espejo activo?
  const todos = await lcRef.get();
  const yaEspejo = todos.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(m => m.refMovId === PRIMARIO_ID && m.origen === 'venta_caja_espejo' && !m.eliminado);
  if (yaEspejo.length) {
    console.log(`✅ V-0003 ya tiene espejo activo (${yaEspejo[0].id}). Nada que hacer.`);
    process.exit(0);
  }

  // 3. Copiar cajaOrigen* de otro espejo del mismo turno (estructura idéntica)
  const sample = todos.docs.map(d => d.data())
    .find(m => m.origen === 'venta_caja_espejo' && m.turnoId === p.turnoId && !m.eliminado);
  const cajaOrigenId     = sample ? (sample.cajaOrigenId || '')     : '';
  const cajaOrigenNombre = sample ? (sample.cajaOrigenNombre || 'Caja mostrador') : 'Caja mostrador';

  // 4. Construir el espejo (idéntico a los otros espejos MP del turno)
  const espejo = {
    uid: UID,
    fecha: p.fecha,
    tipo: 'ingreso',
    concepto: p.concepto || 'Venta caja',
    cuenta: CUENTA_DESTINO,
    medioPago: CUENTA_DESTINO,
    monto: p.monto,
    productos: p.productos || [],
    mes: p.mes,
    origen: 'venta_caja_espejo',
    eliminado: false,
    creadoEn: p.creadoEn,                 // mismo instante que el primario (turno cerrado; no inventamos fecha nueva)
    observacion: p.observacion || '',
    turnoId: p.turnoId,
    ticketNum: p.ticketNum,
    refMovId: PRIMARIO_ID,
    creadoPor: p.creadoPor || 'Cajero',
    cajaOrigenId,
    cajaOrigenNombre
  };

  console.log('\n── Espejo a crear ───────────────────────────');
  console.log(JSON.stringify(espejo, null, 1));

  if (DRY_RUN) {
    console.log('\n⚠️  DRY-RUN: no se escribió nada. Corré sin --dry-run para crear.');
    process.exit(0);
  }

  const ref = await lcRef.add(espejo);
  console.log(`\n✅ Espejo creado: ${ref.id}`);
  console.log('   El chip Mercado Pago del dueño debería pasar de $10.800 a $23.800.');
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
