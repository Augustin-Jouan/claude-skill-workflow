// Fin de branche (workflow-dev.md, 5) : verdict de la review neuve, résumé du journal pour la revue finale,
// et .workflow/fin.json, qui dit sur quel commit « wf finish » est passé.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Fin {
  date: string;
  head: string;
  ok: boolean;
  mutation: 'faite' | 'sautee' | 'aucun-fichier';
  verdict: string | null;
}

export function lireFin(dossier: string): Fin | null {
  const chemin = join(dossier, 'fin.json');
  return existsSync(chemin) ? (JSON.parse(readFileSync(chemin, 'utf8')) as Fin) : null;
}

export function ecrireFin(dossier: string, fin: Fin): void {
  writeFileSync(join(dossier, 'fin.json'), `${JSON.stringify(fin, null, 2)}\n`);
}

// Mutation et analyse des survivants d'un finish arrêté avant fin.md (review en erreur, délai dépassé), gardées
// dans .workflow/fin-mutation.json. Le finish suivant sur le même commit les reprend au lieu de relancer
// l'analyse, qui coûte des appels LLM et ne propose pas deux fois les mêmes tests.
export interface MutationFaite {
  head: string;
  sans: boolean;
  statut: Fin['mutation'];
  ligne: string;
  section: string;
  testsProposes: number;
  vus?: string[];
  sansAnalyse?: SansAnalyse;
}

// Pourquoi une mutation faite n'a donné lieu à aucune analyse LLM des survivants.
export type SansAnalyse = 'aucune-feature' | 'aucun-survivant';

export const RAISONS_SANS_ANALYSE: Record<SansAnalyse, string> = {
  'aucune-feature': "la branche n'a aucune tâche feature",
  'aucun-survivant': 'aucun survivant nouveau sur les lignes changées du code des tâches feature',
};

// Une branche de refactor seul ne doit pas lire « aucun test proposé » : l'analyse n'a pas tourné.
export function suiteDeLaMutation(m: Pick<MutationFaite, 'statut' | 'testsProposes' | 'sansAnalyse'>): string {
  if (m.testsProposes > 0) {
    return `L'analyse des survivants propose ${m.testsProposes} test(s). Pour les ajouter : une tâche feature (comportement_existant: true) au plan, via « wf state revenir plan », puis check-plan, matrice, run-plan et un nouveau finish.`;
  }
  if (m.statut === 'sautee') return 'Analyse des survivants non lancée : mutation sautée (--sans-mutation).';
  if (m.statut === 'aucun-fichier') return 'Analyse des survivants non lancée : aucun fichier de code changé par la branche.';
  if (m.sansAnalyse) return `Analyse des survivants non lancée : ${RAISONS_SANS_ANALYSE[m.sansAnalyse]}.`;
  return "Aucun test proposé par l'analyse des survivants.";
}

// Couverture mesurée par run-plan avant chaque tâche refactor ; la dernière mesure de chaque tâche compte.
export function ligneCouverture(lignes: Ligne[]): string | null {
  const parTache = new Map<string, Ligne>();
  for (const l of lignes) if (l.type === 'couverture') parTache.set(String(l.tache), l);
  if (parTache.size === 0) return null;
  const mesures = [...parTache.values()];
  const detail = mesures.map((l) => `${l.tache} ${(l.fichiers as Array<{ fichier: string; pct: number }>).map((f) => `${f.fichier} ${f.pct} %`).join(', ')}`);
  return `- Couverture avant refactor (lignes, seuil ${mesures[0].seuil} %) : ${detail.join(' ; ')}`;
}

const MUTATION_FAITE = 'fin-mutation.json';

export function lireMutationFaite(dossier: string): MutationFaite | null {
  const chemin = join(dossier, MUTATION_FAITE);
  return existsSync(chemin) ? (JSON.parse(readFileSync(chemin, 'utf8')) as MutationFaite) : null;
}

export function ecrireMutationFaite(dossier: string, m: MutationFaite): void {
  writeFileSync(join(dossier, MUTATION_FAITE), `${JSON.stringify(m, null, 2)}\n`);
}

// Une fois fin.md écrit : un finish relancé ensuite refait l'analyse, et survivants-vus.json écarte ce qui a été soumis.
export function oublierMutationFaite(dossier: string): void {
  rmSync(join(dossier, MUTATION_FAITE), { force: true });
}

export function mutationReutilisable(m: MutationFaite | null, head: string, sans: boolean): boolean {
  return m !== null && m.head === head && m.sans === sans;
}

// Les tests ne sont relancés que si le code a changé depuis finish (workflow-dev.md, 5.5).
export function conditionsFin(fin: Fin | null, head: string, propre: boolean): string[] {
  if (!fin) return ["« wf finish » n'a jamais été lancé."];
  if (!fin.ok) return ['Le dernier « wf finish » a échoué : corrige ce qu\'il liste (nouvelle tâche au plan) et relance-le.'];
  const manques: string[] = [];
  if (fin.head !== head) manques.push('Le code a changé depuis le dernier « wf finish » : relance-le.');
  if (!propre) manques.push("L'arbre de travail a des changements non commités.");
  return manques;
}

