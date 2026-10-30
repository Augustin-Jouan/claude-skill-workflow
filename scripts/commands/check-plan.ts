// wf check-plan — lit .workflow/spec.md et .workflow/plan.md, applique les règles de
// references/plan-yaml.md et génère .workflow/matrice.md. Code 0 si le plan passe,
// 1 avec la liste des violations sinon (la matrice précédente est alors supprimée).

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { lireEtat } from '../lib/etat.ts';
import { genererMatrice } from '../lib/matrice.ts';
import { lirePlan, type Violation } from '../lib/plan.ts';
import { ordreTaches, verifierPlan } from '../lib/regles-plan.ts';
import { terminer } from '../lib/result.ts';
import { enregistrerCheckPlan } from '../lib/sortie.ts';
import { lireSpec } from '../lib/spec.ts';

const C = 'check-plan';

export async function run(_args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });

  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });

  for (const fichier of ['spec.md', 'plan.md']) {
    if (!existsSync(join(dossier, fichier))) {
      terminer({ statut: 'ECHEC', commande: C, message: `.workflow/${fichier} est absent.` });
    }
  }

  const spec = lireSpec(readFileSync(join(dossier, 'spec.md'), 'utf8'));
  const lecture = lirePlan(readFileSync(join(dossier, 'plan.md'), 'utf8'));
  const violations: Violation[] = [
    ...spec.erreurs.map((message) => ({ regle: 'spec', message })),
    ...lecture.violations,
  ];
  if (lecture.plan) violations.push(...verifierPlan(spec.exigences, lecture.plan, etat.parcours));

  const matrice = join(dossier, 'matrice.md');
  if (violations.length > 0 || !lecture.plan) {
    rmSync(matrice, { force: true });
    enregistrerCheckPlan(dossier, false);
    terminer({
      statut: 'ECHEC',
      commande: C,
      message: `Plan refusé : ${violations.length} violation(s).\n${violations.map((v) => `- [${v.regle}] ${v.message}`).join('\n')}`,
      details: { violations },
    });
  }

  const ordre = ordreTaches(lecture.plan.taches) ?? [];
  writeFileSync(matrice, genererMatrice(spec.exigences, lecture.plan, ordre, new Date().toISOString()));
  enregistrerCheckPlan(dossier, true);
  terminer({
    statut: 'OK',
    commande: C,
    message: `Plan valide : ${spec.exigences.length} exigence(s), ${lecture.plan.taches.length} tâche(s). Matrice générée : .workflow/matrice.md\nOrdre : ${ordre.join(' → ')}`,
    details: { exigences: spec.exigences.length, taches: lecture.plan.taches.length, ordre, matrice: '.workflow/matrice.md' },
  });
}
