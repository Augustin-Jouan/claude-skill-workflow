// Vérifications de run-plan entre les tâches (workflow-dev.md, 4.7 et 4.5) : suite complète et typecheck,
// comparés à leur état d'avant la première tâche, et couverture des fichiers d'une tâche refactor.
// Un échec déjà présent au départ ou un test en quarantaine (.workflow/quarantine.json) ne bloque pas.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cheminRelatif, type Rapport, type Runner } from './runner.ts';

export function echecsSuite(r: Rapport): string[] {
  const tests = r.tests.filter((t) => t.statut === 'failed').map((t) => `${t.fichier} › ${t.titre}`);
  return [...tests, ...Object.keys(r.erreursFichier).map((f) => `${f} › (chargement)`)];
}

export function comparerSuite(reference: string[], actuels: string[], quarantaine: string[]): { regressions: string[]; enQuarantaine: string[] } {
  const nouveaux = actuels.filter((e) => !reference.includes(e));
  return { regressions: nouveaux.filter((e) => !quarantaine.includes(e)), enQuarantaine: actuels.filter((e) => quarantaine.includes(e)) };
}

export function lireQuarantaine(texte: string): string[] {
  const brut = JSON.parse(texte) as unknown;
  const valide = Array.isArray(brut) && brut.every((e) => typeof e?.fichier === 'string' && typeof e?.nom === 'string');
  if (!valide) throw new Error('.workflow/quarantine.json doit être une liste de { "fichier": "...", "nom": "..." }.');
  return (brut as Array<{ fichier: string; nom: string }>).map((e) => `${e.fichier} › ${e.nom}`);
}

const ERREUR_TSC = /^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/;

export function erreursTsc(sortie: string): string[] {
  return sortie
    .split(/\r?\n/)
    .map((l) => ERREUR_TSC.exec(l))
    .filter((m) => m !== null)
    .map((m) => `${m[1].replace(/\\/g, '/')}: ${m[2]} ${m[3]}`);
}

export function nouvellesErreurs(reference: string[], actuelles: string[]): string[] {
  const restantes = [...reference];
  const nouvelles: string[] = [];
  for (const e of actuelles) {
    const i = restantes.indexOf(e);
    if (i >= 0) restantes.splice(i, 1);
    else if (!nouvelles.includes(e)) nouvelles.push(e);
  }
  return nouvelles;
}

export function lireCouverture(resume: Record<string, unknown>, racine: string, fichiers: string[]): Array<{ fichier: string; pct: number }> {
  const parFichier = new Map<string, number>();
  for (const [cle, valeur] of Object.entries(resume)) {
    const pct = (valeur as { lines?: { pct?: unknown } }).lines?.pct;
    if (cle !== 'total' && typeof pct === 'number') parFichier.set(cheminRelatif(cle, racine).replace(/\\/g, '/'), pct);
  }
  return fichiers.map((f) => ({ fichier: f, pct: parFichier.get(f) ?? 0 }));
}

// Typecheck du projet avec son propre tsc, si le projet en a un. null quand il n'y en a pas.
export function lancerTsc(racine: string): string[] | null {
  const binaire = join(racine, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(binaire) || !existsSync(join(racine, 'tsconfig.json'))) return null;
  const r = spawnSync(process.execPath, [binaire, '--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: racine,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  if (r.status !== 0 && r.status !== 1 && r.status !== 2) throw new Error(`tsc a planté (code ${r.status}).\n${(r.stderr || '').slice(-2000)}`);
  return erreursTsc(r.stdout);
}

const FOURNISSEURS_VITEST = ['@vitest/coverage-v8', '@vitest/coverage-istanbul'];

// Couverture des lignes des fichiers donnés, mesurée par toute la suite. null si le projet ne peut pas la mesurer.
export function lancerCouverture(racine: string, runner: Runner, binaire: string, fichiers: string[], dossier: string): Array<{ fichier: string; pct: number }> | null {
  if (runner === 'vitest' && !FOURNISSEURS_VITEST.some((p) => existsSync(join(racine, 'node_modules', p)))) return null;
  rmSync(dossier, { recursive: true, force: true });
  mkdirSync(dossier, { recursive: true });
  const args =
    runner === 'vitest'
      ? ['run', '--coverage.enabled=true', '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${dossier}`, ...fichiers.map((f) => `--coverage.include=${f}`)]
      : ['--ci', '--coverage', '--coverageReporters=json-summary', `--coverageDirectory=${dossier}`, ...fichiers.map((f) => `--collectCoverageFrom=${f}`)];
  spawnSync(process.execPath, [binaire, ...args], {
    cwd: racine,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
    env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
  });
  const resume = join(dossier, 'coverage-summary.json');
  if (!existsSync(resume)) return null;
  return lireCouverture(JSON.parse(readFileSync(resume, 'utf8')) as Record<string, unknown>, racine, fichiers);
}
