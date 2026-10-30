// Lecture de .workflow/plan.md : seuls les blocs ```yaml comptent. Le premier est l'en-tête,
// les suivants listent les tâches. Le schéma est strict : un champ inconnu est une erreur,
// pour qu'une faute de frappe ne désactive jamais une règle en silence.

import { parse, YAMLError } from 'yaml';
import { PARCOURS, type Parcours } from './etat.ts';

export const TYPES_TACHE = ['feature', 'fix', 'refactor'] as const;
export type TypeTache = (typeof TYPES_TACHE)[number];
// Choisit le modèle Cursor de l'exécuteur (scripts/lib/modeles.ts).
export const DIFFICULTES = ['simple', 'complexe'] as const;
export type Difficulte = (typeof DIFFICULTES)[number];

export interface TestPrevu {
  nom: string;
  assertions: string[];
  comportement_existant: boolean;
}

export interface TestModifiable {
  fichier: string;
  raison: string;
}

export interface Tache {
  id: string;
  type: TypeTache;
  difficulte: Difficulte;
  e2e: boolean;
  exigences: string[];
  depends_on: string[];
  fichiers_prevus: string[];
  tests: TestPrevu[];
  tests_modifiables: TestModifiable[];
}

export interface EntetePlan {
  parcours: Parcours;
  e2e_non_applicable?: string;
  jalons: string[];
}

export interface Plan {
  entete: EntetePlan;
  taches: Tache[];
}

export interface Violation {
  regle: string;
  message: string;
  tache?: string;
}

export interface LecturePlan {
  plan: Plan | null;
  violations: Violation[];
}

const CHAMPS_ENTETE = ['parcours', 'e2e_non_applicable', 'jalons'];
const CHAMPS_TACHE = ['id', 'type', 'difficulte', 'e2e', 'exigences', 'depends_on', 'fichiers_prevus', 'tests', 'tests_modifiables'];
const CHAMPS_TEST = ['nom', 'assertions', 'comportement_existant'];
const CHAMPS_MODIFIABLE = ['fichier', 'raison'];
// Hors parcours micro, ces champs doivent être écrits explicitement, même vides.
const EXPLICITES_HORS_MICRO = ['difficulte', 'e2e', 'depends_on', 'tests_modifiables'];

type Objet = Record<string, unknown>;

function estObjet(v: unknown): v is Objet {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function estListeDeTextes(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '');
}

function champsInconnus(o: Objet, connus: string[]): string[] {
  return Object.keys(o).filter((k) => !connus.includes(k));
}

function extraireBlocs(md: string): string[] {
  const blocs: string[] = [];
  const re = /^```ya?ml[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;
  for (let m = re.exec(md); m; m = re.exec(md)) blocs.push(m[1]);
  return blocs;
}

export function lirePlan(md: string): LecturePlan {
  const format = (message: string, tache?: string): Violation => ({ regle: 'format', message, tache });
  const blocs = extraireBlocs(md);
  if (blocs.length === 0) {
    return { plan: null, violations: [format('Le plan ne contient aucun bloc ```yaml (en-tête puis tâches).')] };
  }

  const donnees: unknown[] = [];
  const erreursSyntaxe: Violation[] = [];
  blocs.forEach((bloc, i) => {
    try {
      donnees.push(parse(bloc));
    } catch (e) {
      const detail = e instanceof YAMLError ? e.message.split('\n')[0] : String(e);
      erreursSyntaxe.push(format(`YAML invalide dans le bloc ${i + 1} : ${detail}`));
    }
  });
  if (erreursSyntaxe.length > 0) return { plan: null, violations: erreursSyntaxe };

  const lecture = lireEntete(donnees[0]);
  if ('violations' in lecture) return { plan: null, violations: lecture.violations };
  const entete = lecture.entete;

  const violations: Violation[] = [];
  const taches: Tache[] = [];
  donnees.slice(1).forEach((bloc, i) => {
    if (!Array.isArray(bloc)) {
      violations.push(format(`Le bloc ${i + 2} doit être une liste de tâches (« - id: T1 … »).`));
      return;
    }
    for (const brute of bloc) {
      const tache = lireTache(brute, taches.length + 1, entete.parcours, violations);
      if (tache) taches.push(tache);
    }
  });

  const vus = new Set<string>();
  for (const t of taches) {
    if (vus.has(t.id)) violations.push(format(`L'identifiant de tâche ${t.id} est utilisé plusieurs fois.`, t.id));
    vus.add(t.id);
  }
  if (taches.length === 0 && violations.length === 0) violations.push(format('Le plan ne contient aucune tâche.'));

  return violations.length > 0 ? { plan: null, violations } : { plan: { entete, taches }, violations };
}

function lireEntete(brut: unknown): { entete: EntetePlan } | { violations: Violation[] } {
  const v = (message: string): Violation => ({ regle: 'format', message: `En-tête (bloc 1) : ${message}` });
  if (!estObjet(brut)) return { violations: [v('doit être un objet (« parcours: court » …), pas une liste.')] };

  const violations = champsInconnus(brut, CHAMPS_ENTETE).map((k) => v(`champ inconnu « ${k} ».`));
  if (!PARCOURS.includes(brut.parcours as Parcours)) {
    violations.push(v(`parcours doit valoir ${PARCOURS.join(', ')}.`));
  }
  if (brut.e2e_non_applicable !== undefined && typeof brut.e2e_non_applicable !== 'string') {
    violations.push(v('e2e_non_applicable doit être un texte.'));
  }
  if (brut.jalons !== undefined && !estListeDeTextes(brut.jalons)) {
    violations.push(v('jalons doit être une liste d\'identifiants de tâches.'));
  }
  if (violations.length > 0) return { violations };

  return {
    entete: {
      parcours: brut.parcours as Parcours,
      e2e_non_applicable: brut.e2e_non_applicable as string | undefined,
      jalons: (brut.jalons as string[] | undefined) ?? [],
    },
  };
}

