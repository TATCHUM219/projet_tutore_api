const pool                  = require('../db/database');
const { genererRecommandation } = require('./recommandations');
const { envoyerAlerteEmail }    = require('./email');

// Lecture des seuils dynamiques depuis la table config (async)
async function lireSeuil(cle, defaut) {
  const { rows } = await pool.query('SELECT valeur FROM config WHERE cle = $1', [cle]);
  return rows[0] ? parseFloat(rows[0].valeur) : defaut;
}

// Capteurs dont on a déjà reçu au moins une mesure — pour détecter les silences
const derniereReception = new Map();

// Intervalle de vérification des capteurs morts (toutes les 30s)
setInterval(async () => {
  try { await verifierCapteursMorts(); }
  catch (e) { console.error('[anomalies] setInterval error:', e.message); }
}, 30_000);

async function detecterAnomalies(mesure) {
  const { capteur_id, temperature } = mesure;
  derniereReception.set(capteur_id, Date.now());

  const { rows: historique } = await pool.query(
    `SELECT temperature FROM mesures
     WHERE capteur_id = $1
     ORDER BY id DESC
     LIMIT 20`,
    [capteur_id]
  );

  // Pas assez d'historique pour calculer des statistiques fiables
  if (historique.length < 5) return;

  const valeurs  = historique.map(r => r.temperature);
  const moyenne  = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
  const variance = valeurs.reduce((s, v) => s + (v - moyenne) ** 2, 0) / valeurs.length;
  const ecartType = Math.sqrt(variance);

  // Détection pic : valeur > moyenne + seuil_sigma × écart-type (dynamique)
  const sigma = await lireSeuil('seuil_sigma', 2.5);
  if (ecartType > 0 && temperature > moyenne + sigma * ecartType) {
    await insererAlerte({
      capteur_id,
      type_anomalie: 'pic',
      valeur_declenchante: temperature,
      valeur_normale: round2(moyenne),
      message: `Pic thermique détecté : ${temperature}°C (normale ≈ ${round2(moyenne)}°C, seuil = ${round2(moyenne + sigma * ecartType)}°C)`,
    });
    return;
  }

  // Détection dérive : hausse constante > seuil_derive_par_mesure°C/mesure (dynamique)
  const seuilDerive = await lireSeuil('seuil_derive_par_mesure', 0.5);
  const dix = valeurs.slice(0, 10);
  if (dix.length === 10) {
    let derive = true;
    for (let i = 0; i < dix.length - 1; i++) {
      // historique trié DESC : dix[i] est plus récent que dix[i+1]
      if (dix[i] - dix[i + 1] < seuilDerive) {
        derive = false;
        break;
      }
    }
    if (derive) {
      await insererAlerte({
        capteur_id,
        type_anomalie: 'derive',
        valeur_declenchante: temperature,
        valeur_normale: round2(dix[dix.length - 1]),
        message: `Dérive thermique progressive : montée de ${round2(dix[0] - dix[dix.length - 1])}°C sur les 10 dernières mesures`,
      });
    }
  }
}

async function verifierCapteursMorts() {
  const maintenant = Date.now();
  const seuilMs    = (await lireSeuil('seuil_capteur_mort_secondes', 60)) * 1000;

  for (const [capteur_id, dernierTs] of derniereReception.entries()) {
    const silenceMs = maintenant - dernierTs;
    if (silenceMs > seuilMs) {
      const { rows } = await pool.query(
        `SELECT id FROM alertes
         WHERE capteur_id = $1 AND type_anomalie = 'capteur_mort' AND statut = 'active'
           AND cree_le >= NOW() - INTERVAL '2 minutes'`,
        [capteur_id]
      );
      if (rows.length === 0) {
        await insererAlerte({
          capteur_id,
          type_anomalie: 'capteur_mort',
          valeur_declenchante: null,
          valeur_normale: null,
          message: `Capteur hors ligne depuis ${Math.round(silenceMs / 1000)}s — aucune donnée reçue`,
        });
      }
    }
  }
}

async function insererAlerte({ capteur_id, type_anomalie, valeur_declenchante, valeur_normale, message }) {
  // Dédoublonnage : pas deux alertes du même type actives en moins de 60s
  const { rows: doublons } = await pool.query(
    `SELECT id FROM alertes
     WHERE capteur_id = $1 AND type_anomalie = $2 AND statut = 'active'
       AND cree_le >= NOW() - INTERVAL '1 minute'`,
    [capteur_id, type_anomalie]
  );
  if (doublons.length > 0) return;

  const { recommandation, priorite, delai_action } = genererRecommandation({ capteur_id, type_anomalie });

  await pool.query(
    `INSERT INTO alertes
       (capteur_id, type_anomalie, valeur_declenchante, valeur_normale, message, recommandation, priorite, delai_action)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [capteur_id, type_anomalie, valeur_declenchante ?? null, valeur_normale ?? null,
     message, recommandation, priorite, delai_action]
  );

  console.log(`[ALERTE] ${type_anomalie.toUpperCase()} | ${capteur_id} | priorité=${priorite} | ${message}`);

  envoyerAlerteEmail({ capteur_id, type_anomalie, message, recommandation, priorite, valeur_declenchante, valeur_normale })
    .catch(err => console.error('[email] Erreur inattendue:', err.message));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

module.exports = { detecterAnomalies };
