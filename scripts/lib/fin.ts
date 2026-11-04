// Fin de branche (workflow-dev.md, 5) : verdict de la review neuve, résumé du journal pour la revue finale,
// et .workflow/fin.json, qui dit sur quel commit « wf finish » est passé.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Fin {
  date: string;
  head: string;
  ok: boolean;
  verdict: string | null;
}

export function lireFin(dossier: string): Fin | null {
  const chemin = join(dossier, 'fin.json');
  return existsSync(chemin) ? (JSON.parse(readFileSync(chemin, 'utf8')) as Fin) : null;
}

export function ecrireFin(dossier: string, fin: Fin): void {
  writeFileSync(join(dossier, 'fin.json'), `${JSON.stringify(fin, null, 2)}\n`);
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

// Contenu de la section « ## Écarts » de la review, null si elle est absente ou vide.
export function sectionEcarts(texte: string): string | null {
  const lignes = texte.split(/\r?\n/);
  const debut = lignes.findIndex((l) => /^##\s+[ÉE]carts\s*$/i.test(l.trim()));
  if (debut < 0) return null;
  const fin = lignes.findIndex((l, i) => i > debut && /^##\s/.test(l.trim()));
  const contenu = lignes.slice(debut + 1, fin < 0 ? undefined : fin).join('\n').trim();
  return contenu === '' ? null : contenu;
}

// Dernière review neuve passée (.workflow/review.json) : la suivante ne relit que les corrections faites depuis.
export interface DerniereReview {
  head: string;
  tour: number;
  // Commit à partir duquel cette review a lu le diff ; null : toute la branche.
  depuis: string | null;
  ecarts: string | null;
  // Écarts de la review du tour précédent, donnés à celle-ci comme ce qui devait être corrigé.
  precedents: string | null;
  // Empreinte de spec.md lue par cette review ; absente pour une review déduite d'un ancien fin.json.
  spec?: string;
}

export interface PorteeReview {
  tour: number;
  depuis: string | null;
  precedents: string | null;
}

// Une branche dont la review a eu lieu avant review.json : la dernière review se déduit du dernier finish réussi.
export function lireDerniereReview(dossier: string): DerniereReview | null {
  const chemin = join(dossier, 'review.json');
  if (existsSync(chemin)) return JSON.parse(readFileSync(chemin, 'utf8')) as DerniereReview;
  const fin = lireFin(dossier);
  if (!fin?.ok || fin.verdict === null) return null;
  const md = join(dossier, 'fin.md');
  const ecarts = existsSync(md) ? sectionEcarts(readFileSync(md, 'utf8')) : null;
  return { head: fin.head, tour: 1, depuis: null, ecarts, precedents: null };
}

export function ecrireDerniereReview(dossier: string, review: DerniereReview): void {
  writeFileSync(join(dossier, 'review.json'), `${JSON.stringify(review, null, 2)}\n`);
}

// Tour 1 : toute la branche. Ensuite, seulement les commits faits depuis la review précédente, si elle est
// dans l'historique de HEAD ; un historique réécrit repart sur toute la branche. Sans nouveau commit, la
// relance garde la portée de la review précédente. Une spec modifiée depuis (revenir spec : nouvelles
// exigences, pas une correction) repart aussi sur toute la branche.
export function porteeReview(derniere: DerniereReview | null, head: string, spec: string, estAncetre: (commit: string) => boolean): PorteeReview {
  if (!derniere) return { tour: 1, depuis: null, precedents: null };
  if (derniere.spec !== undefined && derniere.spec !== spec) return { tour: 1, depuis: null, precedents: null };
  if (derniere.head === head) return { tour: derniere.tour, depuis: derniere.depuis, precedents: derniere.precedents };
  if (estAncetre(derniere.head)) return { tour: derniere.tour + 1, depuis: derniere.head, precedents: derniere.ecarts };
  return { tour: 1, depuis: null, precedents: null };
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
