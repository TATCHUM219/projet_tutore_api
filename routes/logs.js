const express    = require('express');
const router     = express.Router();
const pool       = require('../db/database');
const exigerRole = require('../middleware/exigerRole');

router.use(exigerRole('administrateur'));

// GET /logs?page=1&limite=50
router.get('/', async (req, res) => {
  const limite = Math.min(Math.max(parseInt(req.query.limite) || 50, 1), 200);
  const page   = Math.max(parseInt(req.query.page) || 1, 1);
  const offset = (page - 1) * limite;

  try {
    const { rows: rTotal } = await pool.query('SELECT COUNT(*)::int AS n FROM logs_activite');
    const total = rTotal[0].n;

    const { rows: logs } = await pool.query(
      'SELECT * FROM logs_activite ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
      [limite, offset]
    );

    return res.json({ total, page, limite, logs });
  } catch (err) {
    console.error('[logs GET] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
