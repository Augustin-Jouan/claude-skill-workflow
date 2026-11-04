// Contrôle du projet par « wf setup », avant de créer la branche : ce dont verify aura besoin pour lancer les
// tests doit être là. Sinon le problème n'apparaissait qu'au premier verify, après un appel à l'exécuteur.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { binaireLocal, detecterRunner } from './runner.ts';

// Problèmes bloquants, chacun sous la forme « <constat> : <quoi faire> ».
export function controlerProjet(racine: string): string[] {
  const chemin = join(racine, 'package.json');
  if (!existsSync(chemin)) return ['Pas de package.json : le workflow lance les tests avec vitest, jest ou Playwright, déclarés dans le package.json à la racine du dépôt.'];
  if (!existsSync(join(racine, 'node_modules'))) return ["Dépendances non installées : node_modules est absent, lance l'installation du projet."];

  const pkg = JSON.parse(readFileSync(chemin, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const runner = detecterRunner(pkg);
  const playwright = deps['@playwright/test'] !== undefined;
  const problemes: string[] = [];
  // Playwright seul ne suffit pas : run-plan et finish lancent la suite complète avec vitest ou jest.
  if (!runner) problemes.push("Aucun runner unitaire : le projet ne déclare ni vitest ni jest, avec lesquels run-plan et finish lancent la suite complète. Ajoute-en un (Playwright reste utilisé pour les tests e2e).");
  if (runner && !binaireLocal(racine, runner)) problemes.push(`${runner} déclaré mais absent de node_modules : lance l'installation du projet.`);
  if (playwright && !binaireLocal(racine, '@playwright/test', 'playwright')) problemes.push("@playwright/test déclaré mais absent de node_modules : lance l'installation du projet.");
  return problemes;
}
