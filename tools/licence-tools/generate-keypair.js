/**
 * Generates an RSA keypair for signing offline licence files (Part 9.9).
 * In a real deployment, the PRIVATE key stays with Borosil and never ships;
 * only the PUBLIC key is baked into the product (backend/licence/public_key.pem).
 * For this dev/local setup both are written here so licences can be issued
 * and tested end-to-end; never ship dev-key.pem in a production image.
 *
 * Usage: node generate-keypair.js
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const outDir = __dirname;
fs.writeFileSync(path.join(outDir, 'dev-private-key.pem'), privateKey);
fs.writeFileSync(path.join(outDir, 'dev-public-key.pem'), publicKey);

console.log('Generated dev-private-key.pem and dev-public-key.pem in', outDir);
console.log('Copy dev-public-key.pem to backend/licence/public_key.pem (baked into the app).');
console.log('Keep dev-private-key.pem OUTSIDE the deployed image -- only used by issue-licence.js.');
