// « wf executer » : l'enchaînement exécution → fin sans la session qui pilote, et le résumé qu'elle présente.

import type { Etape } from './etat.ts';
import { DIRECT } from './flux-cursor.ts';

export type EtapeExecuter = 'run-plan' | 'avancer' | 'finish';

export function etapesExecuter(etape: Etape): EtapeExecuter[] | null {
  if (etape === 'execution') return ['run-plan', 'avancer', 'finish'];
  if (etape === 'fin') return ['finish'];
  return null;
}

// Progression du workflow et direct de Cursor : relayés aussitôt, pour que le détail du shell montre le direct.
export function aRelayer(ligne: string): boolean {
  return ligne.startsWith('· ') || ligne.startsWith(DIRECT);
}

function section(texte: string, titre: string): string {
  const lignes = texte.split(/\r?\n/);
  const debut = lignes.findIndex((l) => l.trim() === `## ${titre}`);
  if (debut < 0) return '';
  const fin = lignes.findIndex((l, i) => i > debut && l.startsWith('## '));
  return lignes
    .slice(debut + 1, fin < 0 ? undefined : fin)
    .join('\n')
    .trim();
}

// Les contrôles suffisent à la revue finale ; la review et le journal restent dans fin.md.
export function resumerFin(finMd: string): string {
  const titre = finMd.match(/^# (.+)$/m)?.[1] ?? 'Fin de branche';
  return [`${titre.replace(/^Fin de branche/, 'Fin de branche prête')}`, section(finMd, 'Contrôles'), 'Détail complet (review, journal) : .workflow/fin.md']
    .filter(Boolean)
    .join('\n');
}
