import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modeleAudit, modeleExecuteur } from './modeles.ts';

const MODELES = { simple: 'leger', complexe: 'lourd' };

test("l'exécuteur prend le modèle léger pour une tâche simple jamais rejetée", () => {
  assert.deepEqual(modeleExecuteur('simple', 0, MODELES), { modele: 'leger', raison: 'plan : simple' });
});

test("l'exécuteur prend le modèle lourd pour une tâche complexe", () => {
  assert.deepEqual(modeleExecuteur('complexe', 0, MODELES), { modele: 'lourd', raison: 'plan : complexe' });
});

test("une tâche simple passe au modèle lourd après un rejet", () => {
  assert.deepEqual(modeleExecuteur('simple', 1, MODELES), { modele: 'lourd', raison: 'escalade après 1 rejet(s)' });
});

test("l'audit d'un parcours court prend le modèle léger, quelle que soit la spec", () => {
  assert.deepEqual(modeleAudit('court', 12, MODELES, 4), { modele: 'leger', raison: 'parcours court' });
});

test("l'audit d'une petite spec prend le modèle léger, celui d'une grande le modèle lourd", () => {
  assert.deepEqual(modeleAudit('complet', 4, MODELES, 4), { modele: 'leger', raison: 'spec de 4 exigence(s)' });
  assert.deepEqual(modeleAudit('complet', 5, MODELES, 4), { modele: 'lourd', raison: 'spec de 5 exigence(s)' });
});
