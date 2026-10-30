// wf state                              affiche l'étape en cours
// wf state avancer --note "..."         passe à l'étape suivante du parcours
// wf state revenir <etape> --note "..." revient à une étape déjà franchie (replanification)

import { lireArguments, texte } from '../lib/args.ts';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { ecrireEtat, etapesDuParcours, lireEtat, type Etape, type Etat } from '../lib/etat.ts';
import { terminer } from '../lib/result.ts';
import { conditionsDeSortie } from '../lib/sortie.ts';

const C = 'state';

export async function run(args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });

  const dossier = dossierWorkflow(racine);
  const etat = lireEtat(dossier);
  const { positionnels, options } = lireArguments(args);
  const action = positionnels[0] ?? 'afficher';

  if (action === 'afficher') {
    if (!etat) terminer({ statut: 'OK', commande: C, message: 'Aucun workflow en cours sur cette branche.', details: { etat: null } });
    const restantes = etapesDuParcours(etat.parcours).slice(etapesDuParcours(etat.parcours).indexOf(etat.etape));
    terminer({
      statut: 'OK',
      commande: C,
      message: `Parcours ${etat.parcours} · branche ${etat.branche} · étape en cours : ${etat.etape}\nÉtapes restantes : ${restantes.join(' → ')}\nDossier : .workflow/`,
      details: { etat },
    });
  }

  if (!etat) terminer({ statut: 'ECHEC', commande: C, message: "Aucun workflow en cours : lance d'abord « wf setup »." });

  const note = texte(options, 'note');
  if (!note) terminer({ statut: 'ECHEC', commande: C, message: '--note est requis : ce que l\'utilisateur a validé ou la raison du retour.' });

  const etapes = etapesDuParcours(etat.parcours);
  const index = etapes.indexOf(etat.etape);

  if (action === 'avancer') {
    if (etat.etape === 'termine') terminer({ statut: 'ECHEC', commande: C, message: 'Le workflow est déjà terminé.' });
    const manques = conditionsDeSortie(etat.etape, dossier);
    if (manques.length > 0) {
      terminer({
        statut: 'ECHEC',
        commande: C,
        message: `Impossible de quitter l'étape ${etat.etape} :\n${manques.map((m) => `- ${m}`).join('\n')}`,
        details: { etape: etat.etape, manques },
      });
    }
    changerEtape(dossier, etat, etapes[index + 1], note);
  }

  if (action === 'revenir') {
    const cible = positionnels[1] as Etape | undefined;
    if (!cible || !etapes.includes(cible) || etapes.indexOf(cible) >= index) {
      terminer({
        statut: 'ECHEC',
        commande: C,
        message: `Étape cible invalide. Étapes déjà franchies : ${etapes.slice(0, index).join(', ') || 'aucune'}.`,
      });
    }
    changerEtape(dossier, etat, cible, note);
  }

  terminer({ statut: 'ECHEC', commande: C, message: `Action inconnue : ${action}. Actions : avancer, revenir.` });
}

function changerEtape(dossier: string, etat: Etat, vers: Etape, note: string): never {
  etat.historique.push({ de: etat.etape, vers, date: new Date().toISOString(), note });
  etat.etape = vers;
  ecrireEtat(dossier, etat);
  terminer({ statut: 'OK', commande: C, message: `Étape en cours : ${vers}.`, details: { etape: vers } });
}
