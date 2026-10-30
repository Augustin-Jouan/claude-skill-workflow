import assert from 'node:assert/strict';
import { test } from 'node:test';
import { premierFautif } from './bisect.ts';

function sonde(fautif: number) {
  const testes: string[] = [];
  const echoue = async (c: string) => {
    testes.push(c);
    return Number(c.slice(1)) >= fautif;
  };
  return { testes, echoue };
}

test('premierFautif trouve le premier commit qui échoue par dichotomie', async () => {
  const commits = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
  const { testes, echoue } = sonde(3);
  assert.equal(await premierFautif(commits, echoue), 'c3');
  assert.ok(testes.length <= 3, `trop de sondes : ${testes.join(', ')}`);
  assert.ok(!testes.includes('c8'), 'le dernier commit est déjà connu comme fautif');
});

test('premierFautif rend le seul commit sans le tester', async () => {
  const { testes, echoue } = sonde(1);
  assert.equal(await premierFautif(['c1'], echoue), 'c1');
  assert.deepEqual(testes, []);
});

test('premierFautif rend le dernier commit quand tous les autres passent', async () => {
  const { echoue } = sonde(5);
  assert.equal(await premierFautif(['c1', 'c2', 'c3', 'c4', 'c5'], echoue), 'c5');
});

test('premierFautif rend le premier commit quand tout échoue', async () => {
  const { echoue } = sonde(1);
  assert.equal(await premierFautif(['c1', 'c2', 'c3', 'c4'], echoue), 'c1');
});

test('premierFautif refuse une liste vide', async () => {
  await assert.rejects(premierFautif([], async () => true), /aucun commit/i);
});
