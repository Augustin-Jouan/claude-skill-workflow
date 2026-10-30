// État de l'exécution : .workflow/run.json, tenu par run-plan seul (fichier protégé pendant l'exécuteur).
// Tâches committées, tentatives, rejets, budget consommé, question en attente, état initial de la suite.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Parcours } from './etat.ts';

export type MotifQuestion = 'budget-tache' | 'budget-branche' | 'rejets' | 'arbitre' | 'remontee' | 'couverture' | 'commit' | 'jalon';

export interface EtatTache {
  statut: 'en-cours' | 'commitee';
  tentatives: number;
  rejets: number;
  arbitreRejets: boolean;
  remontees: number;
  dureeMs: number;
  appelsLlm: number;
  // Transmise à la prochaine tentative : rapport de rejet, consigne de l'arbitre ou réponse du développeur.
  consigne: string | null;
  couvertureVerifiee: boolean;
  commit?: string;
}

export interface Attente {
  tache: string | null;
  motif: MotifQuestion;
  question: string;
  // Empreinte du plan au moment de la question : un plan amendé depuis la rend caduque.
  plan: string;
  reponse: string | null;
  // Jalon rouge : les échecs en cause, admis si le développeur répond de continuer.
  echecs?: string[];
}

// Échecs de la suite et erreurs de typecheck déjà présents avant la première tâche : ils ne bloquent pas.
export interface Reference {
  echecs: string[];
  tsc: string[];
  suiteMs: number;
  // HEAD avant la première tâche : base de la branche pour le bisect et pour finish.
  commit: string;
}

export interface EtatRun {
  version: 1;
  dureeMs: number;
  appelsLlm: number;
  rallonges: number;
  reference: Reference | null;
  enCours: string | null;
  taches: Record<string, EtatTache>;
  attente: Attente | null;
  // Suite lente seulement : jalons dont la suite complète a été tranchée, et dernier commit où elle était verte.
  jalonsVerifies: string[];
  dernierJalonVert: string | null;
  // Échecs que le développeur a choisi de laisser passer à un jalon : ils ne bloquent plus.
  echecsAcceptes: string[];
}

export interface Budgets {
  tacheMinutes: number;
  branche: Record<Parcours, { minutes: number; appelsLlm: number }>;
}

export function nouveauRun(): EtatRun {
  return { version: 1, dureeMs: 0, appelsLlm: 0, rallonges: 0, reference: null, enCours: null, taches: {}, attente: null, jalonsVerifies: [], dernierJalonVert: null, echecsAcceptes: [] };
}

export function nouvelleTache(): EtatTache {
  return { statut: 'en-cours', tentatives: 0, rejets: 0, arbitreRejets: false, remontees: 0, dureeMs: 0, appelsLlm: 0, consigne: null, couvertureVerifiee: false };
}

export function lireRun(dossier: string): EtatRun {
  const chemin = join(dossier, 'run.json');
  return existsSync(chemin) ? { ...nouveauRun(), ...(JSON.parse(readFileSync(chemin, 'utf8')) as Partial<EtatRun>) } : nouveauRun();
}

export function ecrireRun(dossier: string, run: EtatRun): void {
  writeFileSync(join(dossier, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
}

const MIN = 60_000;

export function depassement(run: EtatRun, id: string, parcours: Parcours, budgets: Budgets): { motif: MotifQuestion; message: string } | null {
  const t = run.taches[id];
  const branche = budgets.branche[parcours];
  const facteur = 1 + run.rallonges;
  if (t && t.dureeMs >= budgets.tacheMinutes * MIN) {
    return { motif: 'budget-tache', message: `${id} a consommé son budget de ${budgets.tacheMinutes} min (${t.tentatives} tentative(s)).` };
  }
  if (run.dureeMs >= branche.minutes * MIN * facteur) {
    return { motif: 'budget-branche', message: `La branche a consommé ${Math.round(run.dureeMs / MIN)} min, budget ${branche.minutes * facteur} min (parcours ${parcours}).` };
  }
  if (run.appelsLlm >= branche.appelsLlm * facteur) {
    return { motif: 'budget-branche', message: `La branche a fait ${run.appelsLlm} appels LLM, budget ${branche.appelsLlm * facteur} (parcours ${parcours}).` };
  }
  return null;
}

export function tempsRestantMs(run: EtatRun, id: string, parcours: Parcours, budgets: Budgets): number {
  const tache = budgets.tacheMinutes * MIN - (run.taches[id]?.dureeMs ?? 0);
  const branche = budgets.branche[parcours].minutes * MIN * (1 + run.rallonges) - run.dureeMs;
  return Math.max(0, Math.min(tache, branche));
}

// Suite complète plus lente que le seuil : tests liés après chaque tâche, suite complète aux jalons (workflow-dev.md, 4.7).
export function suiteLente(reference: Reference | null, secondes: number): boolean {
  return reference !== null && reference.suiteMs > secondes * 1000;
}

// La dernière tâche est toujours un jalon : aucune régression n'arrive jusqu'à finish.
export function estJalon(id: string, jalons: string[], ordre: string[]): boolean {
  return jalons.includes(id) || ordre.at(-1) === id;
}

// Échecs qui ne comptent pas comme régressions : présents au départ, ou admis par le développeur à un jalon.
export function echecsAdmis(run: EtatRun): string[] {
  return [...(run.reference?.echecs ?? []), ...run.echecsAcceptes];
}
