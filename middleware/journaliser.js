const pool = require('../db/database');

// Factory : journaliser('action', req => détails_optionnels)
// Insère dans logs_activite APRÈS l'envoi de la réponse (res.on('finish'))
// Fire-and-forget : ne bloque pas la réponse même en cas d'erreur.
function journaliser(action, getDetails) {
  return (req, res, next) => {
    res.on('finish', async () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      if (!req.utilisateur) return;

      let details = null;
      if (getDetails) {
        try { details = JSON.stringify(getDetails(req)); } catch { /* ignore */ }
      }

      try {
        await pool.query(
          `INSERT INTO logs_activite
             (utilisateur_id, utilisateur_email, action, details, ip)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            req.utilisateur.id,
            req.utilisateur.email,
            action,
            details,
            req.ip || req.socket?.remoteAddress || '',
          ]
        );
      } catch (e) {
        console.error('[journaliser] Erreur:', e.message);
      }
    });
    next();
  };
}

module.exports = journaliser;
