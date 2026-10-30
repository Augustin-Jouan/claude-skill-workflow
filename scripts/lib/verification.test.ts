import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Changement } from './diff.ts';
import type { Tache } from './plan.ts';
import { verifierChangements } from './verification.ts';

const TACHE: Tache = {
  id: 'T1',
  type: 'feature',
  difficulte: 'simple',
  e2e: false,
  exigences: ['EX-1'],
  depends_on: [],
  fichiers_prevus: ['src/invoice.ts', 'src/invoice.test.ts'],
  tests: [{ nom: 'EX-1 — refuse', assertions: ['lève'], comportement_existant: false }],
  tests_modifiables: [{ fichier: 'test/fixtures/invoice.json', raison: 'nouveau champ' }],
};

const VERROUILLES = ['tsconfig*.json', 'vitest.config.*', 'package.json#scripts', '.github/**'];
const FICHIERS_TEST = ['**/*.test.*', '**/*.spec.*', '**/__snapshots__/**', '**/test/**'];

function ch(chemin: string, statut: Changement['statut'], avant: string | null, apres: string | null, lignes: number[] | null = null): Changement {
  return { chemin, statut, avant, apres, lignes: lignes ? new Set(lignes) : null };
}

function regles(changements: Changement[], tache = TACHE): string[] {
  return verifierChangements({ tache, changements, verrouilles: VERROUILLES, fichiersTest: FICHIERS_TEST }).map(
    (c) => `${c.niveau}:${c.regle}:${c.fichier}`,
  );
}

test('une tâche qui reste dans ses fichiers prévus ne produit aucun constat', () => {
  const r = regles([
    ch('src/invoice.ts', 'ajoute', null, 'export const a = 1;\n'),
    ch('src/invoice.test.ts', 'ajoute', null, "it('EX-1 — refuse', () => { expect(1).toBe(1); });\n"),
  ]);
  assert.deepEqual(r, []);
});

test('modifier un fichier verrouillé est bloquant, même prévu', () => {
  const tache = { ...TACHE, fichiers_prevus: [...TACHE.fichiers_prevus, 'tsconfig.json'] };
  assert.deepEqual(regles([ch('tsconfig.json', 'modifie', '{}', '{"a":1}')], tache), ['bloquant:fichier-verrouille:tsconfig.json']);
  assert.deepEqual(regles([ch('.github/workflows/ci.yml', 'ajoute', null, 'x')]), ['bloquant:fichier-verrouille:.github/workflows/ci.yml']);
});

test('package.json : scripts verrouillés, nouvelle dépendance signalée', () => {
  const avant = JSON.stringify({ scripts: { test: 'vitest' }, dependencies: { a: '1' } });
  const scripts = JSON.stringify({ scripts: { test: 'vitest --bail' }, dependencies: { a: '1' } });
  const dep = JSON.stringify({ scripts: { test: 'vitest' }, dependencies: { a: '1', b: '2' } });
  const tache = { ...TACHE, fichiers_prevus: [...TACHE.fichiers_prevus, 'package.json'] };
  assert.deepEqual(regles([ch('package.json', 'modifie', avant, scripts)], tache), ['bloquant:fichier-verrouille:package.json']);
  assert.deepEqual(regles([ch('package.json', 'modifie', avant, dep)], tache), ['signale:nouvelle-dependance:package.json']);
});

test('modifier un test existant hors tests_modifiables passe par la comparaison AST', () => {
  const avant = "it('a', () => { expect(1).toBe(1); });\n";
  const r = regles([ch('src/old.test.ts', 'modifie', avant, avant.replace('toBe(1)', 'toBe(2)'), [1])]);
  assert.deepEqual(r, ['bloquant:test-existant-modifie:src/old.test.ts']);
  const ajout = `${avant}it('EX-1 — nouveau', () => { expect(2).toBe(2); });\n`;
  assert.deepEqual(regles([ch('src/old.test.ts', 'modifie', avant, ajout, [2])]), ['signale:hors-plan:src/old.test.ts'], 'ajouter un test est permis, mais le fichier n\'est pas prévu');
});

test('supprimer un fichier de test existant ou mettre à jour un snapshot est bloquant', () => {
  assert.deepEqual(regles([ch('src/old.test.ts', 'supprime', 'x', null)]), ['bloquant:test-existant-supprime:src/old.test.ts']);
  assert.deepEqual(regles([ch('src/__snapshots__/a.test.ts.snap', 'modifie', 'a', 'b')]), ['bloquant:snapshot:src/__snapshots__/a.test.ts.snap']);
  assert.deepEqual(regles([ch('test/fixtures/autre.json', 'modifie', '{}', '{"a":1}')]), ['bloquant:test-existant-modifie:test/fixtures/autre.json']);
});

test('un fichier de test listé dans tests_modifiables peut changer', () => {
  assert.deepEqual(regles([ch('test/fixtures/invoice.json', 'modifie', '{}', '{"a":1}')]), ['signale:hors-plan:test/fixtures/invoice.json']);
});

test('un fichier hors fichiers_prevus est signalé, et ses règles de code s\'appliquent', () => {
  assert.deepEqual(regles([ch('src/autre.ts', 'ajoute', null, 'const a = x as any;\n')]), [
    'signale:hors-plan:src/autre.ts',
    'bloquant:no-explicit-any:src/autre.ts',
  ]);
});

test("le mock du module testé est repéré grâce aux fichiers prévus", () => {
  const code = "vi.mock('./invoice');\nit('EX-1 — refuse', () => { expect(1).toBe(1); });\n";
  assert.deepEqual(regles([ch('src/invoice.test.ts', 'ajoute', null, code)]), ['signale:mock-module-teste:src/invoice.test.ts']);
});
