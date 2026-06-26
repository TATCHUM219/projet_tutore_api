const express = require('express');
const router  = require('express').Router();
const pool    = require('../db/database');

const INSTANCE_ID = process.env.INSTANCE_ID || 'api-01';
const PORT        = process.env.PORT || 3000;
const startedAt   = new Date().toISOString();

// GET /health
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM mesures');
    res.json({
      statut: 'ok',
      instance: INSTANCE_ID,
      port: Number(PORT),
      timestamp: new Date().toISOString(),
      demarre_le: startedAt,
      mesures_stockees: rows[0].total,
    });
  } catch (err) {
    res.status(503).json({ statut: 'erreur', detail: err.message });
  }
});

module.exports = router;
