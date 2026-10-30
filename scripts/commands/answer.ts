// wf answer "<réponse>" — enregistre la réponse du développeur à la question de run-plan (.workflow/question.md).
// run-plan l'applique à sa prochaine reprise. Une replanification n'a pas besoin de réponse : un plan amendé
// (et repassé par check-plan) rend la question caduque.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { lireArguments } from '../lib/args.ts';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { lireEtat } from '../lib/etat.ts';
import { ajouterAuJournal } from '../lib/journal.ts';
import { terminer } from '../lib/result.ts';
import { ecrireRun, lireRun } from '../lib/run-etat.ts';

const C = 'answer';

export async function run(args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });
  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });

  const run = lireRun(dossier);
  const attente = run.attente;
  if (!attente) terminer({ statut: 'ECHEC', commande: C, message: "Aucune question de run-plan n'attend de réponse." });
  const reponse = lireArguments(args).positionnels.join(' ').trim();
  if (!reponse) terminer({ statut: 'ECHEC', commande: C, message: 'Réponse vide : wf answer "<réponse>".' });

  attente.reponse = reponse;
  ecrireRun(dossier, run);
  rmSync(join(dossier, 'question.md'), { force: true });
  ajouterAuJournal(dossier, etat, { type: 'reponse', tache: attente.tache, motif: attente.motif, reponse });
  terminer({ statut: 'OK', commande: C, message: 'Réponse enregistrée : relance « wf run-plan ».', details: { tache: attente.tache, motif: attente.motif } });
}
