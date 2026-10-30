import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sujetDeCommit } from './commit.ts';
import type { Tache } from './plan.ts';

const SPEC = ['### EX-1 — dureeEnMinutes déménage dans src/duree.ts sans changer de comportement', '### EX-2 — Format court'].join('\n');

function tache(champs: Partial<Tache>): Tache {
  return { id: 'T1', type: 'feature', difficulte: 'simple', e2e: false, exigences: ['EX-1'], depends_on: [], fichiers_prevus: ['src/a.ts'], tests: [], tests_modifiables: [], ...champs };
}

test('prend le titre de la tâche dans le plan', () => {
  const plan = '## T6 — Intégration de l\'API publique des durées\n\n```yaml\n- id: T6\n```\n';
  assert.equal(sujetDeCommit(tache({ id: 'T6', fichiers_prevus: ['src/a.ts', 'src/a.test.ts'] }), plan, SPEC, []), "feat: Intégration de l'API publique des durées");
});

test('sans titre de tâche, reprend les titres des exigences', () => {
  assert.equal(sujetDeCommit(tache({ type: 'fix', exigences: ['EX-2'] }), '', SPEC, []), 'fix: Format court');
});

test("une tâche feature qui ne touche que des tests est un commit test", () => {
  const plan = '## T7 — Tests complémentaires\n';
  assert.equal(sujetDeCommit(tache({ id: 'T7', fichiers_prevus: ['src/a.test.ts', 'e2e/b.spec.ts'] }), plan, SPEC, []), 'test: Tests complémentaires');
});

test('coupe un sujet trop long sur un mot entier, à 72 caractères au plus', () => {
  const sujet = sujetDeCommit(tache({}), '', SPEC, []);
  assert.ok(sujet.length <= 72, sujet);
  assert.equal(sujet, 'feat: dureeEnMinutes déménage dans src/duree.ts sans changer de…');
});
