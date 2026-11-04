import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Parcours } from './etat.ts';
import type { Plan, Tache } from './plan.ts';
import { ordreTaches, verifierPlan } from './regles-plan.ts';
import type { Exigence } from './spec.ts';

const SPEC: Exigence[] = [
  { id: 'EX-1', titre: 'A' },
  { id: 'EX-2', titre: 'B' },
];

function tache(id: string, autres: Partial<Tache> = {}): Tache {
  const exigences = autres.exigences ?? ['EX-1'];
  return {
    id,
    type: 'feature',
    difficulte: 'simple',
    e2e: false,
    exigences,
    depends_on: [],
    fichiers_prevus: ['src/x.ts'],
    tests: exigences.map((ex) => ({ nom: `${ex} — ${id}`, assertions: ['ok'], comportement_existant: false })),
    tests_modifiables: [],
    ...autres,
  };
}

function plan(taches: Tache[], parcours: Parcours = 'complet', e2e_non_applicable?: string): Plan {
  return { entete: { parcours, e2e_non_applicable, jalons: [] }, taches };
}

const CONFORME = plan([tache('T1'), tache('T2', { exigences: ['EX-2'], depends_on: ['T1'], e2e: true })]);

function regles(p: Plan, parcoursEtat: Parcours | null = null, spec = SPEC): string[] {
  return verifierPlan(spec, p, parcoursEtat).map((v) => v.regle);
}

test('un plan conforme ne produit aucune violation', () => {
  assert.deepEqual(verifierPlan(SPEC, CONFORME, 'complet'), []);
});

test("signale une exigence de la spec couverte par aucune tâche", () => {
  const p = plan([tache('T1', { e2e: true })]);
  assert.deepEqual(regles(p), ['couverture-tache']);
});

test("signale une exigence couverte par une tâche mais par aucun test", () => {
  const t2 = tache('T2', { exigences: ['EX-2'], e2e: true, type: 'refactor', tests: [] });
  assert.deepEqual(regles(plan([tache('T1'), t2])), ['couverture-test']);
});

test('signale une tâche feature ou fix sans tests, pas une tâche refactor', () => {
  const sansTests = (type: Tache['type']) =>
    plan([tache('T1', { exigences: ['EX-1', 'EX-2'], e2e: true }), tache('T2', { type, tests: [] })]);
  assert.deepEqual(regles(sansTests('feature')), ['tests-manquants']);
  assert.deepEqual(regles(sansTests('fix')), ['tests-manquants']);
  assert.deepEqual(regles(sansTests('refactor')), []);
});

test('signale une tâche fix dont aucun test n\'est un test de régression', () => {
  const existant = (id: string) => [{ nom: `EX-1 — ${id}`, assertions: ['ok'], comportement_existant: true }];
  const p = (tests: Tache['tests']) => plan([tache('T1', { type: 'fix', tests }), tache('T2', { exigences: ['EX-2'], e2e: true })]);
  assert.deepEqual(regles(p(existant('T1'))), ['fix-sans-regression']);
  assert.deepEqual(regles(p([...existant('T1'), { nom: 'EX-1 — corrige', assertions: ['ok'], comportement_existant: false }])), []);
});

test('signale deux tests prévus au même nom, après normalisation', () => {
  const t1 = tache('T1', { tests: [{ nom: 'EX-1 — Fait A', assertions: ['ok'], comportement_existant: false }] });
  const t3 = tache('T3', { tests: [{ nom: 'ex-1 -  fait a', assertions: ['ok'], comportement_existant: false }] });
  const p = plan([t1, tache('T2', { exigences: ['EX-2'], e2e: true }), t3]);
  assert.deepEqual(regles(p), ['nom-duplique']);
});

test('signale une entrée de tests_modifiables sans raison', () => {
  const t1 = tache('T1', { tests_modifiables: [{ fichier: 'test/a.ts', raison: '  ' }] });
  const p = plan([t1, tache('T2', { exigences: ['EX-2'], e2e: true })]);
  assert.deepEqual(regles(p), ['raison-manquante']);
});

test('signale un depends_on vers une tâche inexistante', () => {
  const p = plan([tache('T1', { depends_on: ['T9'] }), tache('T2', { exigences: ['EX-2'], e2e: true })]);
  assert.deepEqual(regles(p), ['dependance-inconnue']);
});

test('signale un cycle de dépendances', () => {
  const p = plan([
    tache('T1', { depends_on: ['T2'] }),
    tache('T2', { exigences: ['EX-2'], e2e: true, depends_on: ['T1'] }),
  ]);
  assert.deepEqual(regles(p), ['cycle']);
});

test('signale une exigence de tâche absente de la spec', () => {
  const p = plan([tache('T1', { exigences: ['EX-1', 'EX-9'] }), tache('T2', { exigences: ['EX-2'], e2e: true })]);
  assert.ok(regles(p).includes('exigence-inconnue'));
});

