const express     = require('express');
const router      = express.Router();
const pool        = require('../db/database');
const exigerRole  = require('../middleware/exigerRole');
const journaliser = require('../middleware/journaliser');

router.use(exigerRole('administrateur'));

// GET /export/csv?periode=24h|7j
router.get(
  '/csv',
  journaliser('export_csv', req => ({ periode: req.query.periode })),
  async (req, res) => {
    try {
      const intervalle = req.query.periode === '7j' ? '7 days' : '1 day';

      const { rows } = await pool.query(
        `SELECT * FROM mesures WHERE recu_le >= NOW() - ($1::text || ' days')::interval ORDER BY recu_le ASC`,
        [req.query.periode === '7j' ? '7' : '1']
      );

      const colonnes = ['id', 'capteur_id', 'temperature', 'humidite', 'qualite_air', 'timestamp', 'recu_le'];

      const echapper = (val) => {
        if (val === null || val === undefined) return '';
        const s = String(val);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const lignes = [
        colonnes.join(','),
        ...rows.map(r => colonnes.map(c => echapper(r[c])).join(',')),
      ];

      const date = new Date().toISOString().substring(0, 10);
      const nom  = `mesures_${req.query.periode || '24h'}_${date}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
      return res.send(lignes.join('\r\n'));
    } catch (err) {
      console.error('[export csv] Erreur:', err.message);
      res.status(500).json({ erreur: 'Erreur serveur.' });
    }
  }
);

module.exports = router;
