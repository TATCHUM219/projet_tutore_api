const express = require('express');
const PDFDocument = require('pdfkit');
const router = express.Router();
const pool = require('../db/database');
const exigerRole = require('../middleware/exigerRole');

const PERIODES = {
  '24h': { libelle: '24 dernières heures', sqlFiltre: "NOW() - INTERVAL '24 hours'", secondes: 86400 },
  '7j':  { libelle: '7 derniers jours',    sqlFiltre: "NOW() - INTERVAL '7 days'",   secondes: 604800 },
};

const COULEURS = {
  bleu:   '#3B8BD4',
  vert:   '#1D9E75',
  orange: '#EF9F27',
  rouge:  '#E24B4A',
  gris:   '#6b7280',
  fond:   '#f7f7fa',
  texte:  '#1a1a2e',
  bordure: '#cbd5e1',
};

// GET /rapport/pdf?periode=24h|7j  —  réservé aux administrateurs
router.get('/pdf', exigerRole('administrateur'), async (req, res) => {
  try {
    const periodeKey = (req.query.periode || '24h').toLowerCase();
    const periode = PERIODES[periodeKey] || PERIODES['24h'];

    const donnees = await collecterDonnees(periode);
    const nomFichier = `rapport-surveillance-${periodeKey}-${nowSlug()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
      Title: 'Rapport de surveillance — Salle serveur',
      Author: 'DataPipeline v1.0',
      Subject: `Période : ${periode.libelle}`,
    }});
    doc.pipe(res);

    ecrirePage1(doc, periode, donnees);
    doc.addPage();
    ecrirePage2(doc, periode, donnees);
    doc.addPage();
    ecrirePage3(doc, periode, donnees);

    ecrirePiedDePage(doc);

    doc.end();
  } catch (err) {
    console.error('[rapport pdf] Erreur:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ erreur: 'Erreur serveur lors de la génération du rapport.' });
    }
  }
});

// ============================================================
// Collecte des données depuis PostgreSQL (Async)
// ============================================================
async function collecterDonnees(periode) {
  const { rows: rMesures } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM mesures WHERE recu_le >= ${periode.sqlFiltre}`
  );
  const nbMesures = rMesures[0].total;

  const { rows: rAlertes } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM alertes WHERE cree_le >= ${periode.sqlFiltre}`
  );
  const nbAlertes = rAlertes[0].total;

  const { rows: statsZones } = await pool.query(`
    SELECT
      capteur_id,
      COUNT(*)::int    AS total,
      MIN(temperature) AS temp_min,
      MAX(temperature) AS temp_max,
      AVG(temperature) AS temp_moy
    FROM mesures
    WHERE recu_le >= ${periode.sqlFiltre}
    GROUP BY capteur_id
    ORDER BY capteur_id ASC
  `);

  const alertesParZone = {};
  const { rows: alertesZonesRows } = await pool.query(`
    SELECT capteur_id, COUNT(*)::int AS total
    FROM alertes
    WHERE cree_le >= ${periode.sqlFiltre}
    GROUP BY capteur_id
  `);
  for (const r of alertesZonesRows) {
    alertesParZone[r.capteur_id] = r.total;
  }
  for (const z of statsZones) {
    z.nb_alertes = alertesParZone[z.capteur_id] || 0;
  }

  const { rows: incidents } = await pool.query(`
    SELECT id, capteur_id, type_anomalie, valeur_declenchante, recommandation, statut, cree_le
    FROM alertes
    WHERE cree_le >= ${periode.sqlFiltre}
    ORDER BY cree_le DESC
    LIMIT 30
  `);

  const { rows: recommandationsActives } = await pool.query(`
    SELECT id, capteur_id, type_anomalie, priorite, delai_action, recommandation, cree_le
    FROM alertes
    WHERE statut = 'active' AND recommandation IS NOT NULL
    ORDER BY
      CASE priorite WHEN 'haute' THEN 0 WHEN 'moyenne' THEN 1 ELSE 2 END,
      cree_le DESC
  `);

  const { rows: rHautes } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM alertes WHERE statut = 'active' AND priorite = 'haute'`
  );
  const alertesHautesActives = rHautes[0].total;

  // Disponibilité : ratio mesures reçues / mesures attendues (3 zones × 1/s)
  const attendues = 3 * periode.secondes;
  const dispoPct = Math.min(100, (nbMesures / attendues) * 100);

  let statut, couleurStatut;
  if (dispoPct >= 95 && alertesHautesActives === 0) {
    statut = 'NOMINAL';
    couleurStatut = COULEURS.vert;
  } else if (dispoPct >= 80 || alertesHautesActives <= 2) {
    statut = 'DÉGRADÉ';
    couleurStatut = COULEURS.orange;
  } else {
    statut = 'CRITIQUE';
    couleurStatut = COULEURS.rouge;
  }

  return {
    nbMesures,
    nbAlertes,
    statsZones,
    incidents,
    recommandationsActives,
    alertesHautesActives,
    dispoPct,
    statut,
    couleurStatut,
  };
}

