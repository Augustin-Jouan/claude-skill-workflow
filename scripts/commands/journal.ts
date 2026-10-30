// wf journal audit --phase <spec|plan|spec-plan> --remontes N --acceptes N --rejetes N
// wf journal manuel --phase <nom> --minutes N
// Ajoute une ligne à .workflow/journal.jsonl, qui sert à mesurer ce que rapporte chaque phase.
// Un tri d'audit doit compter tous les points du dernier audit de la phase lancé par « wf audit ».

import { entier, lireArguments, texte } from '../lib/args.ts';
import { dernierAudit } from '../lib/audits.ts';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { lireEtat } from '../lib/etat.ts';
import { ajouterAuJournal } from '../lib/journal.ts';
import { terminer } from '../lib/result.ts';

const C = 'journal';
const PHASES_AUDIT = ['spec', 'plan', 'spec-plan'];
const PHASES_MANUELLES = ['brainstorming', 'relecture-spec', 'relecture-rejets', 'relecture-matrice', 'review-finale'];

export async function run(args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });

  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });

  const { positionnels, options } = lireArguments(args);
  const type = positionnels[0];
  const phase = texte(options, 'phase');
  let ligne: Record<string, unknown>;

  if (type === 'audit') {
    const remontes = entier(options, 'remontes');
    const acceptes = entier(options, 'acceptes');
    const rejetes = entier(options, 'rejetes');
    if (!phase || !PHASES_AUDIT.includes(phase)) {
      terminer({ statut: 'ECHEC', commande: C, message: `--phase doit valoir ${PHASES_AUDIT.join(', ')}.` });
    }
    if (remontes === undefined || acceptes === undefined || rejetes === undefined) {
      terminer({ statut: 'ECHEC', commande: C, message: '--remontes, --acceptes et --rejetes sont requis (entiers).' });
    }
    if (acceptes + rejetes !== remontes) {
      terminer({
        statut: 'ECHEC',
        commande: C,
        message: `acceptés (${acceptes}) + rejetés (${rejetes}) ≠ remontés (${remontes}) : chaque point doit être trié une fois.`,
      });
    }
    const audit = dernierAudit(dossier, phase);
    if (audit && audit.points.length !== remontes) {
      terminer({
        statut: 'ECHEC',
        commande: C,
        message: `Le dernier audit ${phase} (n° ${audit.numero}) compte ${audit.points.length} point(s), pas ${remontes} : chaque point doit être trié.`,
      });
    }
    ligne = { type: 'audit', phase, audit: audit?.numero ?? null, remontes, acceptes, rejetes };
  } else if (type === 'manuel') {
    const minutes = entier(options, 'minutes');
    if (!phase || !PHASES_MANUELLES.includes(phase)) {
      terminer({ statut: 'ECHEC', commande: C, message: `--phase doit valoir ${PHASES_MANUELLES.join(', ')}.` });
    }
    if (minutes === undefined) terminer({ statut: 'ECHEC', commande: C, message: '--minutes est requis (entier).' });
    ligne = { type: 'manuel', phase, minutes };
  } else {
    terminer({ statut: 'ECHEC', commande: C, message: 'Type attendu : audit ou manuel.' });
  }

  terminer({ statut: 'OK', commande: C, message: 'Ligne ajoutée au journal.', details: ajouterAuJournal(dossier, etat, ligne) });
}
