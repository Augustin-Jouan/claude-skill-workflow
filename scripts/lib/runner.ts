// Outils du projet lancés par verify : runner de tests (vitest ou jest) et eslint, pris dans les
// node_modules du projet, sans rien installer. On lit leurs rapports JSON, jamais leur code de sortie seul.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CODE_SOURCE, type Constat } from './constat.ts';
import { normaliserNomTest } from './nom-test.ts';

export type Runner = 'vitest' | 'jest';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface ResultatTest {
  fichier: string;
  titre: string;
  statut: string;
  echecs: string[];
}

export interface Rapport {
  tests: ResultatTest[];
  erreursFichier: Record<string, string>;
}

export function detecterRunner(pkg: PackageJson): Runner | null {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.vitest) return 'vitest';
  if (deps.jest) return 'jest';
  return null;
}

export function cheminRelatif(absolu: string, racine: string): string {
  const a = absolu.replace(/\\/g, '/');
  const r = racine.replace(/\\/g, '/').replace(/\/$/, '');
  return a.toLowerCase().startsWith(`${r.toLowerCase()}/`) ? a.slice(r.length + 1) : a;
}

interface RapportBrut {
  testResults?: Array<{
    name: string;
    message?: string;
    assertionResults?: Array<{ title: string; status: string; failureMessages?: string[] }>;
  }>;
}

// Format commun au reporter JSON de vitest et à `jest --json`.
export function lireRapport(json: unknown, racine: string): Rapport {
  const rapport: Rapport = { tests: [], erreursFichier: {} };
  for (const fichier of (json as RapportBrut).testResults ?? []) {
    const chemin = cheminRelatif(fichier.name, racine);
    if (fichier.message?.trim()) rapport.erreursFichier[chemin] = fichier.message.trim();
    for (const a of fichier.assertionResults ?? []) {
      rapport.tests.push({ fichier: chemin, titre: a.title, statut: a.status, echecs: a.failureMessages ?? [] });
    }
  }
  return rapport;
}

// Chaque test prévu doit figurer dans un fichier de test prévu, avec le statut « passé ».
// Le nom est comparé au titre seul (sans les describe parents), après normalisation.
export function verifierTestsPrevus(noms: string[], fichiersPrevus: string[], rapport: Rapport): Constat[] {
  const constats: Constat[] = [];
  for (const nom of noms) {
    const candidats = rapport.tests.filter((t) => fichiersPrevus.includes(t.fichier) && normaliserNomTest(t.titre) === normaliserNomTest(nom));
    const echec = candidats.find((t) => t.statut === 'failed');
    const fichier = candidats[0]?.fichier ?? fichiersPrevus.join(', ');
    if (candidats.length > 0 && candidats.every((t) => t.statut === 'passed')) continue;
    if (echec) {
      constats.push({ regle: 'test-prevu-echec', niveau: 'bloquant', fichier, message: `« ${nom} » échoue.\n${(echec.echecs[0] ?? '').split('\n').slice(0, 5).join('\n')}` });
    } else if (candidats.length > 0) {
      constats.push({ regle: 'test-prevu-non-execute', niveau: 'bloquant', fichier, message: `« ${nom} » n'a pas été exécuté (statut ${candidats[0].statut}).` });
    } else {
      const erreurs = fichiersPrevus.filter((f) => rapport.erreursFichier[f]).map((f) => `${f} : ${rapport.erreursFichier[f].split('\n')[0]}`);
      constats.push({
        regle: 'test-prevu-absent',
        niveau: 'bloquant',
        fichier,
        message: `« ${nom} » est introuvable dans le rapport des fichiers ${fichiersPrevus.join(', ') || '(aucun fichier de test prévu)'}.${erreurs.length > 0 ? `\n${erreurs.join('\n')}` : ''}`,
      });
    }
  }
  return constats;
}

interface SortieEslint {
  filePath: string;
  messages: Array<{ line?: number; severity: number; ruleId: string | null; message: string }>;
}

