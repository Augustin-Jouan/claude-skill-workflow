// Matrice de traçabilité (.workflow/matrice.md) : exigence → tâche(s) → test(s) → assertions.
// Toujours générée par check-plan à partir d'un plan vert, jamais écrite à la main.

import { CONFIG } from '../../config/defaults.ts';
import { exigenceDuNom } from './nom-test.ts';
import type { Plan } from './plan.ts';
import type { Exigence } from './spec.ts';

function cellule(texte: string): string {
  return texte.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

export function genererMatrice(spec: Exigence[], plan: Plan, ordre: string[], date: string): string {
  const taches = ordre.map((id) => plan.taches.find((t) => t.id === id)).filter((t) => t !== undefined);
  const lignes = [
    '# Matrice de traçabilité',
    '',
    `> Générée par check-plan le ${date}. Ne pas modifier à la main : corrige la spec ou le plan, puis relance « wf check-plan ».`,
    '',
    `Parcours : ${plan.entete.parcours} · ${spec.length} exigence(s) · ${plan.taches.length} tâche(s)`,
    '',
    `Ordre d'exécution : ${ordre.join(' → ')}`,
  ];
  if (plan.entete.jalons.length > 0) lignes.push('', `Jalons : ${plan.entete.jalons.join(', ')}`);
  if (plan.entete.e2e_non_applicable) lignes.push('', `E2E non applicable : ${plan.entete.e2e_non_applicable}`);

  const { simple, complexe } = CONFIG.modeles.executeur;
  lignes.push(
    '',
    '## Tâches',
    '',
    `Modèle de l'exécuteur : simple → ${simple}, complexe → ${complexe}. Une tâche simple rejetée une fois passe au modèle complexe.`,
    '',
    '| Tâche | Type | Difficulté |',
    '|---|---|---|',
    ...taches.map((t) => `| ${t.id} | ${t.e2e ? `${t.type} · e2e` : t.type} | ${t.difficulte} |`),
  );

  for (const ex of spec) {
    const couvrantes = taches.filter((t) => t.exigences.includes(ex.id));
    lignes.push(
      '',
      `## ${ex.id} — ${ex.titre}`,
      '',
      `Tâches : ${couvrantes.map((t) => t.id).join(', ')}`,
      '',
      '| Tâche | Type | Test | Assertions | Comportement existant |',
      '|---|---|---|---|---|',
    );
    for (const t of couvrantes) {
      const type = t.e2e ? `${t.type} · e2e` : t.type;
      for (const test of t.tests.filter((x) => exigenceDuNom(x.nom) === ex.id)) {
        const assertions = test.assertions.map(cellule).join(' ; ');
        lignes.push(`| ${t.id} | ${type} | ${cellule(test.nom)} | ${assertions} | ${test.comportement_existant ? 'oui' : 'non'} |`);
      }
    }
  }
  return `${lignes.join('\n')}\n`;
}
