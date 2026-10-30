import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { preparerArbreAncien, supprimerArbreAncien } from './arbre-ancien.ts';

let depot: string;
let arbre: string;
const g = (...args: string[]) => execFileSync('git', args, { cwd: depot, encoding: 'utf8', stdio: 'pipe' });
const lire = (racine: string, chemin: string) => readFileSync(join(racine, chemin), 'utf8').replace(/\r\n/g, '\n');

before(() => {
  depot = mkdtempSync(join(tmpdir(), 'wf-arbre-'));
  arbre = join(depot, '.workflow', 'rouge');
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  mkdirSync(join(depot, 'src'));
  writeFileSync(join(depot, '.git', 'info', 'exclude'), '.workflow/\n');
  writeFileSync(join(depot, 'src/a.ts'), 'v1\n');
  writeFileSync(join(depot, 'src/a.test.ts'), 'ancien test\n');
  writeFileSync(join(depot, 'src/vieux.test.ts'), 'vieux\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  // Travail de la tâche, non commité.
  writeFileSync(join(depot, 'src/a.ts'), 'v2\n');
  writeFileSync(join(depot, 'src/a.test.ts'), 'nouveau test\n');
  mkdirSync(join(depot, 'test/fixtures'), { recursive: true });
  writeFileSync(join(depot, 'test/fixtures/f.json'), '{}\n');
  rmSync(join(depot, 'src/vieux.test.ts'));
});
after(() => rmSync(depot, { recursive: true, force: true }));

test("prépare l'ancien code avec les fichiers de test de la tâche", () => {
  preparerArbreAncien(depot, arbre, ['src/a.test.ts', 'test/fixtures/f.json', 'src/vieux.test.ts']);
  assert.equal(lire(arbre, 'src/a.ts'), 'v1\n', 'code non-test : version de HEAD');
  assert.equal(lire(arbre, 'src/a.test.ts'), 'nouveau test\n', 'test : version de la tâche');
  assert.equal(lire(arbre, 'test/fixtures/f.json'), '{}\n');
  assert.ok(!existsSync(join(arbre, 'src/vieux.test.ts')), 'test supprimé par la tâche');
  assert.equal(lire(depot, 'src/a.ts'), 'v2\n', "l'arbre de travail n'est pas touché");
  assert.equal(g('status', '--short', '--', '.workflow'), '');
});

test("se reprépare par-dessus un arbre resté d'un passage interrompu, puis se supprime sans trace", () => {
  preparerArbreAncien(depot, arbre, ['src/a.test.ts']);
  preparerArbreAncien(depot, arbre, ['src/a.test.ts']);
  supprimerArbreAncien(depot, arbre);
  assert.ok(!existsSync(arbre));
  assert.equal(g('worktree', 'list').trim().split('\n').length, 1);
  assert.equal(lire(depot, 'src/a.ts'), 'v2\n');
});
