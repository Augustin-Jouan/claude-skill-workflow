// Outils du projet lancés par verify : runner de tests (vitest ou jest) et eslint, pris dans les
// node_modules du projet, sans rien installer. On lit leurs rapports JSON, jamais leur code de sortie seul.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, posix } from 'node:path';
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

// Lanceurs connus de verify : le runner unitaire (un seul, comme detecterRunner) et Playwright pour l'e2e.
// Le paquet « playwright » seul n'a pas de lanceur de tests : il faut @playwright/test.
export function lanceursDeclares(pkg: PackageJson): string[] {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const runner = detecterRunner(pkg);
  return [...(runner ? [runner] : []), ...(deps['@playwright/test'] ? ['playwright'] : [])];
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

interface SpecPlaywright {
  title: string;
  file: string;
  tests?: Array<{ status: string; results?: Array<{ error?: { message?: string }; errors?: Array<{ message?: string }> }> }>;
}

interface SuitePlaywright {
  file?: string;
  specs?: SpecPlaywright[];
  suites?: SuitePlaywright[];
}

interface RapportPlaywright {
  config?: { rootDir?: string };
  suites?: SuitePlaywright[];
  errors?: Array<{ message?: string; location?: { file?: string } }>;
}

// Même avec FORCE_COLOR=0, les messages d'expect de Playwright gardent leurs couleurs.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const STATUTS_PLAYWRIGHT: Record<string, string> = { expected: 'passed', flaky: 'passed', unexpected: 'failed', skipped: 'skipped' };

// Reporter JSON de Playwright : un test par projet (navigateur), chemins relatifs à config.rootDir.
// Une erreur sans fichier (config, webServer) ou située hors des fichiers lancés (fixture, page object) est
// rapportée sur chacun des fichiers lancés, préfixée de son emplacement.
export function lireRapportPlaywright(json: unknown, racine: string, fichiers: string[] = []): Rapport {
  const brut = json as RapportPlaywright;
  const rootDir = brut.config?.rootDir ?? racine;
  const rapport: Rapport = { tests: [], erreursFichier: {} };
  const parcourir = (suite: SuitePlaywright) => {
    for (const spec of suite.specs ?? []) {
      const fichier = cheminRelatif(join(rootDir, spec.file), racine);
      // Un résultat par projet (navigateur), fusionnés en un seul : échoué si l'un échoue, passé si l'un passe
      // (un test.skip limité à un navigateur ne doit pas bloquer), ignoré sinon.
      const statuts = (spec.tests ?? []).map((t) => STATUTS_PLAYWRIGHT[t.status] ?? t.status);
      if (statuts.length === 0) continue;
      const echecs = (spec.tests ?? [])
        .filter((t) => (STATUTS_PLAYWRIGHT[t.status] ?? t.status) === 'failed')
        .flatMap((t) => (t.results ?? []).flatMap((r) => (r.error?.message ? [r.error.message] : (r.errors ?? []).map((e) => e.message ?? ''))))
        .filter(Boolean)
        .map((m) => m.replace(ANSI, ''));
      const statut = statuts.includes('failed') ? 'failed' : statuts.includes('passed') ? 'passed' : statuts[0];
      rapport.tests.push({ fichier, titre: spec.title, statut, echecs: statut === 'failed' ? echecs : [] });
    }
    for (const s of suite.suites ?? []) parcourir(s);
  };
  for (const s of brut.suites ?? []) parcourir(s);
  for (const e of brut.errors ?? []) {
    const message = (e.message ?? '').replace(ANSI, '').trim();
    if (!message) continue;
    const lieu = e.location?.file ? cheminRelatif(e.location.file, racine) : null;
    const lance = lieu !== null && (fichiers.length === 0 || fichiers.includes(lieu));
    const cibles = lance ? [lieu] : fichiers;
    const texte = lieu && !lance ? `${lieu} : ${message}` : message;
    for (const f of cibles) rapport.erreursFichier[f] = rapport.erreursFichier[f] ? `${rapport.erreursFichier[f]}\n${texte}` : texte;
  }
  return rapport;
}

// Import (statique, dynamique ou require) de @playwright/test ; une simple mention (jest.mock(...)) ne compte pas.
const IMPORT_PLAYWRIGHT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]@playwright\/test['"]/;
const IMPORT_RELATIF = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"](\.\.?\/[^'"]+)['"]/g;
const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '/index.ts', '/index.js'];

