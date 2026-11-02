import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { conditionsFin, ecrireMutationFaite, ligneCouverture, lireMutationFaite, lireVerdictReview, mutationReutilisable, oublierMutationFaite, resumerJournal, suiteDeLaMutation, type MutationFaite } from './fin.ts';

const faite: MutationFaite = { head: 'abc', sans: false, statut: 'faite', ligne: '- Mutation : score 87 %', section: '## Mutation testing', testsProposes: 5, vus: ['src/a.ts:1'] };

test("un finish interrompu après la mutation (review en erreur) la réutilise sur le même commit, sans relancer l'analyse", () => {
  assert.equal(mutationReutilisable(faite, 'abc', false), true);
  assert.equal(mutationReutilisable(faite, 'def', false), false, 'le commit a changé');
  assert.equal(mutationReutilisable(faite, 'abc', true), false, '--sans-mutation demandé cette fois');
  assert.equal(mutationReutilisable({ ...faite, sans: true, statut: 'sautee' }, 'abc', false), false, 'mutation sautée la dernière fois');
  assert.equal(mutationReutilisable(null, 'abc', false), false);
});

test('la mutation faite est gardée dans .workflow/ jusqu’à ce que fin.md soit écrit', () => {
  const dossier = mkdtempSync(join(tmpdir(), 'wf-fin-'));
  try {
    assert.equal(lireMutationFaite(dossier), null);
    ecrireMutationFaite(dossier, faite);
    assert.deepEqual(lireMutationFaite(dossier), faite);
    oublierMutationFaite(dossier);
    assert.equal(lireMutationFaite(dossier), null);
    oublierMutationFaite(dossier);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
  }
});

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

test("la suite de fin.md dit pourquoi l'analyse des survivants n'a pas tourné, au lieu d'annoncer « aucun test proposé »", () => {
  const m = (autres: Partial<MutationFaite>) => suiteDeLaMutation({ ...faite, testsProposes: 0, ...autres });
  assert.match(m({ testsProposes: 3 }), /propose 3 test\(s\)/);
  assert.match(m({ sansAnalyse: 'aucune-feature' }), /non lancée : la branche n'a aucune tâche feature/);
  assert.match(m({ sansAnalyse: 'aucun-survivant' }), /non lancée : aucun survivant/);
  assert.match(m({ statut: 'sautee' }), /non lancée : mutation sautée/);
  assert.match(m({ statut: 'aucun-fichier' }), /non lancée : aucun fichier de code/);
  assert.equal(m({}), "Aucun test proposé par l'analyse des survivants.");
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
