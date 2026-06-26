function exigerRole(role) {
  return (req, res, next) => {
    if (!req.utilisateur) {
      return res.status(401).json({ erreur: 'Non authentifié.' });
    }
    if (req.utilisateur.role !== role) {
      return res.status(403).json({
        erreur: `Accès refusé. Rôle requis : ${role}.`
      });
    }
    next();
  };
}

module.exports = exigerRole;
