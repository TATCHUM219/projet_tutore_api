// Table de décision statique — règles évaluées dans l'ordre, première match gagne.
// Maintenable, lisible, 100% justifiable au jury (pas de boîte noire ML).

const regles = [
  {
    condition: (a) => a.type_anomalie === 'pic' && a.capteur_id === 'zone-B',
    recommandation: "Pic thermique détecté en zone chaude. Vérifier immédiatement la ventilation du rack B. Réduire la charge des serveurs si la température dépasse 32°C.",
    priorite: 'haute',
    delai_action: '< 5 minutes',
  },
  {
    condition: (a) => a.type_anomalie === 'pic' && a.capteur_id === 'zone-A',
    recommandation: "Anomalie en zone froide — inhabituel. Vérifier que les panneaux d'allée froide sont bien en place et qu'aucun câble ne perturbe la circulation d'air.",
    priorite: 'haute',
    delai_action: '< 10 minutes',
  },
  {
    condition: (a) => a.type_anomalie === 'derive',
    recommandation: "Dérive thermique progressive détectée. Inspecter les filtres à air et vérifier le bon fonctionnement des unités de climatisation (CRAC). Planifier une intervention sous 30 minutes.",
    priorite: 'moyenne',
    delai_action: '< 30 minutes',
  },
  {
    condition: (a) => a.type_anomalie === 'capteur_mort',
    recommandation: "Capteur hors ligne. Impossible de surveiller cette zone. Vérifier la connectivité réseau du capteur et redémarrer si nécessaire. Intervention immédiate requise.",
    priorite: 'haute',
    delai_action: 'Immédiat',
  },
];

const fallback = {
  recommandation: "Anomalie détectée mais non couverte par les règles spécifiques. Vérifier manuellement l'état de la zone concernée.",
  priorite: 'moyenne',
  delai_action: '< 30 minutes',
};

function genererRecommandation(alerte) {
  for (const regle of regles) {
    if (regle.condition(alerte)) {
      return {
        recommandation: regle.recommandation,
        priorite: regle.priorite,
        delai_action: regle.delai_action,
      };
    }
  }
  return { ...fallback };
}

module.exports = { genererRecommandation };
