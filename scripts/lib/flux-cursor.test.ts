import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECT, enDirect, LecteurFlux } from './flux-cursor.ts';

const RACINE = 'C:\\depot';
const j = (o: unknown) => JSON.stringify(o);

function lire(lignes: unknown[]): string[] {
  const lecteur = new LecteurFlux(RACINE);
  return lignes.flatMap((l) => lecteur.lire(typeof l === 'string' ? l : j(l)));
}

test('décrit les outils lancés, avec des chemins relatifs au dépôt', () => {
  const sortie = lire([
    { type: 'tool_call', subtype: 'started', tool_call: { readToolCall: { args: { path: 'C:\\depot\\src\\a.ts' } } } },
    { type: 'tool_call', subtype: 'started', tool_call: { editToolCall: { args: { path: 'C:\\depot\\src\\b.ts' } } } },
    { type: 'tool_call', subtype: 'started', tool_call: { shellToolCall: { args: { command: 'npm test' } } } },
    { type: 'tool_call', subtype: 'started', tool_call: { grepToolCall: { args: { pattern: 'facture' } } } },
    { type: 'tool_call', subtype: 'started', tool_call: { globToolCall: { args: { globPattern: '**/a.txt' } } } },
  ]);
  assert.deepEqual(sortie, ['lit src/a.ts', 'modifie src/b.ts', '$ npm test', 'grep « facture »', 'cherche **/a.txt']);
});

test("donne le résultat d'une commande et d'une modification", () => {
  const sortie = lire([
    { type: 'tool_call', subtype: 'completed', tool_call: { shellToolCall: { args: { command: 'npm test' }, result: { failure: { exitCode: 1, stderr: 'ligne 1\nFAIL a.test.ts\n' } } } } },
    { type: 'tool_call', subtype: 'completed', tool_call: { editToolCall: { args: { path: 'C:\\depot\\src\\b.ts' }, result: { success: { linesAdded: 3, linesRemoved: 1 } } } } },
    { type: 'tool_call', subtype: 'completed', tool_call: { readToolCall: { args: { path: 'C:\\depot\\src\\a.ts' }, result: { success: {} } } } },
    { type: 'tool_call', subtype: 'completed', tool_call: { readToolCall: { args: { path: 'C:\\depot\\x.ts' }, result: { error: { errorMessage: 'File not found' } } } } },
  ]);
  assert.deepEqual(sortie, ['  → code 1 : FAIL a.test.ts', '  → +3 −1', '  → échec : File not found']);
});

test('regroupe la réflexion en un paragraphe, et la coupe quand elle dure', () => {
  const delta = (text: string) => ({ type: 'thinking', subtype: 'delta', text });
  assert.deepEqual(lire([delta('Je lis '), delta('le module.'), { type: 'thinking', subtype: 'completed' }]), ['réfléchit : Je lis le module.']);
  const long = lire([delta('a'.repeat(450)), delta('b')]);
  assert.equal(long.length, 1);
  assert.match(long[0], /^réfléchit : a{300}…$/);
});

test('affiche la réponse sur une ligne, puis la fin', () => {
  const sortie = lire([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Fait.\nTests verts.' }] } },
    { type: 'result', subtype: 'success', duration_ms: 7773, is_error: false },
  ]);
  assert.deepEqual(sortie, ['dit : Fait. Tests verts.', 'terminé en 8 s']);
});

test('ignore les lignes illisibles et les événements sans intérêt', () => {
  assert.deepEqual(lire(['pas du json', { type: 'system', subtype: 'init' }, { type: 'user' }]), []);
});

test('le direct préfixe chaque ligne pour la distinguer de la progression du workflow', () => {
  assert.equal(enDirect('lit a.ts', '11:15:02'), `${DIRECT}11:15:02  lit a.ts`);
  assert.ok(!enDirect('lit a.ts', '11:15:02').startsWith('· '));
});
