import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireSpec, sectionsExigences } from './spec.ts';

test('lit les exigences des titres EX-n avec leur titre', () => {
  const r = lireSpec('# Spec\n\n### EX-1 — Refuser une facture sans client\ntexte\n\n## EX-2 – Arrondir\n');
  assert.deepEqual(r.exigences, [
    { id: 'EX-1', titre: 'Refuser une facture sans client' },
    { id: 'EX-2', titre: 'Arrondir' },
  ]);
  assert.deepEqual(r.erreurs, []);
});

test('ignore un EX-n cité dans le texte courant', () => {
  const r = lireSpec('### EX-1 — A\nVoir EX-7 plus bas.\n- EX-8 en liste\n');
  assert.deepEqual(r.exigences.map((e) => e.id), ['EX-1']);
});

test('signale une exigence définie deux fois', () => {
  const r = lireSpec('### EX-1 — A\n### EX-1 — B\n');
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0], /EX-1/);
});

test('signale une spec sans exigence', () => {
  const r = lireSpec('# Spec\n\nRien de structuré.\n');
  assert.equal(r.erreurs.length, 1);
  assert.match(r.erreurs[0], /aucune exigence/);
});

test("extrait le texte complet des exigences demandées, jusqu'au titre suivant de même niveau", () => {
  const spec = '# Spec\n\n### EX-1 — A\nCorps A.\n#### Cas limites\nVide.\n### EX-2 — B\nCorps B.\n## Hors exigences\nNotes.\n';
  assert.equal(sectionsExigences(spec, ['EX-2']), '### EX-2 — B\nCorps B.');
  assert.equal(sectionsExigences(spec, ['EX-1', 'EX-2']), '### EX-1 — A\nCorps A.\n#### Cas limites\nVide.\n\n### EX-2 — B\nCorps B.');
});
