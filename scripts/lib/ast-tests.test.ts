import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocsDeTest } from './ast-tests.ts';

const CODE = `import { describe, it, expect } from 'vitest';

describe('facture', () => {
  it('EX-1 — refuse sans client', () => {
    expect(() => creer({})).toThrow();
  });
  describe.each([1, 2])('montant %i', (n) => {
    test(\`EX-2 — arrondit\`, () => expect(n).toBe(n));
  });
});

it.each([[1]])('EX-3 — table %s', () => {});
xit('désactivé', () => {});
test.only('focalisé', () => {});
`;

test('liste les blocs describe / it / test avec leur chemin de noms', () => {
  const blocs = blocsDeTest(CODE, 'a.test.ts');
  assert.deepEqual(
    blocs.map((b) => [b.genre, b.chemin.join(' > ')]),
    [
      ['describe', 'facture'],
      ['test', 'facture > EX-1 — refuse sans client'],
      ['describe', 'facture > montant %i'],
      ['test', 'facture > montant %i > EX-2 — arrondit'],
      ['test', 'EX-3 — table %s'],
      ['test', 'désactivé'],
      ['test', 'focalisé'],
    ],
  );
});

test('donne la fonction racine, les modificateurs et la ligne de chaque bloc', () => {
  const blocs = blocsDeTest(CODE, 'a.test.ts');
  const parNom = (nom: string) => blocs.find((b) => b.nom === nom);
  assert.deepEqual([parNom('EX-1 — refuse sans client')?.fonction, parNom('EX-1 — refuse sans client')?.ligne], ['it', 4]);
  assert.deepEqual(parNom('montant %i')?.modificateurs, ['each']);
  assert.equal(parNom('désactivé')?.fonction, 'xit');
  assert.deepEqual(parNom('focalisé')?.modificateurs, ['only']);
});

test('ignore les appels qui ne sont pas des fonctions de test', () => {
  const blocs = blocsDeTest("expect(it).toBe(1);\nfoo.it('x', () => {});\nsetup('y', () => {});\n", 'b.test.ts');
  assert.deepEqual(blocs, []);
});

test('lit aussi le JavaScript et le TSX', () => {
  assert.equal(blocsDeTest("it('EX-1 — js', () => {});", 'c.test.js').length, 1);
  assert.equal(blocsDeTest("it('EX-1 — tsx', () => { render(<A x={1} />); });", 'd.test.tsx').length, 1);
});
