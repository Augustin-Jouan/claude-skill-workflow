import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argumentsTests, detecterRunner, filtrerEslint, lanceursDeclares, lireRapport, lireRapportPlaywright, repartirFichiers, resumerRapport, sansPlaywright, verifierTestsPrevus } from './runner.ts';

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

test("resumerRapport : compte, puis chaque échec avec le début de son message, puis les fichiers qui n'ont pas chargé", () => {
  const r = resumerRapport(lireRapport(RAPPORT, RACINE));
  assert.equal(r.ok, false);
  assert.equal(
    r.texte,
    [
      '2 passé(s), 1 en échec, 1 ignoré(s).',
      '✗ src/invoice.test.ts › EX-2 – arrondit',
      '    AssertionError: expected 1 to be 2',
      '        at x',
      '✗ src/casse.test.ts ne se charge pas : Failed to load url ./inexistant (resolved id: ./inexistant)',
    ].join('\n'),
  );
  assert.deepEqual(resumerRapport({ tests: [{ fichier: 'a.test.ts', titre: 't', statut: 'passed', echecs: [] }], erreursFichier: {} }), { ok: true, texte: '1 passé(s), 0 en échec, 0 ignoré(s).' });
  assert.deepEqual(resumerRapport({ tests: [], erreursFichier: {} }), { ok: false, texte: 'Aucun test exécuté : vérifie les chemins donnés.' });
});

const RAPPORT_PW = {
  config: { rootDir: 'C:\\depot\\e2e' },
  suites: [
    {
      title: 'login.spec.ts',
      file: 'login.spec.ts',
      specs: [
        {
          title: 'EX-1 — connexion',
          file: 'login.spec.ts',
          tests: [
            { projectName: 'chromium', status: 'expected', results: [{ status: 'passed' }] },
            { projectName: 'firefox', status: 'flaky', results: [{ status: 'failed', error: { message: 'boom' } }, { status: 'passed' }] },
          ],
        },
      ],
      suites: [
        {
          title: 'déconnexion',
          file: 'login.spec.ts',
          specs: [{ title: 'EX-2 — sortie', file: 'login.spec.ts', tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: '\u001b[31mexpect(page).toHaveURL\u001b[39m\nattendu /' } }] }] }],
        },
      ],
    },
    { title: 'vide.spec.ts', file: 'sous/vide.spec.ts', specs: [{ title: 'EX-3 — plus tard', file: 'sous/vide.spec.ts', tests: [{ status: 'skipped', results: [] }] }] },
  ],
  errors: [{ message: 'SyntaxError: inattendu', location: { file: 'C:\\depot\\e2e\\casse.spec.ts', line: 1 } }],
};

test('lit le rapport JSON de Playwright : statuts, describe imbriqués, chemins depuis rootDir, erreurs de fichier', () => {
  const r = lireRapportPlaywright(RAPPORT_PW, RACINE);
  assert.deepEqual(r.tests.map((t) => [t.fichier, t.titre, t.statut]), [
    ['e2e/login.spec.ts', 'EX-1 — connexion', 'passed'],
    ['e2e/login.spec.ts', 'EX-2 — sortie', 'failed'],
    ['e2e/sous/vide.spec.ts', 'EX-3 — plus tard', 'skipped'],
  ]);
  assert.deepEqual(r.tests[1].echecs, ['expect(page).toHaveURL\nattendu /']);
  assert.deepEqual(r.erreursFichier, { 'e2e/casse.spec.ts': 'SyntaxError: inattendu' });
});

test("Playwright : un test ignoré sur un seul navigateur passe, un échec sur l'un d'eux fait échouer le test", () => {
  const spec = (statuts: string[]) => ({
    config: { rootDir: 'C:/depot' },
    suites: [{ file: 'a.spec.ts', specs: [{ title: 'EX-1 — t', file: 'a.spec.ts', tests: statuts.map((status) => ({ status, results: status === 'unexpected' ? [{ error: { message: 'non' } }] : [] })) }] }],
  });
  const statut = (statuts: string[]) => lireRapportPlaywright(spec(statuts), RACINE).tests.map((t) => t.statut);
  assert.deepEqual(statut(['expected', 'skipped']), ['passed']);
  assert.deepEqual(statut(['expected', 'unexpected']), ['failed']);
  assert.deepEqual(statut(['skipped', 'skipped']), ['skipped']);
  assert.deepEqual(verifierTestsPrevus(['EX-1 — t'], ['a.spec.ts'], lireRapportPlaywright(spec(['expected', 'skipped']), RACINE)), []);
});

