'use strict';
/**
 * Sube cert y key de AFIP a Firestore (collection: config, doc: afip).
 * Necesario porque las env vars de Netlify Lambda tienen límite de 4KB.
 *
 * Uso:
 *   node scripts/upload-afip-config.js [cert-path] [key-path]
 *
 * Defaults:
 *   cert-path = ~/mbstrategy.crt
 *   key-path  = ~/mbstrategy.key
 *
 * Requiere variable de entorno FIREBASE_SERVICE_ACCOUNT con el JSON del
 * service account (mismo que usa Netlify), o un archivo serviceAccountKey.json
 * en la raíz del proyecto.
 *
 * Ejemplo:
 *   export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
 *   node scripts/upload-afip-config.js ~/mbstrategy.crt ~/mbstrategy.key
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  try {
    const home = os.homedir();
    const certPath = process.argv[2] || path.join(home, 'mbstrategy.crt');
    const keyPath = process.argv[3] || path.join(home, 'mbstrategy.key');

    if (!fs.existsSync(certPath)) {
      console.error('✗ No se encontró el cert en:', certPath);
      process.exit(1);
    }
    if (!fs.existsSync(keyPath)) {
      console.error('✗ No se encontró la key en:', keyPath);
      process.exit(1);
    }

    const cert = fs.readFileSync(certPath, 'utf8');
    const key = fs.readFileSync(keyPath, 'utf8');

    if (!cert.includes('BEGIN CERTIFICATE')) {
      console.error('✗ El cert no parece un certificado PEM válido');
      process.exit(1);
    }
    if (!key.includes('BEGIN') || !key.includes('PRIVATE KEY')) {
      console.error('✗ La key no parece una private key PEM válida');
      process.exit(1);
    }

    await db.collection('config').doc('afip').set({
      cert,
      key,
      cuit: process.env.AFIP_CUIT || null,
      actualizadoEn: new Date().toISOString()
    });

    console.log('✓ Cert y key subidos a Firestore: config/afip');
    console.log('  Cert size:', cert.length, 'bytes');
    console.log('  Key size: ', key.length, 'bytes');
    console.log('');
    console.log('IMPORTANTE: verificá que firestore.rules NO permita lectura/escritura');
    console.log('de config/afip desde el cliente (solo Admin SDK).');
    process.exit(0);
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  }
})();
