const express = require('express');
const router  = express.Router();
const pool    = require('../db/database');

// GET /stats/zones — min/max/moyenne par zone sur les 5 dernières minutes
router.get('/zones', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        capteur_id,
        COUNT(*)         AS total,
        MIN(temperature) AS temp_min,
        MAX(temperature) AS temp_max,
        AVG(temperature) AS temp_moy,
        MIN(humidite)    AS hum_min,
        MAX(humidite)    AS hum_max,
        AVG(humidite)    AS hum_moy,
        AVG(qualite_air) AS air_moy
      FROM mesures
      WHERE recu_le >= NOW() - INTERVAL '5 minutes'
      GROUP BY capteur_id
      ORDER BY capteur_id ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[stats zones] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /stats/anomalies — histogramme des alertes par heure sur les 24 dernières heures
router.get('/anomalies', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        to_char(date_trunc('hour', cree_le), 'YYYY-MM-DD HH24:00') AS heure,
        type_anomalie,
        COUNT(*) AS total
      FROM alertes
      WHERE cree_le >= NOW() - INTERVAL '24 hours'
      GROUP BY date_trunc('hour', cree_le), type_anomalie
      ORDER BY date_trunc('hour', cree_le) ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('[stats anomalies] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
