const express    = require('express');
const router     = express.Router();
const pool       = require('../db/database');
const { hashPassword } = require('../services/auth');
const exigerRole = require('../middleware/exigerRole');
const journaliser = require('../middleware/journaliser');

router.use(exigerRole('administrateur'));

// GET /utilisateurs — liste tous les comptes (sans le hash)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nom, email, role, actif, cree_le, derniere_connexion FROM utilisateurs ORDER BY id'
    );
    return res.json(rows);
  } catch (err) {
    console.error('[utilisateurs GET] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// POST /utilisateurs — crée un compte
router.post(
  '/',
  journaliser('creer_utilisateur', req => ({ email: req.body?.email, role: req.body?.role })),
  async (req, res) => {
    const { nom, email, mot_de_passe, role = 'operateur' } = req.body || {};

    if (!nom || !email || !mot_de_passe) {
      return res.status(400).json({ erreur: 'nom, email et mot_de_passe requis.' });
    }
    if (!['operateur', 'administrateur'].includes(role)) {
      return res.status(400).json({ erreur: 'Rôle invalide (operateur | administrateur).' });
    }

    try {
      const { rows: existants } = await pool.query(
        'SELECT id FROM utilisateurs WHERE email = $1', [email]
      );
      if (existants.length > 0) {
        return res.status(409).json({ erreur: 'Email déjà utilisé.' });
      }

      const hash   = hashPassword(mot_de_passe);
      const { rows } = await pool.query(
        'INSERT INTO utilisateurs (nom, email, mot_de_passe_hash, role, actif) VALUES ($1, $2, $3, $4, 1) RETURNING id',
        [nom, email, hash, role]
      );

      return res.status(201).json({
        id: rows[0].id,
        nom, email, role, actif: 1
      });
    } catch (err) {
      console.error('[utilisateurs POST] Erreur:', err.message);
      res.status(500).json({ erreur: 'Erreur serveur.' });
    }
  }
);

// PATCH /utilisateurs/:id/desactiver
router.patch(
  '/:id/desactiver',
  journaliser('desactiver_utilisateur', req => ({ cible_id: req.params.id })),
  async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ erreur: 'id invalide.' });
    }
    if (id === req.utilisateur.id) {
      return res.status(400).json({ erreur: 'Impossible de désactiver son propre compte.' });
    }

    try {
      const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE id = $1', [id]);
      if (rows.length === 0) return res.status(404).json({ erreur: 'Utilisateur introuvable.' });

      await pool.query('UPDATE utilisateurs SET actif = 0 WHERE id = $1', [id]);
      return res.json({ message: 'Compte désactivé.' });
    } catch (err) {
      console.error('[utilisateurs PATCH desactiver] Erreur:', err.message);
      res.status(500).json({ erreur: 'Erreur serveur.' });
    }
  }
);

// PATCH /utilisateurs/:id/role
router.patch(
  '/:id/role',
  journaliser('changer_role', req => ({ cible_id: req.params.id, nouveau_role: req.body?.role })),
  async (req, res) => {
    const id   = parseInt(req.params.id, 10);
    const { role } = req.body || {};

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ erreur: 'id invalide.' });
    }
    if (!['operateur', 'administrateur'].includes(role)) {
      return res.status(400).json({ erreur: 'Rôle invalide (operateur | administrateur).' });
    }

    try {
      const { rows } = await pool.query('SELECT id FROM utilisateurs WHERE id = $1', [id]);
      if (rows.length === 0) return res.status(404).json({ erreur: 'Utilisateur introuvable.' });

      await pool.query('UPDATE utilisateurs SET role = $1 WHERE id = $2', [role, id]);
      return res.json({ message: 'Rôle mis à jour.', role });
    } catch (err) {
      console.error('[utilisateurs PATCH role] Erreur:', err.message);
      res.status(500).json({ erreur: 'Erreur serveur.' });
    }
  }
);

module.exports = router;
