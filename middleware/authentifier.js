const auth = require('../services/auth');

function authentifier(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ erreur: 'Token manquant. Authentification requise.' });
  }

  const token = header.slice(7);

  try {
    const payload = auth.verifyToken(token);

    // Les login_tokens (pre_auth) ne donnent pas accès aux routes protégées
    if (payload.sub === 'pre_auth') {
      return res.status(401).json({
        erreur: 'Token temporaire non autorisé. Finalisez la connexion 2FA.'
      });
    }

    req.utilisateur = payload;
    next();
  } catch {
    return res.status(401).json({ erreur: 'Token invalide ou expiré.' });
  }
}

module.exports = authentifier;
