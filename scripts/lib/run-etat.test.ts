import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { depassement, echecsAdmis, ecrireRun, empreinteTache, estJalon, etatPourVersion, lireRun, nouveauRun, nouvelleTache, suiteLente, tempsRestantMs } from './run-etat.ts';

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

test('une tâche réécrite dans le plan repart avec un budget de temps neuf', () => {
  const usee = { ...nouvelleTache(), tentatives: 4, rejets: 3, remontees: 1, dureeMs: 22 * MIN, appelsLlm: 6, consigne: 'ancien rejet', empreinte: 'v1' };
  const neuve = etatPourVersion(usee, 'v2');
  assert.deepEqual(neuve, { ...nouvelleTache(), tentatives: 4, appelsLlm: 6, consigne: 'ancien rejet', empreinte: 'v2' });
});

test("l'empreinte d'une tâche ne dépend que de ce qu'elle demande", () => {
  const t = {
    id: 'T1',
    type: 'fix' as const,
    difficulte: 'simple' as const,
    e2e: false,
    exigences: ['EX-1'],
    depends_on: [],
    fichiers_prevus: ['a.ts', 'a.test.ts'],
    tests: [{ nom: 'EX-1 — x', assertions: ['y'], comportement_existant: false }],
    tests_modifiables: [],
  };
  // Un champ ajouté au format par une version du skill (ici sur la tâche et sur un test) ne change rien.
  const avecChamp = { ...t, nouveau: 1, tests: [{ ...t.tests[0], autre: true }] } as unknown as typeof t;
  assert.equal(empreinteTache(avecChamp), empreinteTache(t));
  assert.notEqual(empreinteTache({ ...t, fichiers_prevus: ['a.ts'] }), empreinteTache(t));
  assert.notEqual(empreinteTache({ ...t, tests: [{ ...t.tests[0], assertions: ['z'] }] }), empreinteTache(t));
});

test("une tâche inchangée, committée ou venue d'un run.json sans empreinte garde son état", () => {
  const et = { ...nouvelleTache(), dureeMs: 22 * MIN, empreinte: 'v1' };
  assert.equal(etatPourVersion(et, 'v1'), et);
  const commitee = { ...et, statut: 'commitee' as const };
  assert.equal(etatPourVersion(commitee, 'v2'), commitee);
  const { empreinte: _e, ...ancien } = et;
  assert.deepEqual(etatPourVersion(ancien, 'v2'), { ...ancien, empreinte: 'v2' });
  assert.deepEqual(etatPourVersion(undefined, 'v1'), { ...nouvelleTache(), empreinte: 'v1' });
});
