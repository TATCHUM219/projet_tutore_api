const express     = require('express');
const router      = express.Router();
const pool        = require('../db/database');
const exigerRole  = require('../middleware/exigerRole');
const journaliser = require('../middleware/journaliser');

const CLES_AUTORISEES = [
  'seuil_sigma',
  'seuil_derive_par_mesure',
  'seuil_capteur_mort_secondes',
  'email_fenetre_anti_spam_minutes',
  'otp_duree_minutes',
  'otp_max_tentatives',
];

router.use(exigerRole('administrateur'));

// GET /config/seuils — retourne toutes les clés de configuration
router.get('/seuils', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT cle, valeur FROM config ORDER BY cle');
    const seuils = {};
    for (const { cle, valeur } of rows) {
      const num = parseFloat(valeur);
      seuils[cle] = isNaN(num) ? valeur : num;
    }
    return res.json(seuils);
  } catch (err) {
    console.error('[config seuils GET] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// PUT /config/seuils — met à jour une ou plusieurs clés
router.put(
  '/seuils',
  journaliser('modifier_config', req => ({ modifications: req.body })),
  async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ erreur: 'Corps JSON attendu.' });
    }

    const mises_a_jour = [];
    const ignorees = [];

    try {
      for (const [cle, valeur] of Object.entries(req.body)) {
        if (!CLES_AUTORISEES.includes(cle)) {
          ignorees.push(cle);
          continue;
        }
        const val = String(parseFloat(valeur));
        if (val === 'NaN') {
          return res.status(400).json({ erreur: `Valeur numérique requise pour "${cle}".` });
        }
        await pool.query(
          "UPDATE config SET valeur = $1, modifie_le = NOW() WHERE cle = $2",
          [val, cle]
        );
        mises_a_jour.push(cle);
      }
      return res.json({ mises_a_jour, ignorees });
    } catch (err) {
      console.error('[config seuils PUT] Erreur:', err.message);
      res.status(500).json({ erreur: 'Erreur serveur.' });
    }
  }
);

module.exports = router;
