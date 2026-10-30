import assert from 'node:assert/strict';
import { test } from 'node:test';
import { choisirAnalyses, cleMutant, configStryker, formaterMutants, incrementalReutilisable, lireAnalyseSurvivants, lireMutants, trierSurvivants } from './mutation.ts';

const RAPPORT = {
  files: {
    'src/signe.ts': {
      source: 'x',
      mutants: [
        { id: '1', mutatorName: 'ConditionalExpression', replacement: 'true', status: 'Survived', location: { start: { line: 2, column: 7 }, end: { line: 2, column: 12 } } },
        { id: '2', mutatorName: 'BlockStatement', replacement: '{}', status: 'Killed', location: { start: { line: 1, column: 1 }, end: { line: 5, column: 2 } } },
        { id: '3', mutatorName: 'StringLiteral', replacement: '""', status: 'NoCoverage', location: { start: { line: 4, column: 10 }, end: { line: 4, column: 16 } } },
        { id: '4', mutatorName: 'EqualityOperator', replacement: 'n >= 0', status: 'Timeout', location: { start: { line: 3, column: 7 }, end: { line: 3, column: 12 } } },
        { id: '5', mutatorName: 'ArrowFunction', replacement: '() => undefined', status: 'CompileError', location: { start: { line: 6, column: 1 }, end: { line: 6, column: 9 } } },
      ],
    },
    'src\\autre.ts': { source: 'y', mutants: [{ id: '9', mutatorName: 'BooleanLiteral', replacement: 'false', status: 'Killed', location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } } }] },
  },
};

test('lireMutants compte tués et survivants par fichier, sans les mutants invalides', () => {
  const fichiers = lireMutants(RAPPORT);
  const signe = fichiers.find((f) => f.fichier === 'src/signe.ts');
  assert.ok(signe);
  assert.equal(signe.total, 4);
  assert.equal(signe.tues, 2);
  assert.deepEqual(signe.survivants.map((m) => m.id), ['1', '3']);
  assert.equal(signe.score, 50);
  assert.equal(signe.timeouts, 1);
  assert.deepEqual(signe.survivants[1], { id: '3', mutateur: 'StringLiteral', remplacement: '""', ligne: 4, statut: 'NoCoverage' });
  assert.equal(fichiers.find((f) => f.fichier === 'src/autre.ts')?.score, 100);
});

test('choisirAnalyses garde les fichiers feature qui ont le plus de survivants, dans la limite', () => {
  const m = (fichier: string, n: number) => ({ fichier, total: 10, tues: 10 - n, timeouts: 0, score: 0, survivants: Array.from({ length: n }, (_, i) => ({ id: `${fichier}${i}`, mutateur: 'X', remplacement: 'y', ligne: 1, statut: 'Survived' })) });
  const fichiers = [m('a.ts', 1), m('b.ts', 5), m('c.ts', 3), m('d.ts', 0), m('hors.ts', 9)];
  const { analyses, autres } = choisirAnalyses(fichiers, ['a.ts', 'b.ts', 'c.ts', 'd.ts'], 2);
  assert.deepEqual(analyses.map((f) => f.fichier), ['b.ts', 'c.ts']);
  assert.deepEqual(autres.map((f) => f.fichier), ['hors.ts', 'a.ts']);
});

test("trierSurvivants n'analyse que les lignes changées par la branche, et jamais deux fois le même mutant", () => {
  const mutant = (id: string, ligne: number) => ({ id, mutateur: 'Regex', remplacement: '/x/', ligne, statut: 'Survived' });
  const f = { fichier: 'src/texte.ts', total: 4, tues: 0, timeouts: 0, score: 0, survivants: [mutant('1', 5), mutant('2', 15), mutant('3', 22), mutant('4', 19)] };
  // Les ids de Stryker changent d'un run à l'autre : un mutant déjà vu se reconnaît à sa place et à son effet.
  const vus = new Set([cleMutant('src/texte.ts', mutant('autre-id', 22))]);
  const tries = trierSurvivants(f, new Set([5, 6, 22]), vus);
  assert.deepEqual(tries.aAnalyser.map((m) => m.id), ['1']);
  assert.deepEqual(tries.horsBranche.map((m) => m.id), ['2', '4']);
  assert.deepEqual(tries.dejaProposes.map((m) => m.id), ['3']);
});

test('formaterMutants donne une ligne par survivant', () => {
  const [signe] = lireMutants(RAPPORT);
  assert.equal(formaterMutants(signe.survivants), '- 1 · ligne 2 · ConditionalExpression → `true` (Survived)\n- 3 · ligne 4 · StringLiteral → `""` (NoCoverage)');
});

