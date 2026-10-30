import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Rapport } from './runner.ts';
import { comparerSuite, echecsSuite, erreursTsc, lireCouverture, lireQuarantaine, nouvellesErreurs } from './suite.ts';

const RAPPORT: Rapport = {
  tests: [
    { fichier: 'src/a.test.ts', titre: 'ok', statut: 'passed', echecs: [] },
    { fichier: 'src/a.test.ts', titre: 'casse', statut: 'failed', echecs: ['AssertionError'] },
    { fichier: 'src/b.test.ts', titre: 'ignoré', statut: 'skipped', echecs: [] },
  ],
  erreursFichier: { 'src/c.test.ts': 'Cannot find module' },
};

test('liste les tests en échec et les fichiers qui ne se chargent pas', () => {
  assert.deepEqual(echecsSuite(RAPPORT), ['src/a.test.ts › casse', 'src/c.test.ts › (chargement)']);
});

test("seuls les nouveaux échecs hors quarantaine sont des régressions", () => {
  const r = comparerSuite(['src/a.test.ts › casse'], ['src/a.test.ts › casse', 'src/d.test.ts › x', 'src/e.test.ts › y'], ['src/e.test.ts › y']);
  assert.deepEqual(r, { regressions: ['src/d.test.ts › x'], enQuarantaine: ['src/e.test.ts › y'] });
});

test('lit la quarantaine, et refuse un fichier mal formé', () => {
  assert.deepEqual(lireQuarantaine('[{"fichier": "src/e.test.ts", "nom": "y"}]'), ['src/e.test.ts › y']);
  assert.throws(() => lireQuarantaine('{"fichier": "x"}'), /quarantine/);
  assert.throws(() => lireQuarantaine('[{"fichier": "x"}]'), /quarantine/);
});

test('lit les erreurs de tsc sans leurs numéros de ligne', () => {
  const sortie = "src\\a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.\n  suite du message\nsrc/b.ts(1,1): error TS2307: Cannot find module 'x'.\n";
  assert.deepEqual(erreursTsc(sortie), ["src/a.ts: TS2322 Type 'string' is not assignable to type 'number'.", "src/b.ts: TS2307 Cannot find module 'x'."]);
});

test('une erreur de typecheck est nouvelle si elle apparaît plus souvent qu\'avant', () => {
  assert.deepEqual(nouvellesErreurs(['a: TS1 x', 'b: TS2 y'], ['b: TS2 y', 'a: TS1 x', 'a: TS1 x', 'c: TS3 z']), ['a: TS1 x', 'c: TS3 z']);
});

test('lit la couverture des lignes par fichier, à 0 % pour un fichier absent du rapport', () => {
  const resume = { total: {}, 'C:\\depot\\src\\a.ts': { lines: { pct: 92.5 } }, 'C:/depot/src/b.ts': { lines: { pct: 40 } } };
  assert.deepEqual(lireCouverture(resume, 'C:\\depot', ['src/a.ts', 'src/b.ts', 'src/c.ts']), [
    { fichier: 'src/a.ts', pct: 92.5 },
    { fichier: 'src/b.ts', pct: 40 },
    { fichier: 'src/c.ts', pct: 0 },
  ]);
});
