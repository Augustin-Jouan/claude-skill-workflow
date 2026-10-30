import assert from 'node:assert/strict';
import { test } from 'node:test';
import { genererMatrice } from './matrice.ts';
import type { Plan } from './plan.ts';

const PLAN: Plan = {
  entete: { parcours: 'court', jalons: [] },
  taches: [
    {
      id: 'T2',
      type: 'feature',
      difficulte: 'simple',
      e2e: true,
      exigences: ['EX-1'],
      depends_on: ['T1'],
      fichiers_prevus: ['src/b.ts'],
      tests: [{ nom: 'EX-1 — parcours complet', assertions: ['affiche la facture'], comportement_existant: false }],
      tests_modifiables: [],
    },
    {
      id: 'T1',
      type: 'fix',
      difficulte: 'complexe',
      e2e: false,
      exigences: ['EX-1', 'EX-2'],
      depends_on: [],
      fichiers_prevus: ['src/a.ts'],
      tests: [
        { nom: 'EX-1 — refuse sans client', assertions: ['lève InvoiceError', 'ne crée rien'], comportement_existant: false },
        { nom: 'EX-2 — arrondit', assertions: ['arrondit au centime'], comportement_existant: true },
      ],
      tests_modifiables: [],
    },
  ],
};

const SPEC = [
  { id: 'EX-1', titre: 'Refuser une facture sans client' },
  { id: 'EX-2', titre: 'Arrondir les montants' },
];

const md = genererMatrice(SPEC, PLAN, ['T1', 'T2'], '2026-10-29T10:00:00.000Z');

test('annonce que la matrice est générée et ne se modifie pas à la main', () => {
  assert.match(md, /Générée par check-plan le 2026-10-29T10:00:00.000Z/);
  assert.match(md, /ne pas modifier à la main/i);
});

test('une section par exigence, dans l\'ordre de la spec, avec son titre', () => {
  const i1 = md.indexOf('## EX-1 — Refuser une facture sans client');
  const i2 = md.indexOf('## EX-2 — Arrondir les montants');
  assert.ok(i1 >= 0 && i2 > i1);
});

test('une ligne par test, avec tâche, type, assertions et comportement existant', () => {
  assert.ok(md.includes('| T1 | fix | EX-1 — refuse sans client | lève InvoiceError ; ne crée rien | non |'));
  assert.ok(md.includes('| T1 | fix | EX-2 — arrondit | arrondit au centime | oui |'));
  assert.ok(md.includes('| T2 | feature · e2e | EX-1 — parcours complet | affiche la facture | non |'));
});

test("donne l'ordre d'exécution des tâches", () => {
  assert.match(md, /T1 → T2/);
});

test('échappe les barres verticales dans les cellules', () => {
  const avecBarre: Plan = structuredClone(PLAN);
  avecBarre.taches[1].tests[1].assertions = ['renvoie a | b'];
  assert.ok(genererMatrice(SPEC, avecBarre, ['T1', 'T2'], 'x').includes('renvoie a \\| b'));
});

test("donne la difficulté de chaque tâche dans l'ordre d'exécution, pour que le développeur la valide", () => {
  assert.match(md, /\| T1 \| fix \| complexe \|/);
  assert.match(md, /\| T2 \| feature · e2e \| simple \|/);
  assert.ok(md.indexOf('| T1 | fix | complexe |') < md.indexOf('| T2 | feature · e2e | simple |'));
});
