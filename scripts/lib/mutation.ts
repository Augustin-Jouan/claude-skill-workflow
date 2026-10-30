// Mutation testing de fin de branche (workflow-dev.md, 5.3) : Stryker, installé dans le skill et non dans
// le projet, lance le runner du projet sur les tests liés à chaque mutant (« command runner »). Tout ce qu'il
// écrit reste dans .workflow/. Les survivants du code des tâches feature sont ensuite analysés par un LLM.

import { parse } from 'yaml';
import type { Runner } from './runner.ts';

export interface Mutant {
  id: string;
  mutateur: string;
  remplacement: string;
  ligne: number;
  statut: string;
}

export interface FichierMutation {
  fichier: string;
  total: number;
  tues: number;
  timeouts: number;
  score: number;
  survivants: Mutant[];
}

const TUES = ['Killed', 'Timeout'];
const SURVIVANTS = ['Survived', 'NoCoverage'];

interface MutantStryker {
  id: string;
  mutatorName: string;
  replacement?: string;
  status: string;
  location: { start: { line: number } };
}

// Les mutants qui ne compilent pas, plantent ou sont ignorés ne comptent pas dans le score.
export function lireMutants(rapport: { files: Record<string, { mutants: MutantStryker[] }> }): FichierMutation[] {
  return Object.entries(rapport.files).map(([chemin, f]) => {
    const valides = f.mutants.filter((m) => TUES.includes(m.status) || SURVIVANTS.includes(m.status));
    const tues = valides.filter((m) => TUES.includes(m.status)).length;
    return {
      fichier: chemin.replaceAll('\\', '/'),
      total: valides.length,
      tues,
      timeouts: valides.filter((m) => m.status === 'Timeout').length,
      score: valides.length === 0 ? 100 : Math.round((tues / valides.length) * 100),
      survivants: valides
        .filter((m) => SURVIVANTS.includes(m.status))
        .map((m) => ({ id: m.id, mutateur: m.mutatorName, remplacement: m.replacement ?? '', ligne: m.location.start.line, statut: m.status })),
    };
  });
}

// Seuls les survivants du code des tâches feature sont analysés, sur les fichiers qui en ont le plus.
export function choisirAnalyses(fichiers: FichierMutation[], fichiersFeature: string[], max: number): { analyses: FichierMutation[]; autres: FichierMutation[] } {
  const parSurvivants = fichiers.filter((f) => f.survivants.length > 0).sort((a, b) => b.survivants.length - a.survivants.length);
  const analyses = parSurvivants.filter((f) => fichiersFeature.includes(f.fichier)).slice(0, max);
  return { analyses, autres: parSurvivants.filter((f) => !analyses.includes(f)) };
}

// Les ids de Stryker changent d'un run à l'autre : un mutant se reconnaît à sa place et à son effet.
export function cleMutant(fichier: string, m: Mutant): string {
  return `${fichier}:${m.ligne}:${m.mutateur}:${m.remplacement}`;
}

// Un survivant n'est soumis à l'analyse que s'il est sur une ligne changée par la branche (le reste du fichier
// n'est pas son travail) et s'il n'a pas déjà été soumis lors d'une fin précédente de la branche : s'il survit
// encore, c'est que le développeur n'a pas retenu le test proposé.
export function trierSurvivants(f: FichierMutation, lignes: ReadonlySet<number>, vus: ReadonlySet<string>): { aAnalyser: Mutant[]; horsBranche: Mutant[]; dejaProposes: Mutant[] } {
  const horsBranche = f.survivants.filter((m) => !lignes.has(m.ligne));
  const dejaProposes = f.survivants.filter((m) => lignes.has(m.ligne) && vus.has(cleMutant(f.fichier, m)));
  return { aAnalyser: f.survivants.filter((m) => !horsBranche.includes(m) && !dejaProposes.includes(m)), horsBranche, dejaProposes };
}

export function formaterMutants(mutants: Mutant[]): string {
  return mutants.map((m) => `- ${m.id} · ligne ${m.ligne} · ${m.mutateur} → \`${m.remplacement}\` (${m.statut})`).join('\n');
}

export interface ConfigStryker {
  testRunner: 'command';
  commandRunner: { command: string };
  mutate: string[];
  coverageAnalysis: 'off';
  reporters: string[];
  jsonReporter: { fileName: string };
  tempDirName: string;
  ignorePatterns: string[];
  incremental: boolean;
  incrementalFile: string;
  concurrency: number;
  timeoutMS: number;
  plugins: string[];
}

