import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { dernierAudit, enregistrerAudit } from './audits.ts';
import { ecrireRun, nouveauRun, nouvelleTache } from './run-etat.ts';
import { conditionsDeSortie, enregistrerCheckPlan } from './sortie.ts';

let dossier: string;

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'wf-'));
});
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

function ecrire(nom: string, contenu: string): void {
  writeFileSync(join(dossier, nom), contenu);
}

// Lance un audit de la phase et, si demandé, journalise son tri comme « wf journal audit ».
function auditer(phase: string, trie: boolean): void {
  enregistrerAudit(dossier, phase, 'A-1 [mineur] x', ['A-1']);
  if (!trie) return;
  const ligne = { type: 'audit', phase, audit: dernierAudit(dossier, phase)?.numero, remontes: 1, acceptes: 1, rejetes: 0 };
  appendFileSync(join(dossier, 'journal.jsonl'), `${JSON.stringify(ligne)}\n`);
}

test('sortie de spec : exige une spec.md avec au moins une exigence', () => {
  assert.equal(conditionsDeSortie('spec', dossier).length, 1);
  ecrire('spec.md', '# Spec\n');
  assert.equal(conditionsDeSortie('spec', dossier).length, 1);
  ecrire('spec.md', '### EX-1 — A\n');
  assert.deepEqual(conditionsDeSortie('spec', dossier), []);
});

for (const etape of ['plan', 'audit-plan', 'matrice'] as const) {
  test(`sortie de ${etape} : exige un check-plan vert sur la spec et le plan actuels`, () => {
    if (etape === 'audit-plan') auditer('plan', true);
    ecrire('spec.md', '### EX-1 — A\n');
    ecrire('plan.md', 'plan v1');
    assert.equal(conditionsDeSortie(etape, dossier).length, 1, 'jamais lancé');

    enregistrerCheckPlan(dossier, false);
    assert.equal(conditionsDeSortie(etape, dossier).length, 1, 'dernier passage en échec');

    enregistrerCheckPlan(dossier, true);
    assert.deepEqual(conditionsDeSortie(etape, dossier), []);

    ecrire('plan.md', 'plan v2');
    assert.equal(conditionsDeSortie(etape, dossier).length, 1, 'plan modifié depuis');

    enregistrerCheckPlan(dossier, true);
    ecrire('spec.md', '### EX-1 — A modifiée\n');
    assert.equal(conditionsDeSortie(etape, dossier).length, 1, 'spec modifiée depuis');
  });
}

test("sortie d'audit-spec : exige le tri journalisé du dernier audit de la spec", () => {
  assert.match(conditionsDeSortie('audit-spec', dossier).join(), /wf audit spec/, 'aucun audit');
  auditer('spec', false);
  assert.match(conditionsDeSortie('audit-spec', dossier).join(), /spec-1.*wf journal audit/, 'tri non journalisé');
  auditer('spec', true);
  assert.deepEqual(conditionsDeSortie('audit-spec', dossier), []);
  auditer('spec', false);
  assert.match(conditionsDeSortie('audit-spec', dossier).join(), /spec-3/, 'le tri doit porter sur le dernier audit');
});

test("sortie d'audit-plan : le tri du dernier audit plan ou spec-plan, en plus du check-plan", () => {
  ecrire('spec.md', '### EX-1 — A\n');
  ecrire('plan.md', 'plan v1');
  enregistrerCheckPlan(dossier, true);
  assert.match(conditionsDeSortie('audit-plan', dossier).join(), /wf audit plan/, 'aucun audit');
  auditer('spec-plan', false);
  assert.equal(conditionsDeSortie('audit-plan', dossier).length, 1, 'tri non journalisé');
  auditer('spec-plan', true);
  assert.deepEqual(conditionsDeSortie('audit-plan', dossier), []);
});

const PLAN_DEUX_TACHES = [
  '```yaml',
  'parcours: micro',
  '```',
  '```yaml',
  '- id: T1',
  '  type: refactor',
  '  exigences: [EX-1]',
  '  fichiers_prevus: [src/a.ts]',
  '  tests: []',
  '- id: T2',
  '  type: refactor',
  '  exigences: [EX-1]',
  '  fichiers_prevus: [src/b.ts]',
  '  tests: []',
  '```',
].join('\n');

test("sortie d'execution : toutes les tâches du plan committées et aucune question en attente", () => {
  ecrire('spec.md', '### EX-1 — A\n');
  ecrire('plan.md', PLAN_DEUX_TACHES);
  enregistrerCheckPlan(dossier, true);
  assert.equal(conditionsDeSortie('execution', dossier).length, 1, 'run-plan jamais lancé');

  const run = nouveauRun();
  run.taches.T1 = { ...nouvelleTache(), statut: 'commitee' };
  ecrireRun(dossier, run);
  assert.match(conditionsDeSortie('execution', dossier).join(), /T2/);

  run.taches.T2 = { ...nouvelleTache(), statut: 'commitee' };
  run.attente = { tache: null, motif: 'budget-branche', question: 'q', plan: '', reponse: null };
  ecrireRun(dossier, run);
  assert.equal(conditionsDeSortie('execution', dossier).length, 1, 'question en attente');

  run.attente = null;
  ecrireRun(dossier, run);
  assert.deepEqual(conditionsDeSortie('execution', dossier), []);
});
