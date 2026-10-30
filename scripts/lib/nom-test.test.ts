import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exigenceDuNom, normaliserNomTest } from './nom-test.ts';

test('la normalisation confond casse, espaces multiples et tirets', () => {
  assert.equal(
    normaliserNomTest('EX-2 —  Refuse  une Facture '),
    normaliserNomTest('ex-2 - refuse une facture'),
  );
  assert.equal(normaliserNomTest('EX-2 – a'), normaliserNomTest('EX-2 — a'));
});

test("la normalisation garde ce qui distingue deux noms", () => {
  assert.notEqual(normaliserNomTest('EX-2 — refuse'), normaliserNomTest('EX-2 — accepte'));
});

test("lit l'exigence en tête du nom", () => {
  assert.equal(exigenceDuNom('EX-2 — refuse une facture'), 'EX-2');
  assert.equal(exigenceDuNom('EX-12 - arrondit'), 'EX-12');
});

test("ne lit pas d'exigence hors de la tête du nom ou sans description", () => {
  assert.equal(exigenceDuNom('refuse une facture EX-2'), null);
  assert.equal(exigenceDuNom('EX-2'), null);
  assert.equal(exigenceDuNom('EX-2 refuse'), null);
});