// binaire : chemin du runner relatif à la racine du projet (node_modules est relié dans le bac à sable de Stryker).
// dossier : celui du workflow de la branche, relatif à la racine (.workflow/<slug>).
export function configStryker(o: { runner: Runner; binaire: string; fichiers: string[]; dossier: string; concurrence: number }): ConfigStryker {
  const tests = o.runner === 'vitest' ? `related --run ${o.fichiers.join(' ')}` : `--ci --findRelatedTests ${o.fichiers.join(' ')}`;
  return {
    testRunner: 'command',
    commandRunner: { command: `node ${o.binaire} ${tests}` },
    mutate: o.fichiers,
    coverageAnalysis: 'off',
    reporters: ['json'],
    jsonReporter: { fileName: `${o.dossier}/rapports/mutation.json` },
    tempDirName: `${o.dossier}/stryker-tmp`,
    ignorePatterns: ['/.workflow'],
    incremental: true,
    incrementalFile: `${o.dossier}/stryker-incremental.json`,
    // Chaque mutant relance le runner du projet en entier : peu de processus à la fois, délai large.
    concurrency: o.concurrence,
    timeoutMS: 30_000,
    plugins: [],
  };
}

// Le runner « command » ne dit pas à Stryker quels tests existent : son mode incrémental ne suit que le code
// muté et garderait un survivant qu'un test ajouté depuis tue. Les résultats gardés ne valent donc que si rien
// d'autre que le code muté n'a changé depuis le run précédent. changes null : run précédent inconnu.
export function incrementalReutilisable(changes: string[] | null, mutes: string[]): boolean {
  return changes !== null && changes.every((f) => mutes.includes(f));
}

export interface TestPropose {
  nom: string;
  assertions: string[];
  comportement_existant: true;
  mutants: string[];
}

export interface AnalyseSurvivants {
  equivalents: Array<{ mutant: string; raison: string }>;
  tests: TestPropose[];
  erreurs: string[];
}

const chaine = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

// Réponse attendue de prompts/survivants.md : un bloc YAML { equivalents, tests }.
// survivants : ids des mutants soumis à l'analyse ; un id hors de cette liste est une invention.
export function lireAnalyseSurvivants(texte: string, survivants?: string[]): AnalyseSurvivants {
  const vide = (erreurs: string[]): AnalyseSurvivants => ({ equivalents: [], tests: [], erreurs });
  const bloc = /```ya?ml\s*\n([\s\S]*?)```/.exec(texte)?.[1];
  if (bloc === undefined) return vide(['Aucun bloc yaml dans la réponse.']);
  let brut: { equivalents?: unknown; tests?: unknown };
  try {
    brut = (parse(bloc) ?? {}) as typeof brut;
  } catch (e) {
    return vide([`YAML invalide : ${e instanceof Error ? e.message : String(e)}`]);
  }
  const erreurs: string[] = [];
  if (!Array.isArray(brut.equivalents)) erreurs.push('« equivalents » doit être une liste.');
  if (!Array.isArray(brut.tests)) erreurs.push('« tests » doit être une liste.');
  const equivalents = (Array.isArray(brut.equivalents) ? brut.equivalents : []) as Array<Record<string, unknown>>;
  const tests = (Array.isArray(brut.tests) ? brut.tests : []) as Array<Record<string, unknown>>;
  equivalents.forEach((e, i) => {
    if (!chaine(e?.mutant) || !chaine(e?.raison)) erreurs.push(`equivalents[${i}] : « mutant » et « raison » sont requis.`);
  });
  tests.forEach((t, i) => {
    if (!chaine(t?.nom) || !/^EX-\d+ — /.test(t.nom)) erreurs.push(`tests[${i}] : le nom doit commencer par « EX-n — ».`);
    const a = t?.assertions;
    if (!Array.isArray(a) || a.length < 1 || a.length > 2 || !a.every(chaine)) erreurs.push(`tests[${i}] : une ou deux assertions.`);
    if (t?.comportement_existant !== true) erreurs.push(`tests[${i}] : comportement_existant doit valoir true.`);
    if (!Array.isArray(t?.mutants) || !t.mutants.every(chaine)) erreurs.push(`tests[${i}] : « mutants » doit lister des ids.`);
  });
  if (survivants && erreurs.length === 0) {
    const cites = [...equivalents.map((e) => String(e.mutant)), ...tests.flatMap((t) => (t.mutants as unknown[]).map(String))];
    for (const id of new Set(cites)) if (!survivants.includes(id)) erreurs.push(`Mutant ${id} inconnu : seuls ${survivants.join(', ')} survivent.`);
  }
  if (erreurs.length > 0) return vide(erreurs);
  return {
    equivalents: equivalents.map((e) => ({ mutant: String(e.mutant), raison: String(e.raison) })),
    tests: tests as unknown as TestPropose[],
    erreurs: [],
  };
}
