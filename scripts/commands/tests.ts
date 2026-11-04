// wf tests <fichiers de test> — pour l'exécuteur : lance ces tests comme verify les lance (jest --forceExit,
// délai de 10 min, rapport JSON) et rend un résumé court. Un `npx jest` lancé à la main restait bloqué
// plusieurs minutes après son rapport quand un test laissait une opération ouverte (AVI, T29).
// Le rapport va dans le dossier temporaire du système : .workflow/ est protégé pendant l'exécuteur.
// Code 0 si tout passe, 1 sinon.

import { existsSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { lireArguments } from '../lib/args.ts';
import { racineDepot } from '../lib/depot.ts';
import { terminer } from '../lib/result.ts';
import { lancerTestsDuProjet, resumerRapport } from '../lib/runner.ts';

const C = 'tests';

export async function run(args: string[]): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });

  const fichiers = lireArguments(args).positionnels.map((f) => f.replace(/\\/g, '/'));
  if (fichiers.length === 0) terminer({ statut: 'ECHEC', commande: C, message: 'Usage : wf tests <fichier de test> [autres fichiers…]' });
  const dossiers = fichiers.filter((f) => existsSync(resolve(racine, f)) && statSync(resolve(racine, f)).isDirectory());
  if (dossiers.length > 0) terminer({ statut: 'ECHEC', commande: C, message: `${dossiers.join(', ')} : donne des fichiers de test, pas des dossiers.` });

  const sortie = join(tmpdir(), `wf-tests-${process.pid}`);
  let resume: { ok: boolean; texte: string } | null = null;
  let erreur = '';
  try {
    resume = resumerRapport(lancerTestsDuProjet(racine, fichiers, sortie));
  } catch (e) {
    erreur = e instanceof Error ? e.message : String(e);
  }
  rmSync(sortie, { recursive: true, force: true });
  if (!resume) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: erreur });
  terminer({ statut: resume.ok ? 'OK' : 'ECHEC', commande: C, message: resume.texte });
}
