// Script de validation des sous-étapes 12a et 12b
// Usage : node --no-warnings test-12ab.js

const db   = require('./db/database');
const auth = require('./services/auth');

let ok = 0;
let ko = 0;
function assert(label, condition) {
  if (condition) { console.log(`  ✅  ${label}`); ok++; }
  else           { console.error(`  ❌  ${label}`); ko++; }
}

// ─────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  TEST 12a — Base de données');
console.log('══════════════════════════════════════════\n');

// Tables attendues
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all().map(r => r.name);
console.log('Tables présentes :', tables.join(', '), '\n');

for (const t of ['utilisateurs','config','logs_activite','emails_envoyes','codes_otp']) {
  assert(`Table "${t}" existe`, tables.includes(t));
}

// Compte admin seedé
const admin = db.prepare("SELECT * FROM utilisateurs WHERE email = ?")
  .get('admin@datacenter.local');
assert('Compte admin présent (admin@datacenter.local)', !!admin);
assert('Rôle = administrateur', admin?.role === 'administrateur');
assert('Compte actif',          admin?.actif === 1);
assert('Hash non vide',         typeof admin?.mot_de_passe_hash === 'string' && admin.mot_de_passe_hash.length > 0);

// Config OTP seedée
const otpDuree = db.prepare("SELECT valeur FROM config WHERE cle = 'otp_duree_minutes'").get();
const otpTent  = db.prepare("SELECT valeur FROM config WHERE cle = 'otp_max_tentatives'").get();
assert('Config otp_duree_minutes = 5',    otpDuree?.valeur === '5');
assert('Config otp_max_tentatives = 3',   otpTent?.valeur  === '3');

const configRows = db.prepare("SELECT cle, valeur FROM config ORDER BY cle").all();
console.log('\nTable config :');
console.table(configRows);

// ─────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  TEST 12b — Service auth');
console.log('══════════════════════════════════════════\n');

// verifyPassword
assert('verifyPassword(mot de passe correct)',  auth.verifyPassword('Admin1234!', admin.mot_de_passe_hash));
assert('verifyPassword(mot de passe erroné)',   !auth.verifyPassword('mauvais', admin.mot_de_passe_hash));

// generateToken / verifyToken
const token   = auth.generateToken(admin);
const decoded = auth.verifyToken(token);
assert('generateToken produit un string',       typeof token === 'string' && token.length > 20);
assert('verifyToken restitue email + rôle',
  decoded.email === admin.email && decoded.role === admin.role);
assert('verifyToken restitue id correct',       decoded.id === admin.id);

// Token invalide
let tokenRefuse = false;
try { auth.verifyToken('token.invalide.xxx'); }
catch { tokenRefuse = true; }
assert('verifyToken rejette un token invalide', tokenRefuse);

// genererCodeOTP : format
const code1 = auth.genererCodeOTP();
const code2 = auth.genererCodeOTP();
assert('genererCodeOTP produit 6 chiffres',     /^\d{6}$/.test(code1));
assert('genererCodeOTP est aléatoire',          code1 !== code2);

// creerOTP : cycle complet
const codeClair = auth.creerOTP(admin.id);
const otpRow = db.prepare(
  "SELECT * FROM codes_otp WHERE utilisateur_id = ? AND utilise = 0 ORDER BY id DESC LIMIT 1"
).get(admin.id);

assert('creerOTP stocke une ligne dans codes_otp',  !!otpRow);
assert('code en clair = 6 chiffres',                /^\d{6}$/.test(codeClair));
assert('code_hash non vide',                        otpRow?.code_hash?.length > 0);
assert('expire_le renseigné',                       !!otpRow?.expire_le);
assert('utilise = 0 (non consommé)',                otpRow?.utilise === 0);

// verifyOTP
assert('verifyOTP(code correct)  → true',   auth.verifyOTP(codeClair, otpRow.code_hash));
assert('verifyOTP("000000" faux) → false',  !auth.verifyOTP('000000', otpRow.code_hash));

// Invalidation des anciens OTP à la création d'un nouveau
auth.creerOTP(admin.id);
const ancienOtp = db.prepare(
  "SELECT utilise FROM codes_otp WHERE id = ?"
).get(otpRow.id);
assert('Ancien OTP invalidé après création d\'un nouveau', ancienOtp?.utilise === 1);

console.log(`\n══════════════════════════════════════════`);
console.log(`  Résultat : ${ok} ✅  |  ${ko} ❌`);
console.log(`══════════════════════════════════════════\n`);
process.exit(ko > 0 ? 1 : 0);
