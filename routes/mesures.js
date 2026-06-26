const express      = require('express');
const router       = express.Router();
const pool         = require('../db/database');
const authentifier = require('../middleware/authentifier');
const { detecterAnomalies } = require('../services/anomalies');

// POST /mesures — stocke une mesure
router.post('/', async (req, res) => {
  const { capteur_id, temperature, humidite, qualite_air, timestamp } = req.body;

  if (!capteur_id || temperature == null || humidite == null || qualite_air == null) {
    return res.status(400).json({ erreur: 'Champs obligatoires manquants : capteur_id, temperature, humidite, qualite_air' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO mesures (capteur_id, temperature, humidite, qualite_air, timestamp)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [capteur_id, temperature, humidite, qualite_air, timestamp || new Date().toISOString()]
    );

    // Fire-and-forget : ne bloque pas la réponse
    detecterAnomalies({ capteur_id, temperature })
      .catch(err => console.error('[anomalies] Erreur:', err.message));

    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    console.error('[mesures POST] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /mesures — 100 dernières mesures (authentification requise)
router.get('/', authentifier, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mesures ORDER BY id DESC LIMIT 100'
    );
    res.json(rows.reverse());
  } catch (err) {
    console.error('[mesures GET] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /mesures/stats — min/max/moyenne sur les 5 dernières minutes (authentification requise)
router.get('/stats', authentifier, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)           AS total,
        MIN(temperature)   AS temp_min,
        MAX(temperature)   AS temp_max,
        AVG(temperature)   AS temp_moy,
        MIN(humidite)      AS hum_min,
        MAX(humidite)      AS hum_max,
        AVG(humidite)      AS hum_moy,
        MIN(qualite_air)   AS air_min,
        MAX(qualite_air)   AS air_max,
        AVG(qualite_air)   AS air_moy
      FROM mesures
      WHERE recu_le >= NOW() - INTERVAL '5 minutes'
    `);
    res.json(rows[0]);
  } catch (err) {
    console.error('[mesures stats] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
