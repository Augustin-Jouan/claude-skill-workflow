// .workflow/journal.jsonl : une ligne JSON par événement mesuré (règle, appel LLM, tâche, tri d'audit, phase manuelle).

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Etat } from './etat.ts';

export function ajouterAuJournal(dossier: string, etat: Etat, ligne: Record<string, unknown>): Record<string, unknown> {
  const complete = { date: new Date().toISOString(), parcours: etat.parcours, branche: etat.branche, ...ligne };
  appendFileSync(join(dossier, 'journal.jsonl'), `${JSON.stringify(complete)}\n`);
  return complete;
}
