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

test('resumerFin garde les contrôles de fin.md, pas la review ni le journal', () => {
  const fin = [
    '# Fin de branche — wf/x',
    'Commit bccaed32 · base c17b1f6f · 2026-10-30',
    '## Contrôles',
    '- Traçabilité : ✅ 8 exigence(s) nommée(s) dans un test\n- Suite complète : ✅\n- Typecheck : ✅\n- Review neuve : conforme',
    '## Review neuve (claude, opus)',
    'Long texte de review.',
    '## Journal',
    '| Règle | Niveau | Fois |',
  ].join('\n\n');
  const r = resumerFin(fin);
  assert.match(r, /^Fin de branche prête — wf\/x/);
  assert.match(r, /- Suite complète : ✅/);
  assert.match(r, /- Review neuve : conforme/);
  assert.match(r, /\.workflow\/fin\.md/);
  assert.doesNotMatch(r, /Long texte de review|\| Règle/);
  assert.ok(r.split('\n').length <= 12);
});

test('executer relaie aussitôt la progression et le direct de Cursor, pas le reste', () => {
  assert.equal(aRelayer('· T1 : tentative 1 de l\'exécuteur'), true);
  assert.equal(aRelayer(`${DIRECT}11:15:02  lit src/a.ts`), true);
  assert.equal(aRelayer('Message du verdict'), false);
});
