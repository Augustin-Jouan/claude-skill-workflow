import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyserSource } from './regles-source.ts';

function regles(code: string, opts: { test?: boolean; lignes?: number[]; modules?: string[]; chemin?: string } = {}) {
  const chemin = opts.chemin ?? (opts.test ? 'src/a.test.ts' : 'src/a.ts');
  return analyserSource(code, chemin, {
    lignes: opts.lignes ? new Set(opts.lignes) : null,
    estTest: opts.test ?? false,
    modulesTestes: opts.modules ?? [],
  }).map((c) => `${c.niveau}:${c.regle}`);
}

test('any sous toutes ses formes est bloquant', () => {
  assert.deepEqual(regles('const a = x as any;'), ['bloquant:no-explicit-any']);
  assert.deepEqual(regles('function f(a: any) {}'), ['bloquant:no-explicit-any']);
  assert.deepEqual(regles('const a = <any>x;'), ['bloquant:no-explicit-any']);
  assert.deepEqual(regles('const a: Array<string> = [];'), []);
});

test('les commentaires @ts-ignore, @ts-expect-error, @ts-nocheck sont bloquants', () => {
  assert.deepEqual(regles('// @ts-ignore\nconst a = 1;'), ['bloquant:ban-ts-comment']);
  assert.deepEqual(regles('const a = 1; /* @ts-expect-error */'), ['bloquant:ban-ts-comment']);
  assert.deepEqual(regles('// @ts-nocheck\n'), ['bloquant:ban-ts-comment']);
  assert.deepEqual(regles("const s = '@ts-ignore';"), [], 'une chaîne n\'est pas un commentaire');
});

test('seules les lignes modifiées comptent quand elles sont fournies', () => {
  const code = 'const a = x as any;\nconst b = y as any;\n';
  assert.deepEqual(regles(code, { lignes: [2] }), ['bloquant:no-explicit-any']);
  assert.deepEqual(regles(code, { lignes: [3] }), []);
});

test('tests focalisés, désactivés, todo et fails sont bloquants dans un fichier de test', () => {
  const ok = "expect(1).toBe(1)";
  assert.deepEqual(regles(`it.only('a', () => { ${ok} });`, { test: true }), ['bloquant:no-focused-tests']);
  assert.deepEqual(regles(`fit('a', () => { ${ok} });`, { test: true }), ['bloquant:no-focused-tests']);
  assert.deepEqual(regles(`describe.skip('a', () => {});`, { test: true }), ['bloquant:no-disabled-tests']);
  assert.deepEqual(regles(`xit('a', () => { ${ok} });`, { test: true }), ['bloquant:no-disabled-tests']);
  assert.deepEqual(regles(`test.todo('a');`, { test: true }), ['bloquant:todo-fails']);
  assert.deepEqual(regles(`test.fails('a', () => { ${ok} });`, { test: true }), ['bloquant:todo-fails']);
});

test("un test sans assertion est bloquant", () => {
  assert.deepEqual(regles("it('a', () => { faire(); });", { test: true }), ['bloquant:expect-expect']);
  assert.deepEqual(regles("it('a', () => { expect(f()).toBe(1); });", { test: true }), []);
  assert.deepEqual(regles("it('a', async () => { await expect(p).rejects.toThrow(); });", { test: true }), []);
  assert.deepEqual(regles("it('a', () => { assert.equal(f(), 1); });", { test: true }), []);
  assert.deepEqual(regles("it('a', () => { expectFacture(f()); });", { test: true }), [], 'helper expect* accepté');
});

test('les règles de test ne s\'appliquent pas hors fichier de test', () => {
  assert.deepEqual(regles("it.only('a', () => {});"), []);
});

test('augmenter les timeouts est bloquant', () => {
  assert.deepEqual(regles('vi.setConfig({ testTimeout: 60000 });', { test: true }), ['bloquant:timeout']);
  assert.deepEqual(regles('jest.setTimeout(60000);', { test: true }), ['bloquant:timeout']);
});

test('signale !, as unknown as, et un catch qui avale l\'erreur', () => {
  assert.deepEqual(regles('const a = x!.y;'), ['signale:non-null']);
  assert.deepEqual(regles('const a = x as unknown as Facture;'), ['signale:as-unknown-as']);
  assert.deepEqual(regles('try { f(); } catch {}'), ['signale:catch-avale']);
  assert.deepEqual(regles('try { f(); } catch (e) { log("x"); }'), ['signale:catch-avale']);
  assert.deepEqual(regles('try { f(); } catch (e) { log(e); }'), []);
  assert.deepEqual(regles('try { f(); } catch { throw new Error("x"); }'), []);
});

test('signale un test dont les seules assertions sont faibles', () => {
  assert.deepEqual(regles("it('a', () => { expect(f()).toBeDefined(); });", { test: true }), ['signale:assertions-faibles']);
  assert.deepEqual(regles("it('a', () => { expect(f()).toBeTruthy(); expect(g()).toBe(2); });", { test: true }), []);
});

test('signale un mock du module testé', () => {
  const code = "vi.mock('./invoice');\nit('a', () => { expect(1).toBe(1); });";
  assert.deepEqual(regles(code, { test: true, chemin: 'src/invoice.test.ts', modules: ['src/invoice'] }), ['signale:mock-module-teste']);
  assert.deepEqual(regles(code, { test: true, chemin: 'src/invoice.test.ts', modules: ['src/autre'] }), []);
  assert.deepEqual(regles("jest.mock('../src/invoice.ts');", { test: true, chemin: 'test/a.test.ts', modules: ['src/invoice'] }), ['signale:mock-module-teste']);
});

test('chaque constat porte sa ligne', () => {
  const c = analyserSource('const a = 1;\nconst b = x as any;\n', 'src/a.ts', { lignes: null, estTest: false, modulesTestes: [] });
  assert.equal(c[0].ligne, 2);
  assert.equal(c[0].fichier, 'src/a.ts');
});