test('une erreur Playwright sans fichier, ou située hors des fichiers lancés, est rapportée sur chaque fichier lancé', () => {
  const r = lireRapportPlaywright({ config: { rootDir: 'C:/depot' }, suites: [], errors: [{ message: 'Error: webServer a échoué' }] }, RACINE, ['e2e/a.spec.ts']);
  assert.deepEqual(r.erreursFichier, { 'e2e/a.spec.ts': 'Error: webServer a échoué' });
  const fixture = lireRapportPlaywright({ suites: [], errors: [{ message: 'TypeError: x', location: { file: 'C:/depot/e2e/fixtures.ts' } }] }, RACINE, ['e2e/a.spec.ts']);
  assert.deepEqual(fixture.erreursFichier, { 'e2e/a.spec.ts': 'e2e/fixtures.ts : TypeError: x' });
});

test('repartirFichiers : un fichier qui importe @playwright/test, lui-même ou par ses fixtures locales, va à Playwright', () => {
  const contenus: Record<string, string> = {
    'e2e/a.spec.ts': "import { test, expect } from '@playwright/test';",
    'e2e/b.spec.js': "const { test } = require(\"@playwright/test\");",
    'e2e/c.spec.ts': "import { test, expect } from './fixtures';",
    'e2e/fixtures.ts': "import { test as base } from '@playwright/test';\nexport const test = base.extend({});",
    'e2e/d.spec.ts': "import { test } from '../support/index.js';",
    'support/index.ts': "export * from './pw';",
    'support/pw.ts': "export { test } from '@playwright/test';",
    'src/c.test.ts': "import { test } from 'vitest';\nimport { calcul } from './calcul';",
    'src/calcul.ts': 'export const calcul = 1;',
    'src/mock.test.ts': "jest.mock('@playwright/test');\nimport { x } from './mock.test';",
  };
  assert.deepEqual(repartirFichiers(['e2e/a.spec.ts', 'e2e/b.spec.js', 'e2e/c.spec.ts', 'e2e/d.spec.ts', 'src/c.test.ts', 'src/mock.test.ts', 'src/absent.test.ts'], (f) => contenus[f] ?? null), {
    playwright: ['e2e/a.spec.ts', 'e2e/b.spec.js', 'e2e/c.spec.ts', 'e2e/d.spec.ts'],
    unitaires: ['src/c.test.ts', 'src/mock.test.ts', 'src/absent.test.ts'],
  });
});

test('sansPlaywright : un spec Playwright attrapé par jest ou vitest est retiré de leur rapport', () => {
  const rapport = {
    tests: [
      { fichier: 'src/a.test.ts', titre: 'a', statut: 'passed', echecs: [] },
      { fichier: 'e2e/b.spec.ts', titre: 'b', statut: 'failed', echecs: ['x'] },
    ],
    erreursFichier: { 'e2e/c.spec.ts': 'Playwright Test did not expect test() to be called here', 'src/d.test.ts': 'casse' },
  };
  const contenus: Record<string, string> = { 'e2e/b.spec.ts': "import { test } from '@playwright/test';", 'e2e/c.spec.ts': "import { test } from '@playwright/test';", 'src/a.test.ts': '', 'src/d.test.ts': '' };
  assert.deepEqual(sansPlaywright(rapport, (f) => contenus[f] ?? null), {
    tests: [{ fichier: 'src/a.test.ts', titre: 'a', statut: 'passed', echecs: [] }],
    erreursFichier: { 'src/d.test.ts': 'casse' },
  });
});

test('liste les lanceurs déclarés que verify sait lancer, Playwright compris', () => {
  assert.deepEqual(lanceursDeclares({ devDependencies: { jest: '29', '@playwright/test': '1.48' } }), ['jest', 'playwright']);
  assert.deepEqual(lanceursDeclares({ dependencies: { mocha: '1', playwright: '1' } }), []);
});
