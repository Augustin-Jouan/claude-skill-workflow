import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lirePlan } from './plan.ts';

const ENTETE_COURT = 'parcours: court\ne2e_non_applicable: "correctif interne"';

const T1 = `- id: T1
  type: feature
  difficulte: simple
  e2e: false
  exigences: [EX-1]
  depends_on: []
  fichiers_prevus: [src/a.ts, src/a.test.ts]
  tests:
    - nom: "EX-1 — fait a"
      assertions: ["renvoie 1"]
  tests_modifiables: []`;

const T2 = `- id: T2
  type: fix
  difficulte: complexe
  e2e: true
  exigences: [EX-2]
  depends_on: [T1]
  fichiers_prevus: [src/b.ts]
  tests:
    - nom: "EX-2 — corrige b"
      assertions: ["renvoie 2", "ne lève rien"]
      comportement_existant: true
  tests_modifiables:
    - fichier: test/fixtures/b.ts
      raison: "nouveau champ"`;

function md(...blocs: string[]): string {
  return `# Plan\n\n${blocs.map((b) => `\`\`\`yaml\n${b}\n\`\`\``).join('\n\nTexte libre.\n\n')}\n`;
}

function regles(r: ReturnType<typeof lirePlan>): string[] {
  return r.violations.map((v) => v.regle);
}

test("lit l'en-tête et des tâches réparties sur plusieurs blocs", () => {
  const r = lirePlan(md(ENTETE_COURT, T1, T2));
  assert.deepEqual(r.violations, []);
  assert.equal(r.plan?.entete.parcours, 'court');
  assert.equal(r.plan?.entete.e2e_non_applicable, 'correctif interne');
  assert.deepEqual(r.plan?.entete.jalons, []);
  assert.deepEqual(r.plan?.taches.map((t) => t.id), ['T1', 'T2']);
  assert.deepEqual(r.plan?.taches[1].tests_modifiables, [{ fichier: 'test/fixtures/b.ts', raison: 'nouveau champ' }]);
});

test('applique comportement_existant: false par défaut', () => {
  const r = lirePlan(md(ENTETE_COURT, T1, T2));
  assert.equal(r.plan?.taches[0].tests[0].comportement_existant, false);
  assert.equal(r.plan?.taches[1].tests[0].comportement_existant, true);
});

test('signale un plan sans bloc yaml', () => {
  const r = lirePlan('# Plan\n\nAucun bloc.\n');
  assert.equal(r.plan, null);
  assert.deepEqual(regles(r), ['format']);
});

test('signale une erreur de syntaxe YAML avec le numéro du bloc', () => {
  const r = lirePlan(md(ENTETE_COURT, '- id: T1\n  type: [feature'));
  assert.equal(r.plan, null);
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0].message, /bloc 2/);
});

test("exige un en-tête de type objet et des blocs de tâches de type liste", () => {
  assert.deepEqual(regles(lirePlan(md('- parcours: court', T1))), ['format']);
  assert.deepEqual(regles(lirePlan(md(ENTETE_COURT, T1.replace(/^- /, '').replace(/\n {2}/g, '\n')))), ['format']);
});

test("signale un parcours d'en-tête invalide et un champ d'en-tête inconnu", () => {
  assert.deepEqual(regles(lirePlan(md('parcours: moyen', T1))), ['format']);
  assert.deepEqual(regles(lirePlan(md(`${ENTETE_COURT}\nparcour: court`, T1))), ['format']);
});

test('signale un champ inconnu dans une tâche', () => {
  const r = lirePlan(md(ENTETE_COURT, T1.replace('depends_on', 'depend_on')));
  assert.ok(r.violations.some((v) => v.regle === 'format' && v.tache === 'T1' && /depend_on/.test(v.message)));
});

test('signale un type de tâche invalide', () => {
  const r = lirePlan(md(ENTETE_COURT, T1.replace('type: feature', 'type: chore')));
  assert.deepEqual(regles(r), ['format']);
});

test('exige une ou deux assertions par test prévu', () => {
  const aucune = lirePlan(md(ENTETE_COURT, T1.replace('["renvoie 1"]', '[]')));
  const trois = lirePlan(md(ENTETE_COURT, T1.replace('["renvoie 1"]', '["a", "b", "c"]')));
  assert.deepEqual(regles(aucune), ['format']);
  assert.deepEqual(regles(trois), ['format']);
});

test('hors micro, exige depends_on, tests_modifiables et e2e', () => {
  const sans = T1.replace('  e2e: false\n', '').replace('  depends_on: []\n', '').replace('\n  tests_modifiables: []', '');
  const r = lirePlan(md(ENTETE_COURT, sans));
  assert.equal(r.violations.length, 3);
  assert.ok(r.violations.every((v) => v.regle === 'format' && v.tache === 'T1'));
});

test('en micro, applique les valeurs par défaut des champs facultatifs', () => {
  const sans = T1.replace('  e2e: false\n', '').replace('  depends_on: []\n', '').replace('\n  tests_modifiables: []', '');
  const r = lirePlan(md('parcours: micro', sans));
  assert.deepEqual(r.violations, []);
  assert.equal(r.plan?.taches[0].e2e, false);
  assert.deepEqual(r.plan?.taches[0].depends_on, []);
  assert.deepEqual(r.plan?.taches[0].tests_modifiables, []);
});

test("garde une raison vide pour que la règle dédiée la signale", () => {
  const r = lirePlan(md(ENTETE_COURT, T1, T2.replace('      raison: "nouveau champ"', '')));
  assert.deepEqual(r.violations, []);
  assert.equal(r.plan?.taches[1].tests_modifiables[0].raison, '');
});

test('signale un identifiant de tâche dupliqué', () => {
  const r = lirePlan(md(ENTETE_COURT, T1, T1));
  assert.deepEqual(regles(r), ['format']);
  assert.match(r.violations[0].message, /T1/);
});

test('hors micro, exige une difficulte simple ou complexe', () => {
  const sans = lirePlan(md(ENTETE_COURT, T1.replace('  difficulte: simple\n', '')));
  const invalide = lirePlan(md(ENTETE_COURT, T1.replace('difficulte: simple', 'difficulte: moyenne')));
  assert.ok(sans.violations.some((v) => v.tache === 'T1' && /difficulte/.test(v.message)));
  assert.ok(invalide.violations.some((v) => v.tache === 'T1' && /difficulte/.test(v.message)));
  assert.equal(lirePlan(md(ENTETE_COURT, T1, T2)).plan?.taches[1].difficulte, 'complexe');
});

test('en micro, une tâche sans difficulte est simple', () => {
  const r = lirePlan(md('parcours: micro', T1.replace('  difficulte: simple\n', '')));
  assert.equal(r.plan?.taches[0].difficulte, 'simple');
});
