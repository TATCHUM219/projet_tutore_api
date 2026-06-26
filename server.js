// Charge les variables d'environnement depuis .env en mode dev
try { process.loadEnvFile(require('path').join(__dirname, '.env')); } catch { /* .env absent = production Railway */ }

const express = require('express');
const cors    = require('cors');

const { initialiserDB } = require('./db/init');

const mesuresRouter      = require('./routes/mesures');
const healthRouter       = require('./routes/health');
const alertesRouter      = require('./routes/alertes');
const statsRouter        = require('./routes/stats');
const rapportRouter      = require('./routes/rapport');
const authRouter         = require('./routes/auth');
const utilisateursRouter = require('./routes/utilisateurs');
const configRouter       = require('./routes/config');
const logsRouter         = require('./routes/logs');
const exportRouter       = require('./routes/export');

const authentifier = require('./middleware/authentifier');

const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors({
  origin: true,
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json());

// ── Routes publiques ──────────────────────────────────────────────────────────
app.use('/auth',    authRouter);
app.use('/health',  healthRouter);
app.use('/mesures', mesuresRouter);

// ── Routes protégées (JWT requis pour toutes) ─────────────────────────────────
app.use('/alertes',      authentifier, alertesRouter);
app.use('/stats',        authentifier, statsRouter);
app.use('/rapport',      authentifier, rapportRouter);
app.use('/utilisateurs', authentifier, utilisateursRouter);
app.use('/config',       authentifier, configRouter);
app.use('/logs',         authentifier, logsRouter);
app.use('/export',       authentifier, exportRouter);

// ── Démarrage : initialiser la DB puis écouter ────────────────────────────────
initialiserDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`API démarrée et prête sur le port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[DB] Erreur fatale lors de l\'initialisation:', err.message);
    process.exit(1);
  });
