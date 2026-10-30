import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lireDecision, lirePointsAudit, lireRemontee } from './reponses-llm.ts';

test("lit la remontée de l'exécuteur sur sa dernière ligne WF_REMONTEE", () => {
  const texte = 'J\'ai regardé le code.\n\nWF_REMONTEE {"type": "contradiction", "message": "EX-2 contredit EX-1"}\n';
  assert.deepEqual(lireRemontee(texte), { type: 'contradiction', message: 'EX-2 contredit EX-1' });
});

test('pas de remontée sans ligne WF_REMONTEE', () => {
  assert.equal(lireRemontee('Tâche terminée.'), null);
});

test('une ligne WF_REMONTEE illisible ou de type inconnu reste une remontée, de type question', () => {
  assert.deepEqual(lireRemontee('WF_REMONTEE {pas du json'), { type: 'question', message: 'WF_REMONTEE {pas du json' });
  assert.deepEqual(lireRemontee('WF_REMONTEE {"type": "autre", "message": "m"}'), { type: 'question', message: 'm' });
});

test("lit la décision JSON de l'arbitre, même entourée de texte ou d'un bloc de code", () => {
  const texte = 'Voici :\n```json\n{"decision": "rejeter", "raison": "le mock cache le bug", "question": ""}\n```';
  assert.deepEqual(lireDecision(texte), { decision: 'rejeter', raison: 'le mock cache le bug', question: '' });
});

test('une décision inconnue, sans raison ou une question vide rend null', () => {
  assert.equal(lireDecision('{"decision": "peut-être", "raison": "x"}'), null);
  assert.equal(lireDecision('{"decision": "accepter", "raison": ""}'), null);
  assert.equal(lireDecision('{"decision": "question", "raison": "x", "question": " "}'), null);
  assert.equal(lireDecision('rien'), null);
});

test("compte les points d'un audit au format attendu", () => {
  const audit = '1. A-1 [bloquant] EX-2 — ambigu — préciser\n2. A-2 [mineur] général — x — y\n';
  assert.deepEqual(lirePointsAudit(audit).points, ['A-1', 'A-2']);
  assert.deepEqual(lirePointsAudit('Aucun point.').points, []);
});

test('un audit hors format est refusé', () => {
  assert.equal(lirePointsAudit('Voici mon analyse : tout va bien.').erreurs.length, 1);
  assert.equal(lirePointsAudit('A-1 [grave] EX-1 — x — y').erreurs.length, 1);
  assert.equal(lirePointsAudit('A-1 [mineur] EX-1 — x — y\nA-1 [mineur] EX-2 — x — y').erreurs.length, 1);
});

test("ignore un préambule avant le premier point, même collé sur la même ligne, et ne garde que la liste", () => {
  const audit = 'Lecture du fichier.Using l’audit : je lis le code.A-1 [bloquant] EX-7 — deux erreurs — trancher\nA-2 [mineur] EX-2 — x — y\n';
  const lu = lirePointsAudit(audit);
  assert.deepEqual(lu.points, ['A-1', 'A-2']);
  assert.deepEqual(lu.erreurs, []);
  assert.equal(lu.liste, 'A-1 [bloquant] EX-7 — deux erreurs — trancher\nA-2 [mineur] EX-2 — x — y');
  assert.deepEqual(lirePointsAudit('Je lis la spec.\nAucun point.'), { points: [], erreurs: [], liste: 'Aucun point.' });
});
