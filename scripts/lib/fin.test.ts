import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conditionsFin, ecrireDerniereReview, ligneCouverture, lireDerniereReview, lireVerdictReview, porteeReview, resumerJournal, sectionEcarts } from './fin.ts';

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
  const fin = { date: 'd', head: 'abc', ok: true, verdict: 'conforme' };
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

test('la couverture mesurée avant chaque refactor devient une ligne des contrôles de fin.md', () => {
  const ligne = ligneCouverture([
    { type: 'couverture', tache: 'T1', seuil: 80, fichiers: [{ fichier: 'src/duree.ts', pct: 100 }] },
    { type: 'tache', tache: 'T1' },
    { type: 'couverture', tache: 'T2', seuil: 80, fichiers: [{ fichier: 'src/duree.ts', pct: 98.5 }, { fichier: 'src/texte.ts', pct: 72 }] },
  ]);
  assert.equal(ligne, '- Couverture avant refactor (lignes, seuil 80 %) : T1 src/duree.ts 100 % ; T2 src/duree.ts 98.5 %, src/texte.ts 72 %');
  assert.equal(ligneCouverture([{ type: 'tache', tache: 'T1' }]), null);
});

test('sectionEcarts rend le tableau des écarts de la review, sans les autres sections', () => {
  const texte = '## Verdict\nécarts mineurs\n\n## Écarts\n| EX-1 | a.ts:3 | libellé | mineur |\n\n## Déviations contestées\n- aucune';
  assert.equal(sectionEcarts(texte), '| EX-1 | a.ts:3 | libellé | mineur |');
  assert.equal(sectionEcarts('## Ecarts\n\n## Fin'), null);
  assert.equal(sectionEcarts('pas de section'), null);
});

test("sans review.json, la dernière review se déduit d'un finish réussi (fin.json et fin.md)", () => {
  const dossier = mkdtempSync(join(tmpdir(), 'wf-fin-'));
  try {
    assert.equal(lireDerniereReview(dossier), null);
    writeFileSync(join(dossier, 'fin.json'), JSON.stringify({ date: 'd', head: 'h1', ok: true, verdict: 'écarts mineurs' }));
    writeFileSync(join(dossier, 'fin.md'), '# Fin\n\n## Review neuve (x, y)\n\n## Verdict\nécarts mineurs\n\n## Écarts\n| EX-1 | a |\n\n## Journal\n…');
    assert.deepEqual(lireDerniereReview(dossier), { head: 'h1', tour: 1, depuis: null, ecarts: '| EX-1 | a |', precedents: null });
    writeFileSync(join(dossier, 'fin.json'), JSON.stringify({ date: 'd', head: 'h1', ok: false, verdict: null }));
    assert.equal(lireDerniereReview(dossier), null);
    const review = { head: 'h2', tour: 2, depuis: 'h1', ecarts: null, precedents: '| EX-1 | a |' };
    ecrireDerniereReview(dossier, review);
    assert.deepEqual(lireDerniereReview(dossier), review);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

test('première review : toute la branche', () => {
  assert.deepEqual(porteeReview(null, 'h1', 's1', () => true), { tour: 1, depuis: null, precedents: null });
});

test('review suivante : seulement les corrections faites depuis la précédente', () => {
  const derniere = { head: 'h1', tour: 1, depuis: null, ecarts: '| EX-1 | … |', precedents: null };
  assert.deepEqual(porteeReview(derniere, 'h2', 's1', (c) => c === 'h1'), { tour: 2, depuis: 'h1', precedents: '| EX-1 | … |' });
});

test('relancer finish sans nouveau commit garde la portée de la review précédente', () => {
  const derniere = { head: 'h2', tour: 2, depuis: 'h1', ecarts: 'e2', precedents: 'e1' };
  assert.deepEqual(porteeReview(derniere, 'h2', 's1', () => true), { tour: 2, depuis: 'h1', precedents: 'e1' });
});

test("un historique réécrit depuis la review précédente relance une review de toute la branche", () => {
  const derniere = { head: 'h1', tour: 1, depuis: null, ecarts: 'e1', precedents: null };
  assert.deepEqual(porteeReview(derniere, 'h9', 's1', () => false), { tour: 1, depuis: null, precedents: null });
});

test("une spec modifiée depuis la review précédente (nouvelles exigences) relance une review de toute la branche", () => {
  const derniere = { head: 'h1', tour: 1, depuis: null, ecarts: 'e1', precedents: null, spec: 's1' };
  assert.deepEqual(porteeReview(derniere, 'h2', 's2', () => true), { tour: 1, depuis: null, precedents: null });
  assert.deepEqual(porteeReview(derniere, 'h2', 's1', () => true), { tour: 2, depuis: 'h1', precedents: 'e1' });
  // Review déduite d'un ancien fin.json : spec inconnue, pas de comparaison.
  assert.deepEqual(porteeReview({ ...derniere, spec: undefined }, 'h2', 's2', () => true), { tour: 2, depuis: 'h1', precedents: 'e1' });
});
