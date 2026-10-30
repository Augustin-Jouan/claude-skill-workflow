// Contrat de sortie commun à toutes les commandes : le code de sortie est le seul verdict
// que le skill a le droit de suivre. La dernière ligne de stdout en donne le détail en JSON.

export const EXIT = {
  OK: 0,
  ECHEC: 1,
  ERREUR_OUTIL: 2,
  ATTENTE_UTILISATEUR: 3,
} as const;

export type Statut = keyof typeof EXIT;

export interface Resultat {
  statut: Statut;
  commande: string;
  message: string;
  details?: unknown;
}

let dossierAffiche: string | null = null;

export function definirDossierAffiche(relatif: string): void {
  dossierAffiche = relatif;
}

// Les messages nomment les fichiers « .workflow/question.md » ; ils vivent dans le dossier de la branche
// (.workflow/<slug>/, voir dossierWorkflow). Un chemin qui le nomme déjà reste tel quel.
export function localiser(texte: string, dossier: string | null = dossierAffiche): string {
  if (!dossier) return texte;
  const dedans = dossier.slice('.workflow/'.length);
  return texte.replace(/\.workflow\//g, (m, i: number) => (texte.startsWith(`${dedans}/`, i + m.length) ? m : `${dossier}/`));
}

export function terminer(r: Resultat): never {
  const resultat = { ...r, message: localiser(r.message) };
  const flux = resultat.statut === 'OK' ? process.stdout : process.stderr;
  flux.write(`${resultat.message}\n`);
  process.stdout.write(`WF_RESULT ${JSON.stringify(resultat)}\n`);
  process.exit(EXIT[resultat.statut]);
}

export function nonImplemente(commande: string, couche: number): never {
  return terminer({
    statut: 'ERREUR_OUTIL',
    commande,
    message:
      `« wf ${commande} » n'est pas encore implémentée (couche ${couche} de l'outillage). ` +
      `Arrête le workflow et préviens l'utilisateur ; ne remplace pas ce contrôle par une vérification manuelle.`,
    details: { couche },
  });
}