// Fichier Playwright : il importe @playwright/test lui-même, ou par un module local qu'il importe (fixtures
// personnalisées : import { test } from './fixtures'), jusqu'à 3 niveaux. Chemins relatifs à la racine.
export function estFichierPlaywright(fichier: string, lire: (fichier: string) => string | null, profondeur = 3, vus = new Set<string>()): boolean {
  if (vus.has(fichier)) return false;
  vus.add(fichier);
  const contenu = lire(fichier);
  if (contenu === null) return false;
  if (IMPORT_PLAYWRIGHT.test(contenu)) return true;
  if (profondeur === 0) return false;
  for (const [, chemin] of contenu.matchAll(IMPORT_RELATIF)) {
    // import './fixtures.js' en ESM désigne souvent fixtures.ts.
    const base = posix.normalize(posix.join(posix.dirname(fichier), chemin.replace(/\.js$/, '')));
    const cible = [...EXTENSIONS.map((e) => base + e), posix.normalize(posix.join(posix.dirname(fichier), chemin))].find((c) => lire(c) !== null);
    if (cible && estFichierPlaywright(cible, lire, profondeur - 1, vus)) return true;
  }
  return false;
}

// Les fichiers Playwright se lancent avec Playwright ; les autres (et ceux qui n'existent pas encore) avec le
// runner unitaire. lire rend null pour un fichier absent ou un dossier.
export function repartirFichiers(fichiers: string[], lire: (fichier: string) => string | null): { playwright: string[]; unitaires: string[] } {
  const playwright = fichiers.filter((f) => estFichierPlaywright(f, lire));
  return { playwright, unitaires: fichiers.filter((f) => !playwright.includes(f)) };
}

// Contenu d'un fichier du projet (chemin relatif ou absolu), null s'il n'existe pas ou n'est pas un fichier.
export function lecteurProjet(racine: string): (fichier: string) => string | null {
  return (f) => {
    const chemin = isAbsolute(f) ? f : join(racine, f);
    try {
      return statSync(chemin).isFile() ? readFileSync(chemin, 'utf8') : null;
    } catch {
      return null;
    }
  };
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

// Résumé court pour l'exécuteur (wf tests) : les comptes, chaque échec avec 5 lignes de message, les fichiers qui
// n'ont pas chargé. ok : au moins un test exécuté, aucun échec, aucun fichier en erreur.
export function resumerRapport(rapport: Rapport): { ok: boolean; texte: string } {
  const erreurs = Object.entries(rapport.erreursFichier);
  if (rapport.tests.length === 0 && erreurs.length === 0) return { ok: false, texte: 'Aucun test exécuté : vérifie les chemins donnés.' };
  const compter = (statut: string) => rapport.tests.filter((t) => t.statut === statut).length;
  const echecs = rapport.tests.filter((t) => t.statut === 'failed');
  const ignores = rapport.tests.length - compter('passed') - echecs.length;
  const lignes = [`${compter('passed')} passé(s), ${echecs.length} en échec, ${ignores} ignoré(s).`];
  for (const t of echecs) {
    lignes.push(`✗ ${t.fichier} › ${t.titre}`, ...(t.echecs[0] ?? '').split('\n').slice(0, 5).filter((l) => l.trim() !== '').map((l) => `    ${l}`));
  }
  for (const [fichier, message] of erreurs) lignes.push(`✗ ${fichier} ne se charge pas : ${message.split('\n')[0]}`);
  return { ok: echecs.length === 0 && erreurs.length === 0, texte: lignes.join('\n') };
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
// commande : le nom de la commande quand il diffère du paquet (@playwright/test → playwright).
export function binaireLocal(racine: string, paquet: string, commande = paquet): string | null {
  const manifeste = join(racine, 'node_modules', paquet, 'package.json');
  if (!existsSync(manifeste)) return null;
  const { bin } = JSON.parse(readFileSync(manifeste, 'utf8')) as { bin?: string | Record<string, string> };
  const relatif = typeof bin === 'string' ? bin : bin?.[commande];
  return relatif ? join(dirname(manifeste), relatif) : null;
}

function lancer(racine: string, script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: racine,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    // CI=true : le runner n'écrit aucun nouveau snapshot.
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0', ...env },
  });
}

