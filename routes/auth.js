const express    = require('express');
const router     = express.Router();
const pool       = require('../db/database');
const auth       = require('../services/auth');
const authentifier = require('../middleware/authentifier');
const emailService = require('../services/email');

// ── POST /auth/login — Étape 1 : vérification identifiants + envoi OTP ──────

router.post('/login', async (req, res) => {
  const { email, mot_de_passe } = req.body;

  if (!email || !mot_de_passe) {
    return res.status(400).json({ erreur: 'Email et mot de passe requis.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM utilisateurs WHERE email = $1', [email]
    );
    const utilisateur = rows[0];

    if (!utilisateur || !auth.verifyPassword(mot_de_passe, utilisateur.mot_de_passe_hash)) {
      return res.status(401).json({ erreur: 'Identifiants incorrects.' });
    }

    if (!utilisateur.actif) {
      return res.status(403).json({ erreur: 'Compte désactivé. Contactez un administrateur.' });
    }

    const codeClair = await auth.creerOTP(utilisateur.id);

    emailService.envoyerCodeOTP(utilisateur, codeClair)
      .catch(err => console.error(err));
    console.log(`[OTP] Code pour ${utilisateur.email} : ${codeClair} (expire dans 5 min)`);

    const loginToken = auth.generateToken(
      { id: utilisateur.id, email: utilisateur.email, role: utilisateur.role },
      { expiresIn: '5m', subject: 'pre_auth' }
    );

    return res.json({ etape: 'otp_requis', login_token: loginToken });
  } catch (err) {
    console.error('[auth login] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// ── POST /auth/verify-otp — Étape 2 : vérification OTP → JWT final ──────────

router.post('/verify-otp', async (req, res) => {
  const { login_token, code } = req.body;

  if (!login_token || !code) {
    return res.status(400).json({ erreur: 'login_token et code requis.' });
  }

  let payload;
  try {
    payload = auth.verifyToken(login_token);
  } catch {
    return res.status(401).json({ erreur: 'login_token invalide ou expiré. Reconnectez-vous.' });
  }

  if (payload.sub !== 'pre_auth') {
    return res.status(401).json({ erreur: 'Token invalide pour cette opération.' });
  }

  try {
    const { rows: otpRows } = await pool.query(
      'SELECT * FROM codes_otp WHERE utilisateur_id = $1 AND utilise = 0 ORDER BY id DESC LIMIT 1',
      [payload.id]
    );
    const otpRow = otpRows[0];

    if (!otpRow) {
      return res.status(401).json({ erreur: 'Aucun code OTP actif. Recommencez la connexion.' });
    }

    // Expiration : PostgreSQL retourne un objet Date directement
    const maintenant = Date.now();
    const expiration = new Date(otpRow.expire_le).getTime();
    if (maintenant > expiration) {
      await pool.query('UPDATE codes_otp SET utilise = 1 WHERE id = $1', [otpRow.id]);
      return res.status(401).json({ erreur: 'Code OTP expiré. Utilisez /auth/resend-otp.' });
    }

    const { rows: cfgRows } = await pool.query(
      "SELECT valeur FROM config WHERE cle = 'otp_max_tentatives'"
    );
    const maxTentatives = cfgRows[0] ? parseInt(cfgRows[0].valeur, 10) : 3;

    if (otpRow.tentatives >= maxTentatives) {
      await pool.query('UPDATE codes_otp SET utilise = 1 WHERE id = $1', [otpRow.id]);
      return res.status(429).json({ erreur: 'Trop de tentatives. Recommencez la connexion.' });
    }

    if (!auth.verifyOTP(code, otpRow.code_hash)) {
      const nouvellesTentatives = otpRow.tentatives + 1;
      await pool.query(
        'UPDATE codes_otp SET tentatives = $1 WHERE id = $2',
        [nouvellesTentatives, otpRow.id]
      );

      if (nouvellesTentatives >= maxTentatives) {
        await pool.query('UPDATE codes_otp SET utilise = 1 WHERE id = $1', [otpRow.id]);
        return res.status(429).json({ erreur: 'Trop de tentatives. Recommencez la connexion.' });
      }

      const restantes = maxTentatives - nouvellesTentatives;
      return res.status(401).json({
        erreur: `Code incorrect. ${restantes} tentative(s) restante(s).`
      });
    }

    // Code correct : marquer consommé
    await pool.query('UPDATE codes_otp SET utilise = 1 WHERE id = $1', [otpRow.id]);
    await pool.query(
      'UPDATE utilisateurs SET derniere_connexion = NOW() WHERE id = $1', [payload.id]
    );
    await pool.query(
      'INSERT INTO logs_activite (utilisateur_id, utilisateur_email, action, ip) VALUES ($1, $2, $3, $4)',
      [payload.id, payload.email, 'connexion', req.ip || req.socket?.remoteAddress || '']
    );

    const { rows: userRows } = await pool.query(
      'SELECT id, email, role FROM utilisateurs WHERE id = $1', [payload.id]
    );
    const utilisateur = userRows[0];
    const token = auth.generateToken(utilisateur);

    return res.json({ token, role: utilisateur.role, email: utilisateur.email });
  } catch (err) {
    console.error('[auth verify-otp] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// ── POST /auth/resend-otp — Renvoi d'un nouveau code (anti-abus : 1/60s) ────

router.post('/resend-otp', async (req, res) => {
  const { login_token } = req.body;

  if (!login_token) {
    return res.status(400).json({ erreur: 'login_token requis.' });
  }

  let payload;
  try {
    payload = auth.verifyToken(login_token);
  } catch {
    return res.status(401).json({ erreur: 'login_token invalide ou expiré. Reconnectez-vous.' });
  }

  if (payload.sub !== 'pre_auth') {
    return res.status(401).json({ erreur: 'Token invalide pour cette opération.' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT cree_le FROM codes_otp WHERE utilisateur_id = $1 ORDER BY id DESC LIMIT 1',
      [payload.id]
    );

    if (rows[0]) {
      const secondesEcoulees = (Date.now() - new Date(rows[0].cree_le).getTime()) / 1000;
      if (secondesEcoulees < 60) {
        const attente = Math.ceil(60 - secondesEcoulees);
        return res.status(429).json({
          erreur: `Attendez ${attente}s avant de renvoyer un code.`
        });
      }
    }

    const codeClair = await auth.creerOTP(payload.id);
    emailService.envoyerCodeOTP(payload, codeClair)
      .catch(err => console.error(err));
    console.log(`[OTP] Nouveau code pour ${payload.email} : ${codeClair}`);

    return res.json({ etape: 'otp_requis', message: 'Nouveau code envoyé.' });
  } catch (err) {
    console.error('[auth resend-otp] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// ── GET /auth/me — Utilisateur courant (JWT requis) ──────────────────────────

router.get('/me', authentifier, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nom, email, role, actif, cree_le, derniere_connexion FROM utilisateurs WHERE id = $1',
      [req.utilisateur.id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('[auth me] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// ── POST /auth/logout — Journalise la déconnexion (JWT requis) ───────────────

router.post('/logout', authentifier, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO logs_activite (utilisateur_id, utilisateur_email, action, ip) VALUES ($1, $2, $3, $4)',
      [req.utilisateur.id, req.utilisateur.email, 'deconnexion',
       req.ip || req.socket?.remoteAddress || '']
    );
    return res.json({ message: 'Déconnexion enregistrée.' });
  } catch (err) {
    console.error('[auth logout] Erreur:', err.message);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
