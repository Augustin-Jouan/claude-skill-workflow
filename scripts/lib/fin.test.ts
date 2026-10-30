import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conditionsFin, lireVerdictReview, resumerJournal } from './fin.ts';

test('lireVerdictReview lit la ligne qui suit « ## Verdict »', () => {
  assert.equal(lireVerdictReview('## Verdict\nécarts mineurs\n\n## Écarts\n…'), 'écarts mineurs');
  assert.equal(lireVerdictReview('Intro\n## Verdict\n\n**Conforme**\n'), 'conforme');
  assert.equal(lireVerdictReview('## Verdict\nÉcarts bloquants : EX-2'), 'écarts bloquants');
  assert.equal(lireVerdictReview('pas de verdict'), null);
  assert.equal(lireVerdictReview('## Verdict\nça dépend'), null);
});

test('resumerJournal compte règles, arbitrages, instables, questions et tâches', () => {
  const lignes = [
    { type: 'regle', tache: 'T1', regle: 'test-prevu-echec', niveau: 'bloquant' },
    { type: 'regle', tache: 'T1', regle: 'test-prevu-echec', niveau: 'bloquant' },
    { type: 'regle', tache: 'T2', regle: 'hors-plan', niveau: 'signale' },
    { type: 'arbitrage', tache: 'T2', motif: 'signalements', decision: 'accepter' },
    { type: 'instable', tache: 'T2', test: 'src/a.test.ts › x' },
    { type: 'question', tache: 'T2', motif: 'arbitre' },
    { type: 'llm', role: 'executeur', tache: 'T1', tokens: null },
    { type: 'llm', role: 'arbitre', tache: 'T2', tokens: 120 },
    { type: 'tache', tache: 'T1', tentatives: 2, appelsLlm: 2, dureeMs: 125_000 },
    { type: 'jalon', tache: 'T2', ok: false, fautif: 'T1' },
  ];
  const r = resumerJournal(lignes, { executeur: 'cursor-agent', arbitre: 'claude' });
  assert.match(r, /\| test-prevu-echec \| bloquant \| 2 \|/);
  assert.match(r, /\| hors-plan \| signalé \| 1 \|/);
  assert.match(r, /T2 · signalements → accepter/);
  assert.match(r, /src\/a\.test\.ts › x/);
  assert.match(r, /\| T1 \| 2 \| 2 \| 2 min \|/);
  assert.match(r, /Cursor : 1 appel\(s\) · 0 jeton\(s\) — Claude : 1 appel\(s\) · 120 jeton\(s\)/);
  assert.match(r, /session Claude qui pilote le workflow n'est pas comptée/);
  assert.match(r, /T2 : rouge, premier commit fautif T1/);
  assert.match(r, /T2 · arbitre/);
});

test('resumerJournal dit quand il n’y a rien', () => {
  const r = resumerJournal([]);
  assert.match(r, /Aucune règle déclenchée/);
  assert.match(r, /Aucun arbitrage/);
});

test('conditionsFin : finish passé sur le HEAD actuel, arbre propre', () => {
  const fin = { date: 'd', head: 'abc', ok: true, mutation: 'faite' as const, verdict: 'conforme' };
  assert.deepEqual(conditionsFin(fin, 'abc', true), []);
  assert.match(conditionsFin(null, 'abc', true).join(' '), /jamais été lancé/);
  assert.match(conditionsFin({ ...fin, ok: false }, 'abc', true).join(' '), /a échoué/);
  assert.match(conditionsFin(fin, 'def', true).join(' '), /changé depuis/);
  assert.match(conditionsFin(fin, 'abc', false).join(' '), /non commités/);
});

test('resumerJournal liste le modèle Cursor choisi à chaque appel, avec sa raison', () => {
  const md = resumerJournal([
    { type: 'llm', role: 'audit', phase: 'spec', modele: 'lourd', raison: 'spec de 8 exigence(s)', dureeMs: 360_000 },
    { type: 'llm', role: 'executeur', tache: 'T1', tentative: 1, modele: 'leger', raison: 'plan : simple', dureeMs: 120_000 },
    { type: 'llm', role: 'executeur', tache: 'T1', tentative: 2, modele: 'lourd', raison: 'escalade après 1 rejet(s)', dureeMs: 240_000 },
    { type: 'llm', role: 'review', dureeMs: 60_000 },
  ]);
  assert.match(md, /### Modèles choisis/);
  assert.match(md, /audit spec · lourd \(spec de 8 exigence\(s\)\) · 6 min/);
  assert.match(md, /T1 tentative 2 · lourd \(escalade après 1 rejet\(s\)\) · 4 min/);
  assert.doesNotMatch(md, /review ·/);
});
