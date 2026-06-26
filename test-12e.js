const auth = require('./services/auth');
const db = require('./db/database');

async function runTests() {
  // S'assurer qu'un compte opérateur existe pour le test
  let opUser = db.prepare('SELECT * FROM utilisateurs WHERE email = ?').get('operateur@test.local');
  if (!opUser) {
    const hash = auth.hashPassword('Op1234!');
    const info = db.prepare('INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, role, actif) VALUES (?, ?, ?, ?, 1)').run('Opérateur', 'operateur@test.local', hash, 'operateur');
    opUser = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(info.lastInsertRowid);
  }

  const adminUser = db.prepare('SELECT * FROM utilisateurs WHERE role = ?').get('administrateur');

  const opToken = auth.generateToken(opUser);
  const adminToken = auth.generateToken(adminUser);

  console.log('=== RÉSULTATS DES TESTS DE PROTECTION DES ROUTES ===\n');

  // Test 1: GET /mesures sans token -> 401
  const res1 = await fetch('http://localhost:3000/mesures');
  const txt1 = await res1.text();
  console.log(`[TEST 1] GET /mesures sans token`);
  console.log(`Résultat : HTTP ${res1.status} (attendu: 401)`);
  console.log(`Corps : ${txt1}\n`);

  // Test 2: GET /mesures avec token operateur -> 200
  const res2 = await fetch('http://localhost:3000/mesures', {
    headers: { 'Authorization': `Bearer ${opToken}` }
  });
  // On ne lit pas tout le JSON pour ne pas polluer, juste le statut
  console.log(`[TEST 2] GET /mesures avec token operateur`);
  console.log(`Résultat : HTTP ${res2.status} (attendu: 200)\n`);

  // Test 3: GET /rapport/pdf avec token operateur -> 403
  const res3 = await fetch('http://localhost:3000/rapport/pdf', {
    headers: { 'Authorization': `Bearer ${opToken}` }
  });
  const txt3 = await res3.text();
  console.log(`[TEST 3] GET /rapport/pdf avec token operateur`);
  console.log(`Résultat : HTTP ${res3.status} (attendu: 403)`);
  console.log(`Corps : ${txt3}\n`);

  // Test 4: GET /rapport/pdf avec token admin -> 200
  const res4 = await fetch('http://localhost:3000/rapport/pdf?periode=24h', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log(`[TEST 4] GET /rapport/pdf avec token admin`);
  console.log(`Résultat : HTTP ${res4.status} (attendu: 200)\n`);

  console.log('=== FIN DES TESTS ===');
  process.exit(0);
}

// On attend 2s que le serveur démarre avant de lancer les tests
setTimeout(runTests, 2000);
