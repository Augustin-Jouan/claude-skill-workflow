import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apresArbitre, apresVerdict, appliquerReponse } from './orchestration.ts';
import { nouvelleTache, type EtatTache } from './run-etat.ts';

const SEUIL = 2;
const tache = (autres: Partial<EtatTache> = {}): EtatTache => ({ ...nouvelleTache(), ...autres });

test('une tâche acceptée est committée', () => {
  assert.deepEqual(apresVerdict(tache(), { type: 'accepte' }, SEUIL).action, { type: 'commit' });
});

test('un premier rejet relance l\'exécuteur avec le rapport', () => {
  const { tache: t, action } = apresVerdict(tache(), { type: 'rejete', rapport: 'R1' }, SEUIL);
  assert.equal(t.rejets, 1);
  assert.deepEqual(action, { type: 'relancer', consigne: 'R1' });
});

test("au deuxième rejet, l'arbitre est appelé une seule fois pour la tâche", () => {
  const { tache: t, action } = apresVerdict(tache({ rejets: 1 }), { type: 'rejete', rapport: 'R2' }, SEUIL);
  assert.deepEqual(action, { type: 'arbitre', motif: 'rejets', rapport: 'R2' });
  assert.equal(t.arbitreRejets, true);
  const suite = apresVerdict(t, { type: 'rejete', rapport: 'R3' }, SEUIL);
  assert.equal(suite.action.type, 'question');
});

test("des signalements passent par l'arbitre, qui accepte ou rejette", () => {
  const { action } = apresVerdict(tache(), { type: 'signale', rapport: 'S' }, SEUIL);
  assert.deepEqual(action, { type: 'arbitre', motif: 'signalements', rapport: 'S' });
  const accepte = apresArbitre(tache(), 'signalements', 'S', { decision: 'accepter', raison: 'ok', question: '' }, SEUIL);
  assert.deepEqual(accepte.action, { type: 'commit' });
  const rejete = apresArbitre(tache(), 'signalements', 'S', { decision: 'rejeter', raison: 'mock du module testé', question: '' }, SEUIL);
  assert.equal(rejete.tache.rejets, 1);
  assert.equal(rejete.action.type, 'relancer');
  assert.match((rejete.action as { consigne: string }).consigne, /mock du module testé/);
});

test("un rejet de l'arbitre compte comme un rejet et peut mener au second arbitrage", () => {
  const { action } = apresArbitre(tache({ rejets: 1 }), 'signalements', 'S', { decision: 'rejeter', raison: 'x', question: '' }, SEUIL);
  assert.equal(action.type, 'arbitre');
});

test("après deux rejets, la consigne de l'arbitre donne une tentative de plus ; son accord ne suffit pas", () => {
  const t = tache({ rejets: 2, arbitreRejets: true });
  const relance = apresArbitre(t, 'rejets', 'R2', { decision: 'rejeter', raison: 'importe depuis ./b', question: '' }, SEUIL);
  assert.equal(relance.action.type, 'relancer');
  assert.equal(relance.tache.rejets, 2);
  const accord = apresArbitre(t, 'rejets', 'R2', { decision: 'accepter', raison: 'faux positif', question: '' }, SEUIL);
  assert.equal(accord.action.type, 'question');
});

test("une remontée passe une fois par l'arbitre, puis va au développeur", () => {
  const remontee = { type: 'question' as const, message: 'quel format ?' };
  const premiere = apresVerdict(tache(), { type: 'remontee', remontee }, SEUIL);
  assert.equal(premiere.action.type, 'arbitre');
  assert.equal(premiere.tache.remontees, 1);
  assert.equal(apresVerdict(premiere.tache, { type: 'remontee', remontee }, SEUIL).action.type, 'question');
  const consigne = apresArbitre(premiere.tache, 'remontee', 'R', { decision: 'rejeter', raison: 'ISO 8601', question: '' }, SEUIL);
  assert.equal(consigne.action.type, 'relancer');
  const confirmee = apresArbitre(premiere.tache, 'remontee', 'R', { decision: 'accepter', raison: 'le plan se contredit', question: '' }, SEUIL);
  assert.deepEqual([confirmee.action.type, (confirmee.action as { motif: string }).motif], ['question', 'remontee']);
});

test("une décision d'arbitre illisible ou une question vont au développeur", () => {
  assert.equal(apresArbitre(tache(), 'signalements', 'S', null, SEUIL).action.type, 'question');
  const q = apresArbitre(tache(), 'signalements', 'S', { decision: 'question', raison: 'r', question: 'garder le mock ?' }, SEUIL);
  assert.match((q.action as { question: string }).question, /garder le mock \?/);
});

test('la réponse du développeur remet les compteurs à zéro et devient la consigne', () => {
  const t = appliquerReponse(tache({ rejets: 3, arbitreRejets: true, remontees: 1, dureeMs: 9 }), 'rejets', 'utilise la fixture B');
  assert.deepEqual([t.rejets, t.arbitreRejets, t.remontees, t.dureeMs], [0, false, 0, 9]);
  assert.match(t.consigne ?? '', /utilise la fixture B/);
  assert.equal(appliquerReponse(tache({ dureeMs: 9 }), 'budget-tache', 'continue').dureeMs, 0);
  assert.equal(appliquerReponse(tache(), 'couverture', 'continue').couvertureVerifiee, true);
});
