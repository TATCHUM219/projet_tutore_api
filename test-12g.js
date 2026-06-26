const auth = require('./services/auth');
const email = require('./services/email');
const db = require('./db/database');
const { detecterAnomalies } = require('./services/anomalies');

async function runTests() {
  console.log('=== TEST 12g: ENVOI OTP ===\n');
  
  // 1. Simuler un login réel
  let adminUser = db.prepare('SELECT * FROM utilisateurs WHERE email = ?').get('admin@datacenter.local');
  if (!adminUser) {
     adminUser = { id: 1, email: 'admin@datacenter.local', nom: 'Admin' };
  }
  
  const codeClair = auth.creerOTP(adminUser.id);
  await email.envoyerCodeOTP(adminUser, codeClair);

  console.log('\n=== TEST 12g: ALERTE HAUTE & ANTI-SPAM ===\n');
  
  // 2. Vider les emails envoyés et alertes précédentes pour avoir un état propre
  db.prepare('DELETE FROM emails_envoyes').run();
  db.prepare('DELETE FROM alertes').run();

  // On simule une mesure aberrante pour forcer une alerte de type "pic"
  // (Il faut d'abord injecter de l'historique normal pour que la variance soit faible)
  for(let i=0; i<10; i++) {
    db.prepare('INSERT INTO mesures (capteur_id, temperature, humidite) VALUES (?, ?, ?)').run('zone-A', 22.0, 50.0);
  }

  console.log('-- 1ère alerte (doit envoyer un email) --');
  // Température énorme = anomalie pic -> priorité haute
  detecterAnomalies({ capteur_id: 'zone-A', temperature: 80.0, humidite: 50.0 });
  
  // On attend un peu pour laisser la DB et les promesses s'exécuter
  await new Promise(r => setTimeout(r, 500));

  console.log('\n-- 2ème alerte identique (doit être ignorée par l\'anti-spam) --');
  // On bypass la protection "1 alerte / minute" des alertes elle-même pour forcer l'email anti-spam:
  // (en modifiant la date de la première alerte)
  db.prepare("UPDATE alertes SET cree_le = datetime('now', '-2 minutes')").run();
  
  detecterAnomalies({ capteur_id: 'zone-A', temperature: 85.0, humidite: 50.0 });

  await new Promise(r => setTimeout(r, 500));
  console.log('\n=== FIN DES TESTS ===');
  process.exit(0);
}

runTests();
