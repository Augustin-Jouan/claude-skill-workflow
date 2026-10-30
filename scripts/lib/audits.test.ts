import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { dernierAudit, derniereReponse, enregistrerAudit } from './audits.ts';

let dossier: string;
beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'wf-audits-'));
});
afterEach(() => rmSync(dossier, { recursive: true, force: true }));

test("numérote les audits d'une phase et retrouve le dernier", () => {
  assert.equal(dernierAudit(dossier, 'spec'), null);
  const premier = enregistrerAudit(dossier, 'spec', 'A-1 [mineur] EX-1 — x — y', ['A-1']);
  assert.match(premier, /spec-1\.md$/);
  enregistrerAudit(dossier, 'spec', 'Aucun point.', []);
  enregistrerAudit(dossier, 'plan', 'Aucun point.', []);
  assert.deepEqual(dernierAudit(dossier, 'spec'), { numero: 2, points: [] });
  assert.deepEqual(dernierAudit(dossier, 'plan'), { numero: 1, points: [] });
});

test('les numéros continuent après le dixième audit', () => {
  for (let i = 0; i < 10; i++) enregistrerAudit(dossier, 'spec', 'Aucun point.', []);
  enregistrerAudit(dossier, 'spec', 'A-1 [mineur] EX-1 — x — y', ['A-1']);
  assert.deepEqual(dernierAudit(dossier, 'spec'), { numero: 11, points: ['A-1'] });
});

function appel(phase: string, horodatage: number, prompt: string, resultat: string | null): void {
  mkdirSync(join(dossier, 'llm'), { recursive: true });
  const base = join(dossier, 'llm', `audit-${phase}-${horodatage}`);
  writeFileSync(`${base}.md`, prompt);
  if (resultat === null) return;
  const stdout = `{"type":"thinking","subtype":"delta","text":"…"}\n${JSON.stringify({ type: 'result', is_error: false, result: resultat })}`;
  writeFileSync(`${base}.sortie.txt`, `code 0\n--- stdout\n${stdout}\n--- stderr\n\n`);
}

test('reprend la réponse du dernier appel de la phase, envoyé avec le prompt actuel', () => {
  appel('spec', 1000, 'PROMPT', 'ancienne');
  appel('spec', 2000, 'PROMPT\n\n---\n\nTa réponse précédente était hors format.', 'A-1 [mineur] EX-1 — x — y');
  appel('spec-plan', 3000, 'PROMPT', 'autre phase');
  assert.deepEqual(derniereReponse(dossier, 'spec', 'PROMPT'), { texte: 'A-1 [mineur] EX-1 — x — y', horodatage: 2000 });
});

test("refuse la reprise sans appel, si la spec a changé depuis, ou si l'appel n'a rien rendu", () => {
  assert.match((derniereReponse(dossier, 'spec', 'PROMPT') as { erreur: string }).erreur, /Aucun appel/);
  appel('spec', 1000, 'ANCIEN PROMPT', 'A-1 [mineur] EX-1 — x — y');
  assert.match((derniereReponse(dossier, 'spec', 'PROMPT') as { erreur: string }).erreur, /a changé/);
  appel('spec', 2000, 'PROMPT', null);
  assert.match((derniereReponse(dossier, 'spec', 'PROMPT') as { erreur: string }).erreur, /sortie/);
});

test('refuse de reprendre une réponse déjà enregistrée comme audit', () => {
  appel('spec', 1000, 'PROMPT', 'A-1 [mineur] EX-1 — x — y');
  enregistrerAudit(dossier, 'spec', 'A-1 [mineur] EX-1 — x — y', ['A-1']);
  assert.match((derniereReponse(dossier, 'spec', 'PROMPT') as { erreur: string }).erreur, /déjà/);
});
