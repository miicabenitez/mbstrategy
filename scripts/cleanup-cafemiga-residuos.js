'use strict';
/**
 * Limpieza de residuos de Café Miga (borrado incompleto): doc shell + subcolecciones huérfanas +
 * top-level filtrados por uid + pendientes colgados. NO toca Olivia (uid distinto).
 *
 * Contrato "eliminar cliente de verdad": subcols + doc + top-level (cierres/cobros/configuracionCierre) + Auth + preapproval MP.
 * (Auth y preapproval MP se hacen aparte: la preapproval e5a84b91… la cancela Mica en el panel.)
 *
 * Dry-run por defecto (solo lista). --apply para borrar.
 *   node scripts/cleanup-cafemiga-residuos.js            (dry-run, lista todo)
 *   node scripts/cleanup-cafemiga-residuos.js --apply    (borra)
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const CAFE_MIGA = 'xypeb5lnRmP07QErFBSDOhYasfP2';  // uid viejo (residuo)
const OLIVIA    = 'YEYAZlTjG5NMZTOoQWgBj71H6Fn2';  // NO tocar
const PENDIENTES_BORRAR = ['E3GOfrNg2V5ukPc4pW8u', '8PQeQaCOA9C4Ef57OYj8', 'aFsLimSzTNWtSHqZAXLt'];

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
else { const p = path.join(__dirname,'..','serviceAccountKey.json'); if(!fs.existsSync(p)){console.error('Falta service account');process.exit(1);} serviceAccount = require(p); }
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  console.log(`\n=== Limpieza residuos Café Miga (uid ${CAFE_MIGA}) ===`);
  console.log(`Modo: ${APPLY ? 'APLICAR (BORRA)' : 'DRY-RUN (solo lista)'}\n`);

  // Guard de seguridad
  if (CAFE_MIGA === OLIVIA) { console.error('❌ ABORT: uid a borrar == Olivia'); process.exit(1); }
  const oliviaOk = (await db.collection('clientes').doc(OLIVIA).get()).exists;
  console.log(`  [guard] Olivia (${OLIVIA}) intacta: ${oliviaOk ? 'sí ✓' : '❌ NO EXISTE'}\n`);

  const cmRef = db.collection('clientes').doc(CAFE_MIGA);
  let totalDocs = 0;

  // 1) Subcolecciones
  console.log(`1) Subcolecciones de clientes/${CAFE_MIGA}:`);
  const subs = await cmRef.listCollections();
  for (const s of subs) { const n = (await s.count().get()).data().count; totalDocs += n; console.log(`   - ${s.id.padEnd(22)} ${n} doc(s)`); }
  console.log(`   → ${subs.length} subcolecciones, ${totalDocs} docs`);

  // 2) Doc shell
  const shell = await cmRef.get();
  console.log(`\n2) Doc shell clientes/${CAFE_MIGA}: existe=${shell.exists} (campos: ${shell.exists?Object.keys(shell.data()||{}).length:0})`);

  // 3) Top-level filtrados por uid
  console.log(`\n3) Top-level filtrados por uid:`);
  for (const col of ['cierres','cobros','configuracionCierre']) {
    try { const q = await db.collection(col).where('uid','==',CAFE_MIGA).get();
      console.log(`   - ${col.padEnd(20)} ${q.size} doc(s)${q.size?': '+q.docs.map(d=>d.id).join(', '):''}`);
    } catch(e){ console.log(`   - ${col}: (${e.message})`); }
  }

  // 4) Pendientes colgados
  console.log(`\n4) pendientes_suscripcion a borrar (${PENDIENTES_BORRAR.length}):`);
  for (const id of PENDIENTES_BORRAR) {
    const d = await db.collection('pendientes_suscripcion').doc(id).get();
    const p = d.exists ? d.data() : null;
    console.log(`   - ${id}: ${d.exists?`email=${p.email} plan=${p.plan} estado=${p.estado} uid=${p.uid||'—'}`:'NO EXISTE'}`);
    if (p && p.uid === OLIVIA) { console.error('   ❌ ABORT: ese pendiente es de Olivia!'); process.exit(1); }
  }

  if (!APPLY) { console.log(`\n⚠️  DRY-RUN: no se borró nada. Revisá la lista y corré con --apply para borrar.`); process.exit(0); }

  // ── BORRADO REAL ──
  console.log(`\n=== BORRANDO ===`);
  await db.recursiveDelete(cmRef);   // doc + TODAS las subcolecciones
  console.log(`  ✓ doc + subcolecciones borrados`);
  for (const col of ['cierres','cobros','configuracionCierre']) {
    const q = await db.collection(col).where('uid','==',CAFE_MIGA).get();
    for (const d of q.docs) { await d.ref.delete(); console.log(`  ✓ ${col}/${d.id} borrado`); }
  }
  for (const id of PENDIENTES_BORRAR) { await db.collection('pendientes_suscripcion').doc(id).delete().catch(()=>{}); console.log(`  ✓ pendiente ${id} borrado`); }
  console.log(`\n✅ Limpieza completa. (Recordá: Auth del uid viejo + cancelar preapproval e5a84b91… en MP van aparte.)`);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.stack); process.exit(1); });