// ============================================================
// Page 1 — Header + résumé exécutif
// ============================================================
function ecrirePage1(doc, periode, d) {
  // En-tête
  doc.rect(0, 0, doc.page.width, 90).fill(COULEURS.texte);
  doc.fillColor('white')
    .fontSize(11).font('Helvetica').text('DataPipeline v1.0', 50, 30)
    .fontSize(22).font('Helvetica-Bold').text('Rapport de surveillance', 50, 48)
    .fontSize(13).font('Helvetica').text('Salle serveur — pipeline distribué', 50, 76);

  doc.fillColor(COULEURS.texte).fontSize(10).font('Helvetica');
  doc.text(`Période couverte : ${periode.libelle}`, 50, 110);
  doc.text(`Date de génération : ${new Date().toLocaleString('fr-FR')}`, 50, 124);

  // Bandeau statut
  const y = 160;
  doc.rect(50, y, doc.page.width - 100, 60).fill(d.couleurStatut);
  doc.fillColor('white')
    .fontSize(11).font('Helvetica').text('STATUT GLOBAL', 70, y + 12)
    .fontSize(28).font('Helvetica-Bold').text(d.statut, 70, y + 26);
  doc.fillColor('white').fontSize(11).font('Helvetica')
    .text(`Disponibilité : ${d.dispoPct.toFixed(1)}%`, doc.page.width - 200, y + 24, { width: 130, align: 'right' });

  // Section "Résumé exécutif"
  doc.fillColor(COULEURS.texte).fontSize(13).font('Helvetica-Bold')
    .text('Résumé exécutif', 50, y + 90);

  // 3 chiffres clés en grand
  const yCards = y + 120;
  const wCard = (doc.page.width - 100 - 30) / 3;
  const cartes = [
    { label: 'Mesures collectées', valeur: d.nbMesures.toLocaleString('fr-FR'), couleur: COULEURS.bleu },
    { label: 'Alertes générées',   valeur: d.nbAlertes.toString(),               couleur: COULEURS.orange },
    { label: 'Disponibilité',      valeur: `${d.dispoPct.toFixed(1)}%`,          couleur: COULEURS.vert },
  ];
  cartes.forEach((c, i) => {
    const x = 50 + i * (wCard + 15);
    doc.rect(x, yCards, wCard, 100).fill(COULEURS.fond);
    doc.strokeColor(COULEURS.bordure).rect(x, yCards, wCard, 100).stroke();
    doc.fillColor(COULEURS.gris).fontSize(9).font('Helvetica')
      .text(c.label.toUpperCase(), x + 15, yCards + 15, { width: wCard - 30, characterSpacing: 0.5 });
    doc.fillColor(c.couleur).fontSize(28).font('Helvetica-Bold')
      .text(c.valeur, x + 15, yCards + 38, { width: wCard - 30 });
  });

  // Légende statut
  doc.fillColor(COULEURS.gris).fontSize(9).font('Helvetica-Oblique')
    .text(
      `Statut calculé sur la disponibilité (${d.dispoPct.toFixed(1)}%) et ${d.alertesHautesActives} alerte(s) haute(s) actuellement active(s).`,
      50, yCards + 120, { width: doc.page.width - 100 }
    );
}

