import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estFichierDeTestCode, tracerExigences } from './trace.ts';

const SPEC = [
  { id: 'EX-1', titre: 'A' },
  { id: 'EX-2', titre: 'B' },
  { id: 'EX-12', titre: 'C' },
];

test('trouve chaque exigence dans un nom de test et dit où', () => {
  const r = tracerExigences(SPEC, [
    { chemin: 'src/a.test.ts', code: "it('EX-1 — a', () => {});\ndescribe('x', () => { test('EX-12 — c', () => {}); });" },
    { chemin: 'src/b.spec.ts', code: "it('EX-2 - b', () => {});" },
  ]);
  assert.deepEqual(r.absentes, []);
  assert.deepEqual(r.trouvees['EX-1'], ['src/a.test.ts']);
  assert.deepEqual(r.trouvees['EX-12'], ['src/a.test.ts']);
});

test('signale une exigence absente de tous les noms de test', () => {
  const r = tracerExigences(SPEC, [{ chemin: 'a.test.ts', code: "it('EX-1 — a', () => {});" }]);
  assert.deepEqual(r.absentes, ['EX-2', 'EX-12']);
});

test("EX-1 n'est pas tracée par un test qui ne cite que EX-12", () => {
  const r = tracerExigences(SPEC, [{ chemin: 'a.test.ts', code: "it('EX-12 — c', () => {});" }]);
  assert.ok(r.absentes.includes('EX-1'));
});

test('un nom de describe, un commentaire ou une chaîne ne tracent pas une exigence', () => {
  const code = "// EX-1\ndescribe('EX-1 — groupe', () => { it('autre', () => { expect('EX-2').toBe('EX-2'); }); });";
  const r = tracerExigences(SPEC, [{ chemin: 'a.test.ts', code }]);
  assert.deepEqual(r.absentes, ['EX-1', 'EX-2', 'EX-12']);
});

test('reconnaît les fichiers de test de code', () => {
  assert.ok(estFichierDeTestCode('src/a.test.ts'));
  assert.ok(estFichierDeTestCode('src/a.spec.mjs'));
  assert.ok(estFichierDeTestCode('src/a.test.tsx'));
  assert.ok(!estFichierDeTestCode('src/a.ts'));
  assert.ok(!estFichierDeTestCode('src/__snapshots__/a.test.ts.snap'));
});
