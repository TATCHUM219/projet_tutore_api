/**
 * api/db/init.js
 * Initialise la base PostgreSQL au démarrage :
 *   1. Crée les tables si elles n'existent pas (schema.sql)
 *   2. Insère les valeurs de config par défaut
 *   3. Crée le compte admin initial si la table est vide
 */

const pool    = require('./database');
const fs      = require('fs');
const path    = require('path');
const bcryptjs = require('bcryptjs');

async function initialiserDB() {
  // ── 1. Création des tables ──────────────────────────────────────────────────
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[DB] Tables vérifiées / créées.');

  // ── 2. Valeurs de configuration par défaut ──────────────────────────────────
  const configDefauts = [
    ['seuil_sigma',                    '2.5'],
    ['seuil_derive_par_mesure',        '0.5'],
    ['seuil_capteur_mort_secondes',    '60'],
    ['email_fenetre_anti_spam_minutes','10'],
    ['otp_duree_minutes',              '5'],
    ['otp_max_tentatives',             '3'],
  ];

  for (const [cle, valeur] of configDefauts) {
    await pool.query(
      'INSERT INTO config (cle, valeur) VALUES ($1, $2) ON CONFLICT (cle) DO NOTHING',
      [cle, valeur]
    );
  }
  console.log('[DB] Configuration par défaut initialisée.');

  // ── 3. Seed : compte administrateur par défaut ──────────────────────────────
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM utilisateurs');
  if (rows[0].n === 0) {
    const hash = bcryptjs.hashSync('Admin1234!', 10);
    await pool.query(
      'INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, role, actif) VALUES ($1, $2, $3, $4, $5)',
      ['Administrateur', 'admin@datacenter.local', hash, 'administrateur', 1]
    );
    console.log('[DB] Seed : compte admin créé — admin@datacenter.local / Admin1234!');
  }

  console.log('[DB] Base de données prête.');
}

module.exports = { initialiserDB };