// Le reporter JSON de Playwright écrit dans le fichier nommé par PLAYWRIGHT_JSON_OUTPUT_NAME.
// Les fichiers donnés sont des filtres sur le chemin ; sous Windows, Playwright les compare aussi à l'URL file://.
// CI vide : la config type de Playwright fait `reuseExistingServer: !process.env.CI` et `retries: CI ? 2 : 0` ;
// avec CI=true, un serveur de dev déjà lancé faisait échouer le webServer (port occupé).
// --output : traces et captures à côté du rapport, jamais dans le test-results/ du projet (commité sinon).
export function lancerPlaywright(racine: string, binaire: string, fichiers: string[], sortie: string): Rapport {
  mkdirSync(dirname(sortie), { recursive: true });
  rmSync(sortie, { force: true });
  const traces = join(dirname(sortie), 'playwright-resultats');
  const r = lancer(racine, binaire, ['test', '--reporter=json', `--output=${traces}`, ...fichiers], { PLAYWRIGHT_JSON_OUTPUT_NAME: sortie, CI: '' });
  if (!existsSync(sortie)) {
    throw new Error(`playwright n'a pas produit de rapport JSON (code ${r.status}).\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }
  return lireRapportPlaywright(JSON.parse(readFileSync(sortie, 'utf8')), racine, fichiers);
}

function lirePackage(racine: string): PackageJson {
  const pkg = join(racine, 'package.json');
  return existsSync(pkg) ? (JSON.parse(readFileSync(pkg, 'utf8')) as PackageJson) : {};
}

// Runner unitaire du projet et son binaire ; lève une erreur lisible s'il manque.
export function runnerDuProjet(racine: string): { runner: Runner; binaire: string } {
  const runner = detecterRunner(lirePackage(racine));
  if (!runner) throw new Error('Ni vitest ni jest dans les dépendances du projet : impossible de lancer ces tests.');
  const binaire = binaireLocal(racine, runner);
  if (!binaire) throw new Error(`${runner} est déclaré mais absent de node_modules : lance l'installation du projet.`);
  return { runner, binaire };
}

// Lancement commun à verify et à « wf tests » : les fichiers Playwright avec Playwright, les autres avec le
// runner unitaire, rapports fusionnés. dossier : où écrire les rapports JSON (unitaires.json, playwright.json).
export function lancerTestsDuProjet(racine: string, fichiers: string[], dossier: string): Rapport {
  const { playwright, unitaires } = repartirFichiers(fichiers, lecteurProjet(racine));
  const rapports: Rapport[] = [];
  if (unitaires.length > 0) {
    const { runner, binaire } = runnerDuProjet(racine);
    rapports.push(lancerTests(racine, runner, binaire, unitaires, join(dossier, 'unitaires.json')));
  }
  if (playwright.length > 0) {
    const binaire = binaireLocal(racine, '@playwright/test', 'playwright');
    if (!binaire) throw new Error(`${playwright.join(', ')} importe @playwright/test, absent de node_modules : déclare-le et lance l'installation du projet.`);
    rapports.push(lancerPlaywright(racine, binaire, playwright, join(dossier, 'playwright.json')));
  }
  return { tests: rapports.flatMap((r) => r.tests), erreursFichier: Object.assign({}, ...rapports.map((r) => r.erreursFichier)) };
}

// lies : les fichiers sont du code, on lance les tests qui en dépendent (graphe d'imports du runner).
// --forceExit : un test qui laisse une opération ouverte gardait jest en vie environ 8 min après son rapport (AVI, T29).
export function argumentsTests(runner: Runner, fichiers: string[], sortie: string, lies: boolean): string[] {
  if (runner === 'vitest') return [lies ? 'related' : 'run', ...(lies ? ['--run'] : []), '--reporter=json', `--outputFile=${sortie}`, ...fichiers];
  return ['--ci', '--forceExit', '--json', `--outputFile=${sortie}`, lies ? '--findRelatedTests' : '--runTestsByPath', ...fichiers];
}

export function lancerTests(racine: string, runner: Runner, binaire: string, fichiers: string[], sortie: string, lies = false): Rapport {
  mkdirSync(dirname(sortie), { recursive: true });
  rmSync(sortie, { force: true });
  const r = lancer(racine, binaire, argumentsTests(runner, fichiers, sortie, lies));
  if (!existsSync(sortie)) {
    throw new Error(`${runner} n'a pas produit de rapport JSON (code ${r.status}).\n${(r.stderr || r.stdout || '').slice(-2000)}`);
  }
  return sansPlaywright(lireRapport(JSON.parse(readFileSync(sortie, 'utf8')), racine), lecteurProjet(racine));
}

// Un spec Playwright attrapé par la config de vitest ou jest (testMatch par défaut) y échoue toujours : ce n'est
// pas une régression. Ses résultats sont retirés du rapport du runner unitaire.
export function sansPlaywright(rapport: Rapport, lire: (fichier: string) => string | null): Rapport {
  const fichiers = new Set([...rapport.tests.map((t) => t.fichier), ...Object.keys(rapport.erreursFichier)]);
  const playwright = new Set([...fichiers].filter((f) => estFichierPlaywright(f, lire)));
  if (playwright.size === 0) return rapport;
  return {
    tests: rapport.tests.filter((t) => !playwright.has(t.fichier)),
    erreursFichier: Object.fromEntries(Object.entries(rapport.erreursFichier).filter(([f]) => !playwright.has(f))),
  };
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
