const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL requis pour Neon (et autres hébergeurs cloud), désactivé en local
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
});

pool.on('error', (err) => {
  console.error('[DB] Erreur inattendue sur le pool PostgreSQL:', err.message);
});

module.exports = pool;
