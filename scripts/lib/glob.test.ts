import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correspond } from './glob.ts';

test('un motif sans « / » vise le nom du fichier à toute profondeur', () => {
  assert.ok(correspond('tsconfig.json', 'tsconfig*.json'));
  assert.ok(correspond('packages/api/tsconfig.build.json', 'tsconfig*.json'));
  assert.ok(correspond('vitest.config.ts', 'vitest.config.*'));
  assert.ok(!correspond('src/tsconfig.ts', 'tsconfig*.json'));
});

test('un motif avec « / » part de la racine', () => {
  assert.ok(correspond('.github/workflows/ci.yml', '.github/**'));
  assert.ok(!correspond('docs/.github/x.yml', '.github/**'));
});

test('« **/ » couvre zéro ou plusieurs dossiers', () => {
  assert.ok(correspond('a.test.ts', '**/*.test.*'));
  assert.ok(correspond('src/deep/a.test.ts', '**/*.test.*'));
  assert.ok(correspond('test/fixtures/a.json', '**/test/**'));
  assert.ok(correspond('packages/x/test/a.ts', '**/test/**'));
  assert.ok(!correspond('src/latest/a.ts', '**/test/**'));
});

test('« * » ne traverse pas les dossiers', () => {
  assert.ok(!correspond('src/a/b.test.ts', 'src/*.test.ts'));
  assert.ok(correspond('src/b.test.ts', 'src/*.test.ts'));
});

test('les points et autres caractères spéciaux sont littéraux', () => {
  assert.ok(!correspond('vitestXconfigXts', 'vitest.config.*'));
});
