import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aRelayer, etapesExecuter, resumerFin } from './executer.ts';
import { DIRECT } from './flux-cursor.ts';

test("executer enchaîne run-plan, le passage à fin et finish depuis l'exécution, finish seul depuis fin", () => {
  assert.deepEqual(etapesExecuter('execution'), ['run-plan', 'avancer', 'finish']);
  assert.deepEqual(etapesExecuter('fin'), ['finish']);
  assert.equal(etapesExecuter('plan'), null);
  assert.equal(etapesExecuter('termine'), null);
});

test('resumerFin garde les contrôles et la suite de fin.md, pas la review ni les survivants', () => {
  const fin = [
    '# Fin de branche — wf/x',
    'Commit bccaed32 · base c17b1f6f · 2026-10-30',
    '## Contrôles',
    '- Traçabilité : ✅ 8 exigence(s) nommée(s) dans un test\n- Suite complète : ✅\n- Mutation : score 84 % (81/97 mutants tués, 1 fichier(s), Stryker complet)\n- Review neuve : conforme',
    '## Mutation testing',
    '| Fichier | Mutants |',
    '## Review neuve (claude, opus)',
    'Long texte de review.',
    '## Suite',
    'Aucun test proposé par l\'analyse des survivants.',
  ].join('\n\n');
  const r = resumerFin(fin);
  assert.match(r, /^Fin de branche prête — wf\/x/);
  assert.match(r, /- Suite complète : ✅/);
  assert.match(r, /Stryker complet/);
  assert.match(r, /- Review neuve : conforme/);
  assert.match(r, /Aucun test proposé/);
  assert.match(r, /\.workflow\/fin\.md/);
  assert.doesNotMatch(r, /Long texte de review|\| Fichier/);
  assert.ok(r.split('\n').length <= 12);
});

test('executer relaie aussitôt la progression et le direct de Cursor, pas le reste', () => {
  assert.equal(aRelayer('· T1 : tentative 1 de l\'exécuteur'), true);
  assert.equal(aRelayer(`${DIRECT}11:15:02  lit src/a.ts`), true);
  assert.equal(aRelayer('Message du verdict'), false);
});