function lireTache(brut: unknown, rang: number, parcours: Parcours, violations: Violation[]): Tache | null {
  if (!estObjet(brut)) {
    violations.push({ regle: 'format', message: `La tâche n°${rang} doit être un objet.` });
    return null;
  }
  const nom = typeof brut.id === 'string' && brut.id.trim() !== '' ? brut.id : `n°${rang}`;
  const avant = violations.length;
  const v = (message: string) => violations.push({ regle: 'format', message: `Tâche ${nom} : ${message}`, tache: nom });

  if (nom === `n°${rang}`) v('id manquant ou vide.');
  for (const k of champsInconnus(brut, CHAMPS_TACHE)) v(`champ inconnu « ${k} ».`);
  if (parcours !== 'micro') {
    for (const k of EXPLICITES_HORS_MICRO) if (!Object.hasOwn(brut, k)) v(`${k} est obligatoire hors parcours micro.`);
  }

  if (!TYPES_TACHE.includes(brut.type as TypeTache)) v(`type doit valoir ${TYPES_TACHE.join(', ')}.`);
  if (brut.difficulte !== undefined && !DIFFICULTES.includes(brut.difficulte as Difficulte)) v(`difficulte doit valoir ${DIFFICULTES.join(', ')}.`);
  if (brut.e2e !== undefined && typeof brut.e2e !== 'boolean') v('e2e doit valoir true ou false.');
  if (!estListeDeTextes(brut.exigences)) v('exigences doit être une liste d\'identifiants EX-n.');
  if (brut.depends_on !== undefined && !estListeDeTextes(brut.depends_on)) v('depends_on doit être une liste d\'identifiants de tâches.');
  if (!estListeDeTextes(brut.fichiers_prevus) || brut.fichiers_prevus.length === 0) {
    v('fichiers_prevus doit lister au moins un fichier.');
  }

  const tests = lireTests(brut.tests, v);
  const modifiables = lireModifiables(brut.tests_modifiables, v);

  if (violations.length > avant) return null;
  return {
    id: nom,
    type: brut.type as TypeTache,
    difficulte: (brut.difficulte as Difficulte | undefined) ?? 'simple',
    e2e: (brut.e2e as boolean | undefined) ?? false,
    exigences: brut.exigences as string[],
    depends_on: (brut.depends_on as string[] | undefined) ?? [],
    fichiers_prevus: brut.fichiers_prevus as string[],
    tests: tests ?? [],
    tests_modifiables: modifiables ?? [],
  };
}

function lireTests(brut: unknown, v: (m: string) => void): TestPrevu[] | null {
  if (!Array.isArray(brut)) {
    v('tests doit être une liste (vide pour une tâche refactor).');
    return null;
  }
  const tests: TestPrevu[] = [];
  brut.forEach((t, i) => {
    const ou = `tests[${i + 1}]`;
    if (!estObjet(t)) return v(`${ou} doit être un objet { nom, assertions }.`);
    for (const k of champsInconnus(t, CHAMPS_TEST)) v(`${ou} : champ inconnu « ${k} ».`);
    if (typeof t.nom !== 'string' || t.nom.trim() === '') v(`${ou} : nom manquant.`);
    if (!estListeDeTextes(t.assertions) || t.assertions.length < 1 || t.assertions.length > 2) {
      v(`${ou} : une ou deux assertions clés, pas plus.`);
    }
    if (t.comportement_existant !== undefined && typeof t.comportement_existant !== 'boolean') {
      v(`${ou} : comportement_existant doit valoir true ou false.`);
    }
    tests.push({
      nom: t.nom as string,
      assertions: t.assertions as string[],
      comportement_existant: (t.comportement_existant as boolean | undefined) ?? false,
    });
  });
  return tests;
}

function lireModifiables(brut: unknown, v: (m: string) => void): TestModifiable[] | null {
  if (brut === undefined) return [];
  if (!Array.isArray(brut)) {
    v('tests_modifiables doit être une liste.');
    return null;
  }
  const modifiables: TestModifiable[] = [];
  brut.forEach((m, i) => {
    const ou = `tests_modifiables[${i + 1}]`;
    if (!estObjet(m)) return v(`${ou} doit être un objet { fichier, raison }.`);
    for (const k of champsInconnus(m, CHAMPS_MODIFIABLE)) v(`${ou} : champ inconnu « ${k} ».`);
    if (typeof m.fichier !== 'string' || m.fichier.trim() === '') v(`${ou} : fichier manquant.`);
    // Une raison absente reste vide ici : la règle « raison-manquante » la signale avec son propre message.
    if (m.raison !== undefined && m.raison !== null && typeof m.raison !== 'string') v(`${ou} : raison doit être un texte.`);
    modifiables.push({ fichier: m.fichier as string, raison: typeof m.raison === 'string' ? m.raison : '' });
  });
  return modifiables;
}
