import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argumentsTests, detecterRunner, filtrerEslint, lireRapport, verifierTestsPrevus } from './runner.ts';

const RACINE = 'C:/depot';

const RAPPORT = {
  testResults: [
    {
      name: 'C:\\depot\\src\\invoice.test.ts',
      status: 'failed',
      message: '',
      assertionResults: [
        { ancestorTitles: ['facture'], title: 'EX-1 — refuse sans client', status: 'passed', failureMessages: [] },
        { ancestorTitles: [], title: 'EX-2 – arrondit', status: 'failed', failureMessages: ['AssertionError: expected 1 to be 2\n    at x'] },
        { ancestorTitles: [], title: 'EX-3 — ignoré', status: 'skipped', failureMessages: [] },
      ],
    },
    {
      name: 'C:/depot/src/casse.test.ts',
      status: 'failed',
      message: "Failed to load url ./inexistant (resolved id: ./inexistant)",
      assertionResults: [],
    },
    {
      name: 'C:/depot/src/autre.test.ts',
      status: 'passed',
      message: '',
      assertionResults: [{ ancestorTitles: [], title: 'EX-4 — ailleurs', status: 'passed', failureMessages: [] }],
    },
  ],
};

test('lit le reporter JSON (vitest ou jest) avec des chemins relatifs à la racine', () => {
  const r = lireRapport(RAPPORT, RACINE);
  assert.deepEqual(r.tests.map((t) => [t.fichier, t.titre, t.statut]), [
    ['src/invoice.test.ts', 'EX-1 — refuse sans client', 'passed'],
    ['src/invoice.test.ts', 'EX-2 – arrondit', 'failed'],
    ['src/invoice.test.ts', 'EX-3 — ignoré', 'skipped'],
    ['src/autre.test.ts', 'EX-4 — ailleurs', 'passed'],
  ]);
  assert.deepEqual(r.erreursFichier, { 'src/casse.test.ts': 'Failed to load url ./inexistant (resolved id: ./inexistant)' });
});

function constats(noms: string[], fichiers: string[]): string[] {
  return verifierTestsPrevus(noms, fichiers, lireRapport(RAPPORT, RACINE)).map((c) => `${c.regle}:${c.message.split('\n')[0]}`);
}

test('un test prévu passé, au nom près de la normalisation, est accepté', () => {
  assert.deepEqual(constats(['EX-1 — Refuse  sans client'], ['src/invoice.test.ts']), []);
});

test('un test prévu en échec, ignoré ou absent est bloquant', () => {
  const r = constats(['EX-2 — arrondit', 'EX-3 — ignoré', 'EX-9 — inconnu'], ['src/invoice.test.ts']);
  assert.equal(r.length, 3);
  assert.match(r[0], /^test-prevu-echec:.*EX-2/);
  assert.match(r[1], /^test-prevu-non-execute:.*EX-3/);
  assert.match(r[2], /^test-prevu-absent:.*EX-9/);
});

test('la recherche se limite aux fichiers de test prévus', () => {
  assert.match(constats(['EX-4 — ailleurs'], ['src/invoice.test.ts'])[0], /^test-prevu-absent:/);
});

test("une erreur de chargement du fichier prévu est rapportée avec l'absence", () => {
  const c = verifierTestsPrevus(['EX-5 — x'], ['src/casse.test.ts'], lireRapport(RAPPORT, RACINE));
  assert.match(c[0].message, /Failed to load url/);
});

test('détecte vitest ou jest dans les dépendances du projet', () => {
  assert.equal(detecterRunner({ devDependencies: { vitest: '3' } }), 'vitest');
  assert.equal(detecterRunner({ dependencies: { jest: '29' } }), 'jest');
  assert.equal(detecterRunner({ devDependencies: { mocha: '1' } }), null);
});

test("ne garde du lint du projet que les erreurs situées sur les lignes modifiées", () => {
  const sortie = [
    {
      filePath: 'C:\\depot\\src\\a.ts',
      messages: [
        { line: 2, severity: 2, ruleId: 'no-unused-vars', message: 'x inutilisé' },
        { line: 5, severity: 2, ruleId: 'eqeqeq', message: '== interdit' },
        { line: 2, severity: 1, ruleId: 'no-console', message: 'console' },
      ],
    },
    { filePath: 'C:/depot/src/neuf.ts', messages: [{ line: 9, severity: 2, ruleId: 'semi', message: 'point-virgule' }] },
  ];
  const lignes = new Map<string, Set<number> | null>([
    ['src/a.ts', new Set([2])],
    ['src/neuf.ts', null],
  ]);
  assert.deepEqual(
    filtrerEslint(sortie, RACINE, lignes).map((c) => `${c.fichier}:${c.ligne}:${c.regle}`),
    ['src/a.ts:2:lint-projet', 'src/neuf.ts:9:lint-projet'],
  );
});

test('argumentsTests : fichiers donnés, ou tests liés aux fichiers de code', () => {
  assert.deepEqual(argumentsTests('vitest', ['a.test.ts'], 'r.json', false), ['run', '--reporter=json', '--outputFile=r.json', 'a.test.ts']);
  assert.deepEqual(argumentsTests('vitest', ['src/a.ts'], 'r.json', true), ['related', '--run', '--reporter=json', '--outputFile=r.json', 'src/a.ts']);
  assert.deepEqual(argumentsTests('jest', ['a.test.ts'], 'r.json', false), ['--ci', '--forceExit', '--json', '--outputFile=r.json', '--runTestsByPath', 'a.test.ts']);
  assert.deepEqual(argumentsTests('jest', ['src/a.ts'], 'r.json', true), ['--ci', '--forceExit', '--json', '--outputFile=r.json', '--findRelatedTests', 'src/a.ts']);
});
