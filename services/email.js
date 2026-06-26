'use strict';

const nodemailer = require('nodemailer');
const pool       = require('../db/database');

// ── Configuration transporter ─────────────────────────────────────────────────

function creerTransporter() {
  if (!process.env.SMTP_HOST) return null;

  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    family: 4, // forcer IPv4 — Railway ne route pas IPv6 en sortie
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// ── Anti-spam ─────────────────────────────────────────────────────────────────

async function emailDejaEnvoye(capteur_id, type_anomalie) {
  const { rows: fRows } = await pool.query(
    "SELECT valeur FROM config WHERE cle = 'email_fenetre_anti_spam_minutes'"
  );
  const fenetre = fRows[0] ? parseInt(fRows[0].valeur, 10) : 10;

  const { rows } = await pool.query(
    `SELECT id FROM emails_envoyes
     WHERE capteur_id = $1
       AND type_anomalie = $2
       AND envoye_le >= NOW() - ($3::text || ' minutes')::interval
     LIMIT 1`,
    [capteur_id, type_anomalie, String(fenetre)]
  );

  return rows.length > 0;
}

async function enregistrerEnvoi(capteur_id, type_anomalie) {
  await pool.query(
    'INSERT INTO emails_envoyes (capteur_id, type_anomalie) VALUES ($1, $2)',
    [capteur_id, type_anomalie]
  );
}

// ── Envoi d'alerte ────────────────────────────────────────────────────────────

async function envoyerAlerteEmail(alerte) {
  if (alerte.priorite !== 'haute') return;

  const { capteur_id, type_anomalie } = alerte;

  if (await emailDejaEnvoye(capteur_id, type_anomalie)) {
    console.log(`[email] Anti-spam : email skippé pour ${capteur_id} / ${type_anomalie}`);
    return;
  }

  const { rows: utilisateursDB } = await pool.query(
    'SELECT email FROM utilisateurs WHERE actif = 1'
  );
  const emailsDB = utilisateursDB.map(u => u.email);
  
  const emailsEnv = (process.env.EMAIL_DESTINATAIRES || '')
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0);

  // Fusionner sans doublons
  const destinataires = [...new Set([...emailsEnv, ...emailsDB])].join(', ');

  const sujet = `[ALERTE] ${type_anomalie.toUpperCase()} — ${capteur_id} — Salle serveur`;
  const corps = construireCorps(alerte);

  const transporter = creerTransporter();

  if (!transporter) {
    console.log(`[email] (mode démo — pas de SMTP) Sujet : ${sujet}`);
    console.log(`[email] Destinataires : ${destinataires || '(aucun configuré)'}`);
    await enregistrerEnvoi(capteur_id, type_anomalie);
    return;
  }

  try {
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      replyTo: process.env.SMTP_USER,
      to:      destinataires,
      subject: sujet,
      text:    corps,
      html:    construireAlerteHTML(alerte),
      headers: {
        'X-Priority': '1 (Highest)',
        'X-MSMail-Priority': 'High',
        'Importance': 'High'
      }
    });

    await enregistrerEnvoi(capteur_id, type_anomalie);
    console.log(`[email] ✅ Alerte envoyée → ${destinataires} (${capteur_id} / ${type_anomalie})`);
  } catch (err) {
    console.error(`[email] ❌ Échec envoi : ${err.message}`);
  }
}

// ── Envoi OTP ─────────────────────────────────────────────────────────────────

