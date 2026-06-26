const bcryptjs  = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('node:crypto');
const pool      = require('../db/database');

const JWT_SECRET    = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const BCRYPT_ROUNDS = 10;

// ── Mots de passe ──────────────────────────────────────────────────────────

function hashPassword(password) {
  return bcryptjs.hashSync(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, hash) {
  return bcryptjs.compareSync(password, hash);
}

// ── JWT ────────────────────────────────────────────────────────────────────

function generateToken(user, options = {}) {
  const payload = { id: user.id, email: user.email, role: user.role };
  const { expiresIn = '8h', ...rest } = options;
  return jwt.sign(payload, JWT_SECRET, { expiresIn, ...rest });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ── OTP ────────────────────────────────────────────────────────────────────

function genererCodeOTP() {
  return String(crypto.randomInt(100000, 1000000)).padStart(6, '0');
}

function hashOTP(code) {
  return bcryptjs.hashSync(code, BCRYPT_ROUNDS);
}

function verifyOTP(code, hash) {
  return bcryptjs.compareSync(code, hash);
}

async function creerOTP(utilisateur_id) {
  const { rows } = await pool.query(
    "SELECT valeur FROM config WHERE cle = 'otp_duree_minutes'"
  );
  const dureeMinutes = rows[0] ? parseInt(rows[0].valeur, 10) : 5;

  const code    = genererCodeOTP();
  const hash    = hashOTP(code);
  const expireLe = new Date(Date.now() + dureeMinutes * 60 * 1000);

  // Invalider tous les OTP précédents non consommés pour cet utilisateur
  await pool.query(
    'UPDATE codes_otp SET utilise = 1 WHERE utilisateur_id = $1 AND utilise = 0',
    [utilisateur_id]
  );

  await pool.query(
    'INSERT INTO codes_otp (utilisateur_id, code_hash, expire_le) VALUES ($1, $2, $3)',
    [utilisateur_id, hash, expireLe]
  );

  return code; // code en clair — à envoyer par email uniquement, jamais persisté
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  genererCodeOTP,
  hashOTP,
  verifyOTP,
  creerOTP,
};