// ============================================================
// Page 2 — Stats par zone + incidents détectés
// ============================================================
function ecrirePage2(doc, periode, d) {
  titreSection(doc, 'Statistiques par zone', 50);

  // Tableau zones
  const y0 = 90;
  const cols = [
    { libelle: 'Zone',         largeur: 90 },
    { libelle: 'Mesures',      largeur: 80 },
    { libelle: 'Temp. min',    largeur: 80 },
    { libelle: 'Temp. moy',    largeur: 80 },
    { libelle: 'Temp. max',    largeur: 80 },
    { libelle: 'Nb alertes',   largeur: 80 },
  ];
  enTeteTableau(doc, cols, 50, y0);

  let y = y0 + 22;
  if (d.statsZones.length === 0) {
    doc.fillColor(COULEURS.gris).fontSize(10).font('Helvetica-Oblique')
      .text('Aucune mesure sur cette période.', 50, y);
    y += 20;
  } else {
    d.statsZones.forEach((z, idx) => {
      if (idx % 2 === 0) {
        doc.rect(50, y - 4, sommeLargeurs(cols), 20).fill(COULEURS.fond);
      }
      ligneTableau(doc, [
        z.capteur_id,
        z.total.toString(),
        z.temp_min != null ? `${z.temp_min.toFixed(1)}°C` : '—',
        z.temp_moy != null ? `${z.temp_moy.toFixed(1)}°C` : '—',
        z.temp_max != null ? `${z.temp_max.toFixed(1)}°C` : '—',
        z.nb_alertes.toString(),
      ], cols, 50, y);
      y += 20;
    });
  }

  // Section incidents
  y += 25;
  titreSection(doc, 'Incidents détectés', y);
  y += 30;

  const colsInc = [
    { libelle: 'Heure',       largeur: 90 },
    { libelle: 'Zone',        largeur: 60 },
    { libelle: 'Type',        largeur: 90 },
    { libelle: 'Valeur',      largeur: 70 },
    { libelle: 'Statut',      largeur: 80 },
    { libelle: 'Recommandation', largeur: 105 },
  ];
  enTeteTableau(doc, colsInc, 50, y);
  y += 22;

  if (d.incidents.length === 0) {
    doc.fillColor(COULEURS.gris).fontSize(10).font('Helvetica-Oblique')
      .text('Aucun incident sur cette période.', 50, y);
  } else {
    for (const [idx, inc] of d.incidents.entries()) {
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 50;
        enTeteTableau(doc, colsInc, 50, y);
        y += 22;
      }
      if (idx % 2 === 0) {
        doc.rect(50, y - 4, sommeLargeurs(colsInc), 22).fill(COULEURS.fond);
      }
      const recoCourt = (inc.recommandation || '—').slice(0, 50) + (inc.recommandation && inc.recommandation.length > 50 ? '…' : '');
      ligneTableau(doc, [
        formatHeureFR(inc.cree_le),
        inc.capteur_id,
        libelleType(inc.type_anomalie),
        inc.valeur_declenchante != null ? `${Number(inc.valeur_declenchante).toFixed(1)}°C` : '—',
        inc.statut,
        recoCourt,
      ], colsInc, 50, y);
      y += 22;
    }
  }
}