test('configStryker lance le runner du projet sur les tests liés, tout écrit dans .workflow', () => {
  const c = configStryker({ runner: 'vitest', binaire: 'node_modules/vitest/vitest.mjs', fichiers: ['src/a.ts', 'src/b.ts'], dossier: '.workflow/x', concurrence: 3 });
  assert.equal(c.testRunner, 'command');
  assert.deepEqual(c.commandRunner, { command: 'node node_modules/vitest/vitest.mjs related --run src/a.ts src/b.ts' });
  assert.deepEqual(c.mutate, ['src/a.ts', 'src/b.ts']);
  assert.equal(c.tempDirName, '.workflow/x/stryker-tmp');
  assert.equal(c.incremental, true);
  assert.equal(c.incrementalFile, '.workflow/x/stryker-incremental.json');
  assert.deepEqual(c.ignorePatterns, ['/.workflow']);
  assert.deepEqual(c.jsonReporter, { fileName: '.workflow/x/rapports/mutation.json' });
  // Chaque mutant relance le runner complet : peu de processus en parallèle et un délai large, sinon tout finit en Timeout.
  assert.equal(c.concurrency, 3);
  assert.equal(c.timeoutMS, 30_000);
  const jest = configStryker({ runner: 'jest', binaire: 'node_modules/jest/bin/jest.js', fichiers: ['src/a.ts'], dossier: '.workflow/x', concurrence: 1 });
  assert.deepEqual(jest.commandRunner, { command: 'node node_modules/jest/bin/jest.js --ci --findRelatedTests src/a.ts' });
});

test("lireAnalyseSurvivants refuse un mutant qui n'est pas un survivant du fichier", () => {
  const texte = '```yaml\nequivalents:\n  - mutant: "7"\n    raison: "même résultat"\ntests:\n  - nom: "EX-1 — zéro"\n    assertions: ["signe(0) vaut zero"]\n    comportement_existant: true\n    mutants: ["1", "8"]\n```';
  const a = lireAnalyseSurvivants(texte, ['1', '3']);
  assert.match(a.erreurs.join(' '), /7.*inconnu/);
  assert.match(a.erreurs.join(' '), /8.*inconnu/);
  assert.deepEqual(lireAnalyseSurvivants(texte.replace('"7"', '"3"').replace('"8"', '"3"'), ['1', '3']).erreurs, []);
});

test('lireAnalyseSurvivants lit le bloc YAML de réponse', () => {
  const texte = 'Voici.\n```yaml\nequivalents:\n  - mutant: "4"\n    raison: "n >= 0 et n > 0 donnent le même résultat ici"\ntests:\n  - nom: "EX-1 — zéro"\n    assertions: ["signe(0) vaut zero"]\n    comportement_existant: true\n    mutants: ["1", "3"]\n```\n';
  const a = lireAnalyseSurvivants(texte);
  assert.deepEqual(a.erreurs, []);
  assert.deepEqual(a.equivalents, [{ mutant: '4', raison: 'n >= 0 et n > 0 donnent le même résultat ici' }]);
  assert.deepEqual(a.tests, [{ nom: 'EX-1 — zéro', assertions: ['signe(0) vaut zero'], comportement_existant: true, mutants: ['1', '3'] }]);
});

test('lireAnalyseSurvivants accepte des listes vides et signale un format invalide', () => {
  assert.deepEqual(lireAnalyseSurvivants('```yaml\nequivalents: []\ntests: []\n```').erreurs, []);
  assert.match(lireAnalyseSurvivants('pas de yaml').erreurs.join(' '), /bloc yaml/i);
  assert.match(lireAnalyseSurvivants('```yaml\ntests:\n  - nom: "x"\n```').erreurs.join(' '), /EX-n|assertions|equivalents/);
});

test("les résultats incrémentaux de Stryker ne sont gardés que si seul le code muté a changé", () => {
  // Avec le runner « command », Stryker ne voit pas les tests : un test ajouté ne relancerait aucun mutant.
  assert.equal(incrementalReutilisable(['src/a.ts'], ['src/a.ts']), true);
  assert.equal(incrementalReutilisable([], ['src/a.ts']), true);
  assert.equal(incrementalReutilisable(['src/a.ts', 'src/a.test.ts'], ['src/a.ts']), false);
  assert.equal(incrementalReutilisable(['src/aide.ts'], ['src/a.ts']), false);
  // Pas de trace du run précédent : on ne sait pas ce qui a changé.
  assert.equal(incrementalReutilisable(null, ['src/a.ts']), false);
});
