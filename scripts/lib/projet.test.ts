import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { controlerProjet } from './projet.ts';

function projet(pkg: object | null, paquets: Record<string, object> = {}, avecNodeModules = true): string {
  const racine = mkdtempSync(join(tmpdir(), 'wf-projet-'));
  if (pkg) writeFileSync(join(racine, 'package.json'), JSON.stringify(pkg));
  if (avecNodeModules) mkdirSync(join(racine, 'node_modules'));
  for (const [nom, manifeste] of Object.entries(paquets)) {
    mkdirSync(join(racine, 'node_modules', nom), { recursive: true });
    writeFileSync(join(racine, 'node_modules', nom, 'package.json'), JSON.stringify(manifeste));
  }
  return racine;
}

function controler(...args: Parameters<typeof projet>): string[] {
  const racine = projet(...args);
  try {
    return controlerProjet(racine).map((p) => p.split(' :')[0]);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
}

const JEST = { jest: { bin: { jest: 'cli.js' } } };
const PLAYWRIGHT = { '@playwright/test': { bin: { playwright: 'cli.js' } } };

test('un projet installé avec son runner et Playwright passe', () => {
  assert.deepEqual(controler({ devDependencies: { jest: '29', '@playwright/test': '1' } }, { ...JEST, ...PLAYWRIGHT }), []);
});

test('package.json absent, dépendances non installées, runner absent ou non installé : bloquant', () => {
  assert.deepEqual(controler(null), ['Pas de package.json']);
  assert.deepEqual(controler({ devDependencies: { jest: '29' } }, {}, false), ['Dépendances non installées']);
  assert.deepEqual(controler({ devDependencies: { mocha: '1' } }), ['Aucun runner unitaire']);
  // Playwright seul : run-plan et finish refuseraient le projet plus tard.
  assert.deepEqual(controler({ devDependencies: { '@playwright/test': '1' } }, PLAYWRIGHT), ['Aucun runner unitaire']);
  assert.deepEqual(controler({ devDependencies: { jest: '29' } }), ['jest déclaré mais absent de node_modules']);
  assert.deepEqual(controler({ devDependencies: { vitest: '3', '@playwright/test': '1' } }, { vitest: { bin: { vitest: 'v.mjs' } } }), [
    '@playwright/test déclaré mais absent de node_modules',
  ]);
});
