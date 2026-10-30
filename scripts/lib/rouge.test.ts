import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestPrevu } from './plan.ts';
import { estEchecAssertion, jugerRouge, nouveauxTitres } from './rouge.ts';
import type { Rapport } from './runner.ts';

test("reconnaît un échec d'assertion de vitest, jest ou node:assert", () => {
  assert.ok(estEchecAssertion('AssertionError: expected 1 to be 2 // Object.is equality'));
  assert.ok(estEchecAssertion("AssertionError: expected [Function] to throw an error, but it didn't"));
  assert.ok(estEchecAssertion('Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1'));
  assert.ok(estEchecAssertion('Error: expect(received).toThrow()\n\nReceived function did not throw'));
  assert.ok(estEchecAssertion('AssertionError [ERR_ASSERTION]: 1 == 2'));
});

test("ne prend pas une erreur d'exécution pour une assertion", () => {
  assert.ok(!estEchecAssertion('TypeError: arrondir is not a function'));
  assert.ok(!estEchecAssertion("SyntaxError: The requested module './round' does not provide an export named 'payer'"));
  assert.ok(!estEchecAssertion('ReferenceError: x is not defined\n    at expect (file.ts:1)'));
});

const REGRESSION: TestPrevu = { nom: 'EX-1 — corrige a', assertions: ['renvoie 2'], comportement_existant: false };
const EXISTANT: TestPrevu = { nom: 'EX-1 — garde b', assertions: ['renvoie 1'], comportement_existant: true };
const FICHIERS = ['src/a.test.ts'];

function rapport(tests: Array<[string, string, string?]>, erreursFichier: Record<string, string> = {}): Rapport {
  return { tests: tests.map(([titre, statut, echec]) => ({ fichier: 'src/a.test.ts', titre, statut, echecs: echec ? [echec] : [] })), erreursFichier };
}

function verdict(r: Rapport, nouveaux: string[] = []): string[] {
  return jugerRouge([REGRESSION, EXISTANT], FICHIERS, r, nouveaux).map((c) => `${c.niveau}:${c.regle}`);
}

test("un test de régression qui échoue sur une assertion de l'ancien code est accepté", () => {
  assert.deepEqual(verdict(rapport([['EX-1 — corrige a', 'failed', 'AssertionError: expected 1 to be 2'], ['EX-1 — garde b', 'passed']])), []);
});

test("un test de régression qui passe déjà sur l'ancien code est bloquant", () => {
  assert.deepEqual(verdict(rapport([['EX-1 — corrige a', 'passed']])), ['bloquant:rouge-deja-vert']);
});

test("un test de régression qui échoue sans assertion est bloquant", () => {
  assert.deepEqual(verdict(rapport([['EX-1 — corrige a', 'failed', 'TypeError: f is not a function']])), ['bloquant:rouge-sans-assertion']);
});

test("un fichier qui ne compile pas sur l'ancien code est bloquant", () => {
  const r = rapport([], { 'src/a.test.ts': "SyntaxError: does not provide an export named 'payer'" });
  assert.deepEqual(verdict(r), ['bloquant:rouge-compilation']);
});

test("un test de régression absent ou ignoré sur l'ancien code est bloquant", () => {
  assert.deepEqual(verdict(rapport([])), ['bloquant:rouge-non-execute']);
  assert.deepEqual(verdict(rapport([['EX-1 — corrige a', 'skipped']])), ['bloquant:rouge-non-execute']);
});

test('les tests marqués comportement_existant ne sont pas jugés', () => {
  assert.deepEqual(verdict(rapport([['EX-1 — corrige a', 'failed', 'AssertionError: x'], ['EX-1 — garde b', 'failed', 'AssertionError: y']])), []);
});

test("un test ajouté hors plan qui passe déjà sur l'ancien code est signalé", () => {
  const r = rapport([['EX-1 — corrige a', 'failed', 'AssertionError: x'], ['EX-1 — cas limite', 'passed'], ['EX-1 — autre', 'failed', 'AssertionError: z']]);
  assert.deepEqual(verdict(r, ['EX-1 — cas limite', 'EX-1 — autre']), ['signale:test-ajoute-deja-vert']);
});

test('les nouveaux titres de test sont ceux absents de la version précédente du fichier', () => {
  const avant = "it('a', () => { expect(1).toBe(1); });\n";
  const apres = `${avant}describe('g', () => { it('b', () => { expect(2).toBe(2); }); });\n`;
  assert.deepEqual(nouveauxTitres(avant, apres, 'a.test.ts'), ['b']);
  assert.deepEqual(nouveauxTitres(null, apres, 'a.test.ts'), ['a', 'b']);
});
