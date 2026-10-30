import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { depassement, echecsAdmis, ecrireRun, estJalon, lireRun, nouveauRun, nouvelleTache, suiteLente, tempsRestantMs } from './run-etat.ts';

const BUDGETS = { tacheMinutes: 20, branche: { micro: { minutes: 60, appelsLlm: 10 }, court: { minutes: 180, appelsLlm: 30 }, complet: { minutes: 480, appelsLlm: 80 } } };
const MIN = 60_000;

test("un run absent se lit comme un run neuf, et s'écrit puis se relit tel quel", () => {
  const dossier = mkdtempSync(join(tmpdir(), 'wf-run-'));
  try {
    assert.deepEqual(lireRun(dossier), nouveauRun());
    const run = nouveauRun();
    run.taches.T1 = { ...nouvelleTache(), rejets: 1 };
    ecrireRun(dossier, run);
    assert.deepEqual(lireRun(dossier), run);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('aucun dépassement sous les budgets', () => {
  const run = nouveauRun();
  run.taches.T1 = { ...nouvelleTache(), dureeMs: 19 * MIN };
  run.dureeMs = 59 * MIN;
  run.appelsLlm = 9;
  assert.equal(depassement(run, 'T1', 'micro', BUDGETS), null);
});

test('dépassement du budget de la tâche', () => {
  const run = nouveauRun();
  run.taches.T1 = { ...nouvelleTache(), dureeMs: 20 * MIN };
  assert.equal(depassement(run, 'T1', 'micro', BUDGETS)?.motif, 'budget-tache');
});

test('dépassement du budget de branche, en durée ou en appels LLM, selon le parcours', () => {
  const run = nouveauRun();
  run.taches.T1 = nouvelleTache();
  run.appelsLlm = 10;
  assert.equal(depassement(run, 'T1', 'micro', BUDGETS)?.motif, 'budget-branche');
  assert.equal(depassement(run, 'T1', 'court', BUDGETS), null);
  run.appelsLlm = 0;
  run.dureeMs = 180 * MIN;
  assert.equal(depassement(run, 'T1', 'court', BUDGETS)?.motif, 'budget-branche');
});

test('chaque rallonge accordée ajoute un budget de branche complet', () => {
  const run = nouveauRun();
  run.taches.T1 = nouvelleTache();
  run.appelsLlm = 15;
  run.rallonges = 1;
  assert.equal(depassement(run, 'T1', 'micro', BUDGETS), null);
  run.appelsLlm = 20;
  assert.equal(depassement(run, 'T1', 'micro', BUDGETS)?.motif, 'budget-branche');
});

test('le temps restant est le plus petit des budgets tâche et branche', () => {
  const run = nouveauRun();
  run.taches.T1 = { ...nouvelleTache(), dureeMs: 5 * MIN };
  run.dureeMs = 50 * MIN;
  assert.equal(tempsRestantMs(run, 'T1', 'micro', BUDGETS), 10 * MIN);
  run.dureeMs = 30 * MIN;
  assert.equal(tempsRestantMs(run, 'T1', 'micro', BUDGETS), 15 * MIN);
});

test('estJalon : jalons du plan et dernière tâche, seulement quand la suite est lente', () => {
  assert.equal(estJalon('T2', ['T2'], ['T1', 'T2', 'T3']), true);
  assert.equal(estJalon('T1', ['T2'], ['T1', 'T2', 'T3']), false);
  assert.equal(estJalon('T3', [], ['T1', 'T2', 'T3']), true);
});

test('suiteLente compare la durée de la suite de départ au seuil', () => {
  assert.equal(suiteLente({ echecs: [], tsc: [], suiteMs: 121_000, commit: 'a' }, 120), true);
  assert.equal(suiteLente({ echecs: [], tsc: [], suiteMs: 119_000, commit: 'a' }, 120), false);
  assert.equal(suiteLente(null, 120), false);
});

test('echecsAdmis réunit les échecs de départ et ceux admis à un jalon', () => {
  const run = { ...nouveauRun(), reference: { echecs: ['a › x'], tsc: [], suiteMs: 1, commit: 'c' }, echecsAcceptes: ['b › y'] };
  assert.deepEqual(echecsAdmis(run), ['a › x', 'b › y']);
  assert.deepEqual(echecsAdmis(nouveauRun()), []);
});