async function envoyerCodeOTP(utilisateur, code) {
  const destinataire = utilisateur.email;
  const sujet = '[Sécurité] Votre code de connexion — Salle Serveur';

  const { rows } = await pool.query(
    "SELECT valeur FROM config WHERE cle = 'otp_duree_minutes'"
  );
  const duree = rows[0] ? parseInt(rows[0].valeur, 10) : 5;

  const corps = [
    `Bonjour ${utilisateur.nom || ''},`,
    '',
    'Voici votre code de vérification pour accéder au dashboard de surveillance :',
    '',
    `   ${code}`,
    '',
    `Ce code est valide pendant ${duree} minute(s).`,
    "ATTENTION : Ne partagez jamais ce code. L'équipe technique ne vous le demandera jamais.",
    '',
    '— Le système automatique de surveillance',
  ].join('\n');

  const transporter = creerTransporter();

  if (!transporter) {
    console.log(`[email] (mode démo — pas de SMTP) Sujet : ${sujet}`);
    console.log(`[email] Destinataire : ${destinataire}`);
    console.log(`[email] Corps :\n${corps}`);
    return;
  }

  try {
    await transporter.sendMail({
      from:    process.env.SMTP_FROM || process.env.SMTP_USER,
      replyTo: process.env.SMTP_USER,
      to:      destinataire,
      subject: sujet,
      text:    corps,
      html:    construireOTPHTML(utilisateur, code, duree),
    });
    console.log(`[email] ✅ OTP envoyé → ${destinataire}`);
  } catch (err) {
    console.error(`[email] ❌ Échec envoi OTP : ${err.message}`);
  }
}

// ── Templates HTML ────────────────────────────────────────────────────────────

function getBaseEmailStyle() {
  return `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #070d18; color: #e5e7eb; margin: 0; padding: 20px; line-height: 1.6; }
    p, span, div, td, th { color: #e5e7eb; }
    .container { max-width: 600px; margin: 0 auto; background-color: #0c1524; border: 1px solid #1a2e4a; border-radius: 12px; overflow: hidden; color: #e5e7eb; }
    .header { background-color: #1a2e4a; padding: 20px; text-align: center; border-bottom: 1px solid #1a2e4a; }
    .header h1 { margin: 0; font-size: 20px; color: #ffffff; }
    .content { padding: 30px; color: #e5e7eb; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #7fa0c0; background-color: #0c1524; border-top: 1px solid #1a2e4a; }
    .btn { display: inline-block; background-color: #3478c8; color: #ffffff !important; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; }
    .code-box { background-color: #070d18; border: 1px dashed #3478c8; padding: 15px; font-size: 36px; font-weight: bold; text-align: center; letter-spacing: 8px; color: #5ba3e0 !important; border-radius: 8px; margin: 25px 0; }
    .badge-haute { display: inline-block; background-color: rgba(204, 16, 32, 0.2); color: #ff6b6b !important; padding: 4px 10px; border-radius: 4px; font-size: 14px; font-weight: bold; border: 1px solid #cc1020; }
    .badge-moyenne { display: inline-block; background-color: rgba(245, 158, 11, 0.2); color: #fcd34d !important; padding: 4px 10px; border-radius: 4px; font-size: 14px; font-weight: bold; border: 1px solid #f59e0b; }
    .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; color: #e5e7eb; }
    .table th { text-align: left; padding: 10px; border-bottom: 1px solid #1a2e4a; color: #7fa0c0 !important; font-weight: normal; width: 40%; }
    .table td { padding: 10px; border-bottom: 1px solid #1a2e4a; font-weight: bold; color: #e5e7eb !important; }
    .reco-box { background-color: rgba(52, 120, 200, 0.1); border-left: 4px solid #3478c8; padding: 15px; margin-top: 20px; border-radius: 0 8px 8px 0; color: #e5e7eb; }
    .warning-text { color: #f59e0b !important; font-size: 13px; margin-top: 20px; text-align: center; }
  `;
}

function construireCorps(alerte) {
  const horodatage = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  return [
    '═══════════════════════════════════════',
    '   ALERTE — Système de surveillance',
    '   Salle serveur / Datacenter',
    '═══════════════════════════════════════',
    '',
    `Zone concernée  : ${alerte.capteur_id}`,
    `Type d'anomalie : ${alerte.type_anomalie}`,
    `Priorité        : ${alerte.priorite?.toUpperCase()}`,
    `Heure           : ${horodatage}`,
    '',
    '── Détails ──────────────────────────',
    alerte.message || '(aucun message)',
    '',
    '── Recommandation ───────────────────',
    alerte.recommandation || '(aucune recommandation)',
    '',
    `Valeur déclenchante : ${alerte.valeur_declenchante ?? 'N/A'}`,
    `Valeur normale      : ${alerte.valeur_normale ?? 'N/A'}`,
    '',
    '─────────────────────────────────────',
    'Cet email a été généré automatiquement.',
    'Ne pas répondre à ce message.',
    'Connectez-vous au dashboard pour acquitter cette alerte.',
  ].join('\n');
}

