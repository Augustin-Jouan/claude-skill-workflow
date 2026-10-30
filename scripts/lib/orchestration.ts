// Décisions de run-plan après chaque tentative et chaque arbitrage (workflow-dev.md, 4.1 et 4.4).
// Fonctions pures : elles rendent le nouvel état de la tâche et l'action suivante, run-plan l'exécute.
// Un rejet de l'arbitre compte comme un rejet. L'accord de l'arbitre ne lève jamais un rejet du script :
// seul le développeur peut passer outre.

import type { Decision, Remontee } from './reponses-llm.ts';
import type { EtatTache, MotifQuestion } from './run-etat.ts';

export type MotifArbitre = 'signalements' | 'rejets' | 'remontee';

export type Verdict =
  | { type: 'accepte' }
  | { type: 'rejete'; rapport: string }
  | { type: 'signale'; rapport: string }
  | { type: 'remontee'; remontee: Remontee };

export type Action =
  | { type: 'commit' }
  | { type: 'relancer'; consigne: string }
  | { type: 'arbitre'; motif: MotifArbitre; rapport: string }
  | { type: 'question'; motif: MotifQuestion; question: string };

interface Suite {
  tache: EtatTache;
  action: Action;
}

function suiteDuRejet(t: EtatTache, rapport: string, seuil: number): Suite {
  if (t.rejets < seuil) return { tache: t, action: { type: 'relancer', consigne: rapport } };
  if (!t.arbitreRejets) return { tache: { ...t, arbitreRejets: true }, action: { type: 'arbitre', motif: 'rejets', rapport } };
  return {
    tache: t,
    action: { type: 'question', motif: 'rejets', question: `La tâche a été rejetée ${t.rejets} fois, l'arbitre est déjà intervenu. Dernier rapport :\n\n${rapport}` },
  };
}

export function apresVerdict(t: EtatTache, v: Verdict, seuil: number): Suite {
  switch (v.type) {
    case 'accepte':
      return { tache: t, action: { type: 'commit' } };
    case 'signale':
      return { tache: t, action: { type: 'arbitre', motif: 'signalements', rapport: v.rapport } };
    case 'rejete':
      return suiteDuRejet({ ...t, rejets: t.rejets + 1 }, v.rapport, seuil);
    case 'remontee': {
      const rapport = `Remontée de l'exécuteur (${v.remontee.type}) : ${v.remontee.message}`;
      const suivante = { ...t, remontees: t.remontees + 1 };
      if (t.remontees > 0) return { tache: suivante, action: { type: 'question', motif: 'remontee', question: rapport } };
      return { tache: suivante, action: { type: 'arbitre', motif: 'remontee', rapport } };
    }
  }
}

export function apresArbitre(t: EtatTache, motif: MotifArbitre, rapport: string, d: Decision | null, seuil: number): Suite {
  const question = (m: MotifQuestion, texte: string): Suite => ({ tache: t, action: { type: 'question', motif: m, question: texte } });
  if (!d) return question('arbitre', `La réponse de l'arbitre est illisible. Rapport soumis :\n\n${rapport}`);
  if (d.decision === 'question') return question('arbitre', `${d.question}\n\n(Raison de l'arbitre : ${d.raison})\n\nRapport soumis :\n\n${rapport}`);

  if (d.decision === 'accepter') {
    if (motif === 'signalements') return { tache: t, action: { type: 'commit' } };
    if (motif === 'remontee') return question('remontee', `L'arbitre confirme la remontée : ${d.raison}\n\n${rapport}`);
    return question('arbitre', `L'arbitre veut accepter une tâche que le script rejette : seul le développeur peut passer outre. Raison : ${d.raison}\n\nRapport :\n\n${rapport}`);
  }

  if (motif === 'signalements') return suiteDuRejet({ ...t, rejets: t.rejets + 1 }, `Rejet de l'arbitre : ${d.raison}\n\n${rapport}`, seuil);
  if (motif === 'remontee') return { tache: t, action: { type: 'relancer', consigne: `Réponse de l'arbitre à ta remontée : ${d.raison}` } };
  return { tache: t, action: { type: 'relancer', consigne: `Consigne de l'arbitre après ${t.rejets} rejets : ${d.raison}\n\n${rapport}` } };
}

// La réponse du développeur ouvre un nouveau cycle de tentatives pour la tâche.
export function appliquerReponse(t: EtatTache, motif: MotifQuestion, reponse: string): EtatTache {
  return {
    ...t,
    rejets: 0,
    arbitreRejets: false,
    remontees: 0,
    dureeMs: motif === 'budget-tache' ? 0 : t.dureeMs,
    couvertureVerifiee: t.couvertureVerifiee || motif === 'couverture',
    consigne: `Réponse du développeur : ${reponse}${t.consigne ? `\n\n${t.consigne}` : ''}`,
  };
}