test("signale un test dont le nom ne commence pas par une exigence de la tâche", () => {
  const horsTache = tache('T1', { tests: [{ nom: 'EX-2 — autre', assertions: ['ok'], comportement_existant: false }] });
  const sansExigence = tache('T1', { tests: [{ nom: 'fait A', assertions: ['ok'], comportement_existant: false }] });
  const t2 = tache('T2', { exigences: ['EX-2'], e2e: true });
  assert.ok(regles(plan([horsTache, t2])).includes('nom-test'));
  assert.ok(regles(plan([sansExigence, t2])).includes('nom-test'));
});

test("refuse une barre oblique inverse dans un nom de test : recopiée dans une chaîne JS, « \\r\\n » devient un vrai retour à la ligne", () => {
  const nom = (n: string) => plan([tache('T1', { tests: [{ nom: n, assertions: ['ok'], comportement_existant: false }] }), tache('T2', { exigences: ['EX-2'], e2e: true })]);
  assert.deepEqual(regles(nom('EX-1 — découpe sur \\r\\n et \\n')), ['nom-echappement']);
  assert.deepEqual(regles(nom('EX-1 — découpe sur CRLF, LF et CR')), []);
});

test('règle E2E : exigée en complet, sans dérogation possible', () => {
  const sansE2e = [tache('T1'), tache('T2', { exigences: ['EX-2'] })];
  assert.deepEqual(regles(plan(sansE2e, 'complet')), ['e2e']);
  assert.deepEqual(regles(plan(CONFORME.taches, 'complet', 'pas de parcours')), ['e2e']);
});

test('règle E2E : en court, dérogation justifiée acceptée', () => {
  const sansE2e = [tache('T1'), tache('T2', { exigences: ['EX-2'] })];
  assert.deepEqual(regles(plan(sansE2e, 'court')), ['e2e']);
  assert.deepEqual(regles(plan(sansE2e, 'court', 'correctif interne')), []);
  assert.deepEqual(regles(plan(sansE2e, 'court', '   ')), ['e2e']);
});

test('règle E2E : absente en micro', () => {
  const sansE2e = [tache('T1'), tache('T2', { exigences: ['EX-2'] })];
  assert.deepEqual(regles(plan(sansE2e, 'micro')), []);
});

test("signale un parcours d'en-tête différent de celui du workflow", () => {
  assert.deepEqual(regles(CONFORME, 'court'), ['parcours']);
});

test('signale un jalon vers une tâche inexistante', () => {
  const p: Plan = { ...CONFORME, entete: { ...CONFORME.entete, jalons: ['T1', 'T7'] } };
  assert.deepEqual(regles(p), ['jalon-inconnu']);
});

test("l'ordre suit les dépendances et garde l'ordre du plan sinon", () => {
  const taches = [tache('T1', { depends_on: ['T3'] }), tache('T2'), tache('T3')];
  assert.deepEqual(ordreTaches(taches), ['T2', 'T3', 'T1']);
});

test("l'ordre est null en cas de cycle", () => {
  assert.equal(ordreTaches([tache('T1', { depends_on: ['T2'] }), tache('T2', { depends_on: ['T1'] })]), null);
});

const VERROUILLES = ['tsconfig*.json', 'jest.config.*', 'package.json#scripts', '.github/**'];

test('refuse un fichier verrouillé dans fichiers_prevus', () => {
  const p = plan([tache('T1', { fichiers_prevus: ['src/x.ts', 'jest.config.js', '.github/workflows/ci.yml'] }), tache('T2', { exigences: ['EX-2'], e2e: true })]);
  const v = verifierPlan(SPEC, p, null, { verrouilles: VERROUILLES });
  assert.deepEqual(v.map((x) => `${x.regle}:${x.tache}`), ['fichier-verrouille:T1', 'fichier-verrouille:T1']);
  assert.match(v[0].message, /jest\.config\.js/);
  // Tâche déjà committée (plan écrit avant la règle) : pas jugée, elle ne se réécrit plus.
  assert.deepEqual(verifierPlan(SPEC, p, null, { verrouilles: VERROUILLES, commitees: ['T1'] }), []);
});

test("package.json reste prévisible : seul son champ scripts est verrouillé, verify le contrôle", () => {
  const p = plan([tache('T1', { fichiers_prevus: ['package.json', 'src/x.ts'] }), tache('T2', { exigences: ['EX-2'], e2e: true })]);
  assert.deepEqual(verifierPlan(SPEC, p, null, { verrouilles: VERROUILLES }), []);
});

test("refuse une tâche e2e: true quand le projet n'a aucun lanceur que verify sait lancer", () => {
  assert.deepEqual(verifierPlan(SPEC, CONFORME, null, { lanceurs: [] }).map((x) => `${x.regle}:${x.tache}`), ['e2e-non-verifiable:T2']);
  assert.deepEqual(verifierPlan(SPEC, CONFORME, null, { lanceurs: ['playwright'] }), []);
  assert.deepEqual(verifierPlan(SPEC, plan([tache('T1'), tache('T2', { exigences: ['EX-2'] })], 'court', 'API seule'), null, { lanceurs: [] }), []);
});
