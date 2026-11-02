import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evenementsBilan, lireBilan, nomFichierRetour, rendreBilan } from './bilan.ts';

const JOURNAL = [
  { type: 'reference', echecs: 0, tsc: 0, suiteMs: 185_000 },
  { type: 'llm', role: 'executeur', tache: 'T1', tentative: 1, dureeMs: 1000, tokens: null, erreur: null },
  { type: 'regle', tache: 'T1', regle: 'test-sans-assertion', niveau: 'bloquant', fichier: 'src/a.test.ts' },
  { type: 'llm', role: 'arbitre', tache: 'T1', dureeMs: 1000, tokens: 50, erreur: 'Délai de 10 min dépassé.' },
  { type: 'question', tache: 'T1', motif: 'rejets' },
  { type: 'reponse', tache: 'T1', motif: 'rejets', reponse: 'Découpe la tâche en deux.' },
  { type: 'tache', tache: 'T1', statut: 'commitee', tentatives: 3, rejets: 2, appelsLlm: 4, dureeMs: 600_000 },
];

test('evenementsBilan numérote les faits du journal, des étapes et de DEVIATIONS.md', () => {
  const ev = evenementsBilan({
    journal: JOURNAL,
    historique: [
      { de: 'plan', vers: 'matrice', date: '', note: 'matrice relue' },
      { de: 'fin', vers: 'plan', date: '', note: 'ajout des tests proposés' },
    ],
    deviations: '# Déviations\n\n- T2 : fichier csv.ts ajouté, oublié au plan.\n',
  });
  assert.deepEqual(
    ev.map((e) => `${e.id} ${e.texte}`),
    [
      'E1 Suite de départ : 185 s, 0 échec(s), 0 erreur(s) de typecheck',
      'E2 T1 · règle test-sans-assertion (bloquant) · src/a.test.ts',
      'E3 T1 · appel arbitre en erreur : Délai de 10 min dépassé.',
      'E4 T1 · question au développeur (rejets)',
      'E5 T1 · réponse du développeur (rejets) : Découpe la tâche en deux.',
      'E6 T1 · committée en 3 tentative(s), 2 rejet(s), 4 appel(s) LLM, 10 min',
      'E7 Étape plan → matrice : matrice relue',
      'E8 Retour de fin à plan : ajout des tests proposés',
      'E9 DEVIATIONS.md : T2 : fichier csv.ts ajouté, oublié au plan.',
    ],
  );
});

test("une mutation reprise d'un finish interrompu est un fait du bilan, pas un Stryker sans durée", () => {
  const ev = evenementsBilan({ journal: [{ type: 'mutation', reprise: true }], historique: [], deviations: '' });
  assert.deepEqual(ev.map((e) => e.texte), ['Mutation et analyse des survivants reprises du finish précédent (même commit)']);
});

test("le bilan sait qu'une analyse des survivants non lancée n'a rien pu proposer, et voit la couverture des refactor", () => {
  const ev = evenementsBilan({
    journal: [
      { type: 'couverture', tache: 'T1', seuil: 80, fichiers: [{ fichier: 'src/duree.ts', pct: 100 }] },
      { type: 'mutation', score: 87, survivants: 37, analyses: 0, testsProposes: 0, sansAnalyse: 'aucune-feature' },
    ],
    historique: [],
    deviations: '',
  });
  assert.deepEqual(ev.map((e) => e.texte), [
    'T1 · couverture avant refactor : src/duree.ts 100 % (seuil 80 %)',
    "Mutation : score 87 %, 37 survivant(s), analyse des survivants non lancée (la branche n'a aucune tâche feature)",
  ]);
});

const REPONSE = [
  '```yaml',
  'suggestions:',
  '  - titre: "Préciser les assertions attendues"',
  '    faits: ["E2", "E6"]',
  '    cause: consigne-executeur',
  '    proposition: "Rappeler dans le prompt de l\'exécuteur qu\'un test sans expect est rejeté."',
  '    ou: "prompts/executeur.md"',
  '    priorite: haute',
  'controles_utiles:',
  '  - regle: "test-sans-assertion"',
  '    faits: ["E2"]',
  '    raison: "Le test ajouté ne vérifiait rien."',
  '```',
].join('\n');

test('lireBilan lit les suggestions et les contrôles utiles', () => {
  const b = lireBilan(REPONSE, ['E1', 'E2', 'E6']);
  assert.deepEqual(b.erreurs, []);
  assert.equal(b.suggestions.length, 1);
  assert.deepEqual(b.suggestions[0].faits, ['E2', 'E6']);
  assert.equal(b.utiles[0].regle, 'test-sans-assertion');
  assert.deepEqual(lireBilan('```yaml\nsuggestions: []\ncontroles_utiles: []\n```', []).erreurs, []);
});

test('lireBilan refuse une suggestion sans fait, ou qui cite un fait inconnu', () => {
  assert.match(lireBilan(REPONSE, ['E2']).erreurs.join(' '), /E6 inconnu/);
  const sansFait = REPONSE.replace('faits: ["E2", "E6"]', 'faits: []');
  assert.match(lireBilan(sansFait, ['E2', 'E6']).erreurs.join(' '), /suggestions\[0\].*fait/);
  const mauvaiseCause = REPONSE.replace('cause: consigne-executeur', 'cause: intuition');
  assert.match(lireBilan(mauvaiseCause, ['E2', 'E6']).erreurs.join(' '), /cause/);
  assert.match(lireBilan('rien', []).erreurs.join(' '), /bloc yaml/i);
});

test('rendreBilan met les faits cités en clair, par priorité, et rappelle que rien n\'est appliqué', () => {
  const evenements = [
    { id: 'E2', texte: 'T1 · règle test-sans-assertion (bloquant) · src/a.test.ts' },
    { id: 'E6', texte: 'T1 · committée en 3 tentative(s)' },
  ];
  const md = rendreBilan('# Bilan — wf/export', lireBilan(REPONSE, ['E2', 'E6']), evenements);
  assert.match(md, /### 1\. Préciser les assertions attendues \(priorité haute\)/);
  assert.match(md, /- E2 : T1 · règle test-sans-assertion/);
  assert.match(md, /Où : `prompts\/executeur\.md`/);
  assert.match(md, /## Contrôles qui ont servi/);
  assert.match(md, /Rien n'est appliqué au workflow/);
  assert.match(rendreBilan('# B', lireBilan('```yaml\nsuggestions: []\ncontroles_utiles: []\n```', []), []), /Aucune difficulté/);
});

test('nomFichierRetour range les bilans par date, dépôt et branche', () => {
  assert.equal(nomFichierRetour('2026-10-29T15:04:06.947Z', 'Mon API', 'export-csv'), '2026-10-29-mon-api-export-csv.md');
});