function construireAlerteHTML(alerte) {
  const horodatage = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  const isHaute    = alerte.priorite?.toLowerCase() === 'haute';
  const colorHex   = isHaute ? '#cc1020' : '#f59e0b';
  const badgeClass = isHaute ? 'badge-haute' : 'badge-moyenne';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${getBaseEmailStyle()}</style>
</head>
<body>
  <div class="container">
    <div class="header" style="background-color: ${colorHex};">
      <h1>ALERTE — Salle Serveur</h1>
    </div>
    <div class="content" style="color: #e5e7eb;">
      <h2 style="margin-top: 0; color: #ffffff;">Anomalie détectée</h2>
      <table class="table">
        <tr><th>Zone concernée</th><td>${alerte.capteur_id}</td></tr>
        <tr><th>Type d'anomalie</th><td style="text-transform: uppercase;">${alerte.type_anomalie}</td></tr>
        <tr><th>Priorité</th><td><span class="${badgeClass}">${alerte.priorite?.toUpperCase()}</span></td></tr>
        <tr><th>Heure de détection</th><td>${horodatage}</td></tr>
      </table>
      <h3 style="color: #7fa0c0; font-size: 14px; text-transform: uppercase; margin-bottom: 5px;">Détails</h3>
      <div style="background-color: #070d18; padding: 15px; border-radius: 8px; border: 1px solid #1a2e4a; color: #e5e7eb;">
        <p style="margin: 0; color: #e5e7eb;">${alerte.message || '(aucun message)'}</p>
        <div style="margin-top: 10px; font-size: 13px; color: #7fa0c0;">
          <p style="margin: 0; color: #7fa0c0;">Valeur déclenchante : ${alerte.valeur_declenchante ?? 'N/A'}</p>
          <p style="margin: 0; color: #7fa0c0;">Valeur normale : ${alerte.valeur_normale ?? 'N/A'}</p>
        </div>
      </div>
      ${alerte.recommandation ? `<div class="reco-box" style="color: #e5e7eb;">
        <strong style="color: #5ba3e0;">Recommandation :</strong>
        <p style="margin: 5px 0 0 0; color: #e5e7eb;">${alerte.recommandation}</p>
      </div>` : ''}
      <div style="text-align: center; margin-top: 30px;">
        <a href="${process.env.DASHBOARD_URL || 'http://localhost:5173'}" class="btn">Accéder au Dashboard</a>
      </div>
    </div>
    <div class="footer" style="color: #7fa0c0;">
      <p style="margin: 0; color: #7fa0c0;">Cet email a été généré automatiquement par le système de surveillance.</p>
      <p style="margin: 5px 0 0 0; color: #7fa0c0;">Ne pas répondre à ce message.</p>
    </div>
  </div>
</body>
</html>`;
}

function construireOTPHTML(utilisateur, code, duree) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${getBaseEmailStyle()}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Authentification Requise</h1>
    </div>
    <div class="content" style="color: #e5e7eb;">
      <p style="font-size: 16px; margin-top: 0; color: #e5e7eb;">Bonjour <strong style="color: #ffffff;">${utilisateur.nom || 'Administrateur'}</strong>,</p>
      <p style="color: #e5e7eb;">Voici votre code de vérification pour accéder au dashboard de surveillance. Ce code est valide pendant <strong style="color: #ffffff;">${duree} minute(s)</strong>.</p>
      <div class="code-box">${code}</div>
      <p class="warning-text"><strong>Attention :</strong> Ne partagez jamais ce code. L'équipe technique ne vous le demandera jamais.</p>
    </div>
    <div class="footer" style="color: #7fa0c0;">
      <p style="margin: 0; color: #7fa0c0;">Système automatique de surveillance — Salle Serveur</p>
      <p style="margin: 5px 0 0 0; color: #7fa0c0;">Si vous n'avez pas demandé ce code, ignorez cet email.</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { envoyerAlerteEmail, envoyerCodeOTP };