// Erreurs du lint du projet situées sur les lignes modifiées (toutes les lignes pour un fichier nouveau).
export function filtrerEslint(sortie: unknown, racine: string, lignes: Map<string, Set<number> | null>): Constat[] {
  const constats: Constat[] = [];
  for (const f of sortie as SortieEslint[]) {
    const chemin = cheminRelatif(f.filePath, racine);
    if (!lignes.has(chemin)) continue;
    const modifiees = lignes.get(chemin);
    for (const m of f.messages) {
      if (m.severity !== 2 || m.line === undefined || (modifiees && !modifiees.has(m.line))) continue;
      constats.push({ regle: 'lint-projet', niveau: 'bloquant', fichier: chemin, ligne: m.line, message: `${m.ruleId ?? 'eslint'} : ${m.message}` });
    }
  }
  return constats;
}

// Script d'entrée d'un outil installé dans le projet (champ « bin » de son package.json).
export function binaireLocal(racine: string, paquet: string): string | null {
  const manifeste = join(racine, 'node_modules', paquet, 'package.json');
  if (!existsSync(manifeste)) return null;
  const { bin } = JSON.parse(readFileSync(manifeste, 'utf8')) as { bin?: string | Record<string, string> };
  const relatif = typeof bin === 'string' ? bin : bin?.[paquet];
  return relatif ? join(dirname(manifeste), relatif) : null;
}

function lancer(racine: string, script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: racine,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    // CI=true : le runner n'écrit aucun nouveau snapshot.
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
  });
}

// lies : les fichiers sont du code, on lance les tests qui en dépendent (graphe d'imports du runner).
export function argumentsTests(runner: Runner, fichiers: string[], sortie: string, lies: boolean): string[] {
  if (runner === 'vitest') return [lies ? 'related' : 'run', ...(lies ? ['--run'] : []), '--reporter=json', `--outputFile=${sortie}`, ...fichiers];
  return ['--ci', '--json', `--outputFile=${sortie}`, lies ? '--findRelatedTests' : '--runTestsByPath', ...fichiers];
}

export function lancerTests(racine: string, runner: Runner, binaire: string, fichiers: string[], sortie: string, lies = false): Rapport {
  mkdirSync(dirname(sortie), { recursive: true });
  rmSync(sortie, { force: true });
  const r = lancer(racine, binaire, argumentsTests(runner, fichiers, sortie, lies));
  if (!existsSync(sortie)) {
    throw new Error(`${runner} n'a pas produit de rapport JSON (code ${r.status}).\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }
  return lireRapport(JSON.parse(readFileSync(sortie, 'utf8')), racine);
}

const CONFIGS_ESLINT = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml'];

export function configEslintPresente(racine: string): boolean {
  if (CONFIGS_ESLINT.some((f) => existsSync(join(racine, f)))) return true;
  const pkg = join(racine, 'package.json');
  return existsSync(pkg) && 'eslintConfig' in (JSON.parse(readFileSync(pkg, 'utf8')) as object);
}

// Lint du projet avec sa propre config, commentaires eslint-disable ignorés. Lève une erreur s'il plante.
export function lancerEslint(racine: string, binaire: string, fichiers: string[]): unknown {
  const r = lancer(racine, binaire, ['--no-inline-config', '--format', 'json', ...fichiers]);
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`eslint a planté (code ${r.status}).\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }
  return JSON.parse(r.stdout);
}

const CONFIGS_PRETTIER = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.json5', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs', 'prettier.config.ts'];

export function configPrettierPresente(racine: string): boolean {
  if (CONFIGS_PRETTIER.some((f) => existsSync(join(racine, f)))) return true;
  const pkg = join(racine, 'package.json');
  return existsSync(pkg) && 'prettier' in (JSON.parse(readFileSync(pkg, 'utf8')) as object);
}

// Corrections automatiques de run-plan avant verify (workflow-dev.md, 4.1) : eslint --fix puis le formateur,
// avec la config du projet, s'il les a. Leurs erreurs restantes sont jugées par verify. Rend les outils lancés.
export function corrigerFichiers(racine: string, fichiers: string[]): string[] {
  const lances: string[] = [];
  const code = fichiers.filter((f) => CODE_SOURCE.test(f));
  const eslint = binaireLocal(racine, 'eslint');
  if (code.length > 0 && eslint && configEslintPresente(racine)) {
    lancer(racine, eslint, ['--fix', ...code]);
    lances.push('eslint --fix');
  }
  const prettier = binaireLocal(racine, 'prettier');
  if (fichiers.length > 0 && prettier && configPrettierPresente(racine)) {
    lancer(racine, prettier, ['--write', '--ignore-unknown', ...fichiers]);
    lances.push('prettier --write');
  }
  return lances;
}
