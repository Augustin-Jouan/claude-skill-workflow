import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { lireChangements, lignesModifiees } from './diff.ts';

test('lit les lignes ajoutées ou modifiées de chaque fichier dans un diff -U0', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3 +3,2 @@ function x() {',
    '-old',
    '+new',
    '+new2',
    '@@ -10,2 +11,0 @@',
    '-gone',
    '-gone2',
    '@@ -20,0 +20 @@',
    '+added',
    'diff --git a/b c.ts b/b c.ts',
    '--- a/b c.ts',
    '+++ b/b c.ts',
    '@@ -1 +1 @@',
    '-x',
    '+y',
  ].join('\n');
  const r = lignesModifiees(diff);
  assert.deepEqual([...(r.get('src/a.ts') ?? [])], [3, 4, 20]);
  assert.deepEqual([...(r.get('b c.ts') ?? [])], [1]);
});

let depot: string;
const g = (...args: string[]) => execFileSync('git', args, { cwd: depot, stdio: 'pipe' });

before(() => {
  depot = mkdtempSync(join(tmpdir(), 'wf-diff-'));
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  mkdirSync(join(depot, 'src'));
  writeFileSync(join(depot, 'src/a.ts'), 'un\ndeux\ntrois\n');
  writeFileSync(join(depot, 'src/supprime.ts'), 'x\n');
  writeFileSync(join(depot, 'garde.ts'), 'g\n');
  g('add', '.');
  g('commit', '-q', '-m', 'init');
  writeFileSync(join(depot, 'src/a.ts'), 'un\nDEUX\ntrois\nquatre\n');
  unlinkSync(join(depot, 'src/supprime.ts'));
  writeFileSync(join(depot, 'src/nouveau.ts'), 'n1\nn2\n');
});
after(() => rmSync(depot, { recursive: true, force: true }));

test("lit les changements de l'arbre de travail par rapport à HEAD, fichiers non suivis compris", () => {
  const changements = lireChangements(depot);
  const parChemin = new Map(changements.map((c) => [c.chemin, c]));
  assert.deepEqual([...parChemin.keys()].sort(), ['src/a.ts', 'src/nouveau.ts', 'src/supprime.ts']);

  const a = parChemin.get('src/a.ts');
  assert.equal(a?.statut, 'modifie');
  assert.equal(a?.avant, 'un\ndeux\ntrois\n');
  assert.equal(a?.apres, 'un\nDEUX\ntrois\nquatre\n');
  assert.deepEqual([...(a?.lignes ?? [])], [2, 4]);

  const n = parChemin.get('src/nouveau.ts');
  assert.equal(n?.statut, 'ajoute');
  assert.equal(n?.avant, null);
  assert.equal(n?.lignes, null, 'null = toutes les lignes sont nouvelles');

  const s = parChemin.get('src/supprime.ts');
  assert.equal(s?.statut, 'supprime');
  assert.equal(s?.apres, null);
});