const VERDICTS = ['conforme', 'écarts mineurs', 'écarts bloquants'];

export function lireVerdictReview(texte: string): string | null {
  const lignes = texte.split(/\r?\n/);
  const debut = lignes.findIndex((l) => /^##\s+Verdict\s*$/i.test(l.trim()));
  if (debut < 0) return null;
  const ligne = lignes.slice(debut + 1).find((l) => l.trim() !== '');
  if (!ligne) return null;
  const valeur = ligne.replace(/[*_`]/g, '').trim().toLowerCase().replace(/^ecarts/, 'écarts');
  return VERDICTS.find((v) => valeur.startsWith(v)) ?? null;
}

type Ligne = Record<string, unknown>;

function liste(elements: string[], vide: string): string {
  return elements.length > 0 ? elements.map((e) => `- ${e}`).join('\n') : vide;
}

const NOMS_OUTILS: Record<string, string> = { 'cursor-agent': 'Cursor', claude: 'Claude' };

// outils : rôle → outil (CONFIG.modeles), pour les lignes du journal qui ne disent pas leur outil.
export function resumerJournal(lignes: Ligne[], outils: Record<string, string> = {}): string {
  const deType = (type: string) => lignes.filter((l) => l.type === type);

  const compte = new Map<string, number>();
  for (const l of deType('regle')) {
    const cle = `${l.regle} | ${l.niveau === 'signale' ? 'signalé' : 'bloquant'}`;
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  const regles =
    compte.size > 0
      ? ['| Règle | Niveau | Fois |', '|---|---|---|', ...[...compte].sort((a, b) => b[1] - a[1]).map(([cle, n]) => `| ${cle} | ${n} |`)].join('\n')
      : 'Aucune règle déclenchée.';

  const taches = deType('tache');
  const tableau =
    taches.length > 0
      ? ['| Tâche | Tentatives | Appels LLM | Durée |', '|---|---|---|---|', ...taches.map((t) => `| ${t.tache} | ${t.tentatives} | ${t.appelsLlm} | ${Math.round(Number(t.dureeMs) / 60_000)} min |`)].join('\n')
      : 'Aucune tâche committée.';

  const parOutil = new Map<string, { appels: number; jetons: number }>();
  for (const l of deType('llm')) {
    const outil = String(l.outil ?? outils[String(l.role)] ?? 'outil inconnu');
    const nom = NOMS_OUTILS[outil] ?? outil;
    const total = parOutil.get(nom) ?? { appels: 0, jetons: 0 };
    total.appels++;
    total.jetons += typeof l.tokens === 'number' ? l.tokens : 0;
    parOutil.set(nom, total);
  }
  const consommation =
    parOutil.size > 0
      ? [...parOutil].map(([nom, t]) => `${nom} : ${t.appels} appel(s) · ${t.jetons} jeton(s)`).join(' — ')
      : 'Aucun appel LLM.';

  // Modèle et raison sont journalisés pour les appels Cursor (scripts/lib/modeles.ts) : de quoi juger le choix.
  const choix = deType('llm')
    .filter((l) => l.modele && l.raison)
    .map((l) => {
      const appel = l.role === 'audit' ? `audit ${l.phase}` : `${l.tache} tentative ${l.tentative}`;
      return `${appel} · ${l.modele} (${l.raison}) · ${Math.round(Number(l.dureeMs) / 60_000)} min${l.erreur ? ' · en erreur' : ''}`;
    });

  return [
    '### Règles déclenchées',
    regles,
    '### Arbitrages',
    liste(deType('arbitrage').map((l) => `${l.tache} · ${l.motif} → ${l.decision}`), 'Aucun arbitrage.'),
    '### Questions au développeur',
    liste(deType('question').map((l) => `${l.tache ?? 'branche'} · ${l.motif}`), 'Aucune question.'),
    '### Tests instables',
    liste(deType('instable').map((l) => `${l.tache} · ${l.test}`), 'Aucun test instable.'),
    '### Jalons',
    liste(deType('jalon').map((l) => (l.ok ? `${l.tache} : vert` : `${l.tache} : rouge, premier commit fautif ${l.fautif ?? '?'}`)), 'Aucun jalon (suite rapide : lancée après chaque tâche).'),
    '### Tâches',
    tableau,
    '### Modèles choisis',
    liste(choix, 'Aucun appel Cursor journalisé avec son modèle.'),
    '### Consommation LLM',
    `${consommation}\n\n(Appels lancés par les scripts ; la session Claude qui pilote le workflow n'est pas comptée.)`,
  ].join('\n\n');
}
