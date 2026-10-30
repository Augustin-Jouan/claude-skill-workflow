import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remplir } from './gabarit.ts';

test('remplace chaque {{cle}} par sa valeur, même répétée', () => {
  assert.equal(remplir('# {{id}}\n{{id}} : {{motif}}', { id: 'T1', motif: 'rejets' }), '# T1\nT1 : rejets');
});

test("n'interprète pas les motifs de remplacement contenus dans une valeur", () => {
  assert.equal(remplir('{{a}}', { a: "$& $1 $$ {{b}}" }), "$& $1 $$ {{b}}");
});

test('lève une erreur si une clé du gabarit n\'a pas de valeur', () => {
  assert.throws(() => remplir('{{id}} {{rapport}}', { id: 'T1' }), /rapport/);
});

test('lève une erreur si une valeur ne correspond à aucune clé du gabarit', () => {
  assert.throws(() => remplir('{{id}}', { id: 'T1', inutile: 'x' }), /inutile/);
});
