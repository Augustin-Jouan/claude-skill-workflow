import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { dossierWorkflow } from './depot.ts';
import { localiser } from './result.ts';

test('chaque branche de workflow a son dossier .workflow/<slug>/', () => {
  assert.equal(dossierWorkflow('/r', 'wf/duree-module'), join('/r', '.workflow', 'duree-module'));
  assert.equal(dossierWorkflow('/r', 'feature/x'), join('/r', '.workflow', 'feature-x'));
});

test('les chemins .workflow/… des messages pointent vers le dossier de la branche, sans doublon', () => {
  const r = localiser('Voir .workflow/question.md puis .workflow/duree/fin.md', '.workflow/duree');
  assert.equal(r, 'Voir .workflow/duree/question.md puis .workflow/duree/fin.md');
  assert.equal(localiser('Voir .workflow/fin.md', null), 'Voir .workflow/fin.md');
});
