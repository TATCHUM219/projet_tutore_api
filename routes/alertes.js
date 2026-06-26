const express = require('express');
const router  = express.Router();
const pool    = require('../db/database');

// GET /alertes — toutes les alertes actives, plus récentes en premier
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM alertes WHERE statut = 'active' ORDER BY cree_le DESC, id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('[alertes GET] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /alertes/historique — 50 dernières alertes (toutes statuts confondus)
router.get('/historique', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM alertes ORDER BY cree_le DESC, id DESC LIMIT 50'
    );
    res.json(rows);
  } catch (err) {
    console.error('[alertes historique] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /alertes/stats — synthèse par type, par zone, et comparatif jour
router.get('/stats', async (req, res) => {
  try {
    const { rows: parType } = await pool.query(
      `SELECT type_anomalie, COUNT(*) AS total
       FROM alertes GROUP BY type_anomalie ORDER BY total DESC`
    );

    const { rows: parZone } = await pool.query(
      `SELECT capteur_id, COUNT(*) AS total
       FROM alertes GROUP BY capteur_id ORDER BY total DESC`
    );

    const { rows: rAujourd } = await pool.query(
      `SELECT COUNT(*) AS total FROM alertes WHERE cree_le::date = CURRENT_DATE`
    );

    const { rows: rHier } = await pool.query(
      `SELECT COUNT(*) AS total FROM alertes WHERE cree_le::date = CURRENT_DATE - 1`
    );

    const { rows: rActives } = await pool.query(
      `SELECT COUNT(*) AS total FROM alertes WHERE statut = 'active'`
    );

    res.json({
      actives:    parseInt(rActives[0].total),
      par_type:   parType.map(r => ({ ...r, total: parseInt(r.total) })),
      par_zone:   parZone.map(r => ({ ...r, total: parseInt(r.total) })),
      aujourdhui: parseInt(rAujourd[0].total),
      hier:       parseInt(rHier[0].total),
    });
  } catch (err) {
    console.error('[alertes stats] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// PATCH /alertes/:id/acquitter — marque comme acquittée
router.patch('/:id/acquitter', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ erreur: 'id invalide' });
  }

  try {
    const result = await pool.query(
      `UPDATE alertes SET statut = 'acquittee', acquittee_le = NOW()
       WHERE id = $1 AND statut = 'active'`,
      [id]
    );

    if (result.rowCount === 0) {
      const { rows } = await pool.query(
        'SELECT id, statut FROM alertes WHERE id = $1', [id]
      );
      if (rows.length === 0) return res.status(404).json({ erreur: 'alerte introuvable' });
      return res.status(409).json({ erreur: `alerte déjà ${rows[0].statut}` });
    }

    const { rows } = await pool.query('SELECT * FROM alertes WHERE id = $1', [id]);
    res.json(rows[0]);
  } catch (err) {
    console.error('[alertes acquitter] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
