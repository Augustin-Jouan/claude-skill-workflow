// wf setup --parcours <micro|court|complet> --slug <nom> [--worktree]
// Crée la branche, exclut .workflow/ de git localement et initialise l'état dans .workflow/<slug>/.
// Rien n'est écrit dans un fichier versionné du dépôt. Refuse un projet où verify ne pourrait pas lancer les tests.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CONFIG } from '../../config/defaults.ts';
import { lireArguments, texte } from '../lib/args.ts';
import { dossierWorkflow, git, messageGit, racineDepot } from '../lib/depot.ts';
import { ecrireEtat, lireEtat, PARCOURS, type Parcours } from '../lib/etat.ts';
import { controlerProjet } from '../lib/projet.ts';
import { nonImplemente, terminer } from '../lib/result.ts';

const C = 'setup';

export async function run(args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });

  const { options } = lireArguments(args);
  const parcours = texte(options, 'parcours');
  const slug = texte(options, 'slug');

  if (!parcours || !(PARCOURS as readonly string[]).includes(parcours)) {
    terminer({ statut: 'ECHEC', commande: C, message: '--parcours est requis : micro, court ou complet.' });
  }
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    terminer({ statut: 'ECHEC', commande: C, message: '--slug est requis : minuscules, chiffres et tirets, 2 à 41 caractères.' });
  }
  if (options.worktree) nonImplemente('setup --worktree', 5);

  const branche = `${CONFIG.branche.prefixe}${slug}`;
  const dossier = dossierWorkflow(racine, branche);
  if (lireEtat(dossier)) {
    terminer({ statut: 'ECHEC', commande: C, message: `Un workflow existe déjà pour ${branche} (.workflow/${slug}/) : choisis un autre slug.` });
  }

  const problemes = controlerProjet(racine);
  if (problemes.length > 0) {
    terminer({ statut: 'ECHEC', commande: C, message: `Le projet n'est pas prêt pour le workflow :\n${problemes.map((p) => `- ${p}`).join('\n')}\n\nCorrige, puis relance « wf setup ».` });
  }

  exclureLocalement(racine);

  try {
    git(['switch', '-c', branche], racine);
  } catch (e) {
    terminer({ statut: 'ECHEC', commande: C, message: `Impossible de créer la branche ${branche} : ${messageGit(e)}` });
  }

  ecrireEtat(dossier, {
    version: 1,
    parcours: parcours as Parcours,
    slug,
    branche,
    etape: 'spec',
    historique: [{ de: null, vers: 'spec', date: new Date().toISOString(), note: `parcours ${parcours}` }],
  });

  terminer({
    statut: 'OK',
    commande: C,
    message: `Branche ${branche} créée, parcours ${parcours}. Étape en cours : spec.`,
    details: { branche, parcours, dossier },
  });
}

// .git/info/exclude est un .gitignore personnel : jamais commité, invisible pour les collègues.
function exclureLocalement(racine: string): void {
  const chemin = resolve(racine, git(['rev-parse', '--git-path', 'info/exclude'], racine));
  mkdirSync(dirname(chemin), { recursive: true });
  const contenu = existsSync(chemin) ? readFileSync(chemin, 'utf8') : '';
  if (contenu.split(/\r?\n/).includes('.workflow/')) return;
  const separateur = contenu && !contenu.endsWith('\n') ? '\n' : '';
  appendFileSync(chemin, `${separateur}# workflow (local, jamais commité)\n.workflow/\n`);
}
