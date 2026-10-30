import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { photographier, restaurer } from './protection.ts';

let racine: string;
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'wf-prot-'));
  mkdirSync(join(racine, 'rapports'));
  writeFileSync(join(racine, 'plan.md'), 'plan');
  writeFileSync(join(racine, 'rapports', 'T1.json'), '{}');
  writeFileSync(join(racine, 'DEVIATIONS.md'), '');
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

const zones = () => [{ dossier: racine, exclus: ['DEVIATIONS.md'] }];

test('rien à restaurer quand rien ne change', () => {
  const photo = photographier(zones());
  assert.deepEqual(restaurer(photo, zones()), []);
});

test('restaure un fichier modifié ou supprimé, efface un fichier créé, et les liste', () => {
  const photo = photographier(zones());
  writeFileSync(join(racine, 'plan.md'), 'plan triché');
  rmSync(join(racine, 'rapports', 'T1.json'));
  writeFileSync(join(racine, 'rapports', 'nouveau.json'), 'x');
  const changes = restaurer(photo, zones()).sort();
  assert.deepEqual(changes, ['plan.md', 'rapports/T1.json', 'rapports/nouveau.json'].map((f) => join(racine, f)).sort());
  assert.equal(readFileSync(join(racine, 'plan.md'), 'utf8'), 'plan');
  assert.ok(existsSync(join(racine, 'rapports', 'T1.json')));
  assert.ok(!existsSync(join(racine, 'rapports', 'nouveau.json')));
});

test('les chemins exclus peuvent changer librement', () => {
  const photo = photographier(zones());
  writeFileSync(join(racine, 'DEVIATIONS.md'), 'T1 : adaptation');
  assert.deepEqual(restaurer(photo, zones()), []);
  assert.equal(readFileSync(join(racine, 'DEVIATIONS.md'), 'utf8'), 'T1 : adaptation');
});
