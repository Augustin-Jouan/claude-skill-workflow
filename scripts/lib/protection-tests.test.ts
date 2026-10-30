import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparerTestsExistants } from './protection-tests.ts';

const AVANT = `import { describe, it, expect, beforeEach } from 'vitest';
import { creer } from './invoice';

function facture(montant: number) {
  return { montant };
}

describe('facture', () => {
  let f: { montant: number };
  beforeEach(() => {
    f = facture(10);
  });

  it('refuse sans client', () => {
    expect(() => creer({})).toThrow();
  });

  it('arrondit', () => {
    expect(f.montant).toBe(10);
  });
});
`;

function constats(apres: string): string[] {
  return comparerTestsExistants(AVANT, apres, 'src/invoice.test.ts').map((c) => `${c.regle}:${c.message}`);
}

test('autorise de reformater, commenter, ajouter des imports, des helpers et des tests', () => {
  const apres = AVANT.replace("import { creer } from './invoice';", "import { creer, payer } from './invoice';\nimport { x } from './x';")
    .replace('function facture', '// helper\nfunction nouveau() { return 1; }\n\nfunction facture')
    .replace("  it('arrondit'", "  it('EX-3 — paie', () => {\n    expect(payer()).toBe(true);\n  });\n\n  it('arrondit'")
    .replace('expect(f.montant).toBe(10);', 'expect(f.montant)\n      .toBe(10); // commentaire');
  assert.deepEqual(constats(apres), []);
});

test('modifier le corps d\'un test existant est bloquant', () => {
  const r = constats(AVANT.replace('toBe(10)', 'toBe(11)'));
  assert.equal(r.length, 1);
  assert.match(r[0], /^test-existant-modifie:.*facture > arrondit/);
});

test('renommer un test compte comme une suppression', () => {
  const r = constats(AVANT.replace("it('arrondit'", "it('arrondit au centime'"));
  assert.equal(r.length, 1);
  assert.match(r[0], /^test-existant-supprime:.*facture > arrondit/);
});

test('supprimer un test est bloquant', () => {
  const r = constats(AVANT.replace(/\n {2}it\('arrondit'[\s\S]*?\n {2}\}\);\n/, '\n'));
  assert.equal(r.length, 1);
  assert.match(r[0], /^test-existant-supprime:/);
});

test('toucher un hook partagé ou un helper existant est bloquant', () => {
  assert.match(constats(AVANT.replace('f = facture(10);', 'f = facture(20);'))[0], /^test-existant-modifie:.*beforeEach/);
  assert.match(constats(AVANT.replace('return { montant };', 'return { montant: montant * 2 };'))[0], /^test-existant-modifie:.*facture/);
});

test('ajouter un timeout ou un modificateur à un test existant est une modification', () => {
  const r = constats(AVANT.replace("expect(f.montant).toBe(10);\n  });", "expect(f.montant).toBe(10);\n  }, 60000);"));
  assert.equal(r.length, 1);
  assert.match(r[0], /^test-existant-modifie:/);
});

test('changer la table d\'un describe.each est une modification', () => {
  const avant = "describe.each([1, 2])('n %i', (n) => {\n  it('a', () => { expect(n).toBeGreaterThan(0); });\n});\n";
  const apres = avant.replace('[1, 2]', '[1]');
  assert.equal(comparerTestsExistants(avant, apres, 'a.test.ts').length, 1);
});

test('deux tests de même nom sont suivis séparément', () => {
  const avant = "it('a', () => { expect(1).toBe(1); });\nit('a', () => { expect(2).toBe(2); });\n";
  const apres = "it('a', () => { expect(1).toBe(1); });\n";
  assert.equal(comparerTestsExistants(avant, apres, 'a.test.ts').length, 1);
});