// ============================================================
// Page 3 — Recommandations actives
// ============================================================
function ecrirePage3(doc, periode, d) {
  titreSection(doc, 'Recommandations actives', 50);

  let y = 90;
  if (d.recommandationsActives.length === 0) {
    doc.fillColor(COULEURS.gris).fontSize(11).font('Helvetica-Oblique')
      .text('Aucune recommandation active à ce jour. Système nominal.', 50, y);
    return;
  }

  for (const a of d.recommandationsActives) {
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = 50;
    }
    const couleurPrio = a.priorite === 'haute' ? COULEURS.rouge
                      : a.priorite === 'moyenne' ? COULEURS.orange
                      : COULEURS.bleu;

    // Bandeau coloré à gauche
    doc.rect(50, y, 4, 90).fill(couleurPrio);
    doc.rect(60, y, doc.page.width - 110, 90).fill(COULEURS.fond);
    doc.strokeColor(COULEURS.bordure).rect(60, y, doc.page.width - 110, 90).stroke();

    // En-tête : priorité + zone + délai
    doc.fillColor(couleurPrio).fontSize(10).font('Helvetica-Bold')
      .text((a.priorite || 'inconnue').toUpperCase(), 75, y + 10);
    doc.fillColor(COULEURS.texte).fontSize(10).font('Helvetica-Bold')
      .text(`${a.capteur_id} · ${libelleType(a.type_anomalie)}`, 130, y + 10);
    if (a.delai_action) {
      doc.fillColor(COULEURS.orange).fontSize(9).font('Helvetica-Bold')
        .text(`Délai : ${a.delai_action}`, doc.page.width - 200, y + 10, { width: 130, align: 'right' });
    }
    
    // Modification: le timestamp PostgreSQL peut être un objet Date ou un string
    let dateStr = a.cree_le;
    if (dateStr instanceof Date) {
      dateStr = dateStr.toISOString();
    }
    doc.fillColor(COULEURS.gris).fontSize(8).font('Helvetica')
      .text(`Détectée le ${formatHeureFR(dateStr, true)}`, 75, y + 26);

    // Texte de la reco
    doc.fillColor(COULEURS.texte).fontSize(10).font('Helvetica')
      .text(a.recommandation, 75, y + 42, { width: doc.page.width - 140 });

    y += 105;
  }
}

// ============================================================
// Helpers
// ============================================================
function titreSection(doc, texte, y) {
  doc.fillColor(COULEURS.texte).fontSize(15).font('Helvetica-Bold').text(texte, 50, y);
  doc.moveTo(50, y + 22).lineTo(doc.page.width - 50, y + 22)
    .strokeColor(COULEURS.bleu).lineWidth(1.5).stroke();
}

function enTeteTableau(doc, cols, x, y) {
  doc.rect(x, y, sommeLargeurs(cols), 20).fill(COULEURS.texte);
  let xi = x;
  doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
  for (const c of cols) {
    doc.text(c.libelle, xi + 6, y + 6, { width: c.largeur - 12 });
    xi += c.largeur;
  }
}

function ligneTableau(doc, valeurs, cols, x, y) {
  let xi = x;
  doc.fillColor(COULEURS.texte).fontSize(9).font('Helvetica');
  valeurs.forEach((v, i) => {
    doc.text(String(v), xi + 6, y + 4, { width: cols[i].largeur - 12, lineBreak: false });
    xi += cols[i].largeur;
  });
}

function sommeLargeurs(cols) {
  return cols.reduce((s, c) => s + c.largeur, 0);
}

function libelleType(t) {
  return { pic: 'Pic thermique', derive: 'Dérive', capteur_mort: 'Capteur mort' }[t] || t;
}

function formatHeureFR(iso, complet = false) {
  if (!iso) return '—';
  let ts;
  if (iso instanceof Date) {
    ts = iso.toISOString();
  } else {
    ts = iso.endsWith('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z';
  }
  const d = new Date(ts);
  return complet
    ? d.toLocaleString('fr-FR')
    : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function nowSlug() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }

function ecrirePiedDePage(doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor(COULEURS.gris).fontSize(8).font('Helvetica-Oblique');
    doc.text(
      'Document généré automatiquement par le système de surveillance — DataPipeline v1.0',
      50, doc.page.height - 35, { width: doc.page.width - 100, align: 'center' }
    );
    doc.text(
      `Page ${i + 1} / ${range.count}`,
      50, doc.page.height - 22, { width: doc.page.width - 100, align: 'center' }
    );
  }
}

module.exports = router;
