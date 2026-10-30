// wf suivre — affiche en direct ce que fait Cursor (.workflow/cursor.log : fichiers lus et modifiés, commandes et
// leur code, réflexion, réponse). À lancer dans un autre terminal, depuis la racine du dépôt ; Ctrl+C pour quitter.
// Lecture seule : ne touche ni à l'état ni au journal.

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dossierWorkflow, racineDepot } from '../lib/depot.ts';
import { terminer } from '../lib/result.ts';

const C = 'suivre';
const DERNIERES_LIGNES = 30;

export async function run(): Promise<void> {
  const racine = racineDepot();
  if (!racine) terminer({ statut: 'ERREUR_OUTIL', commande: C, message: "Ce dossier n'est pas dans un dépôt git." });
  const fichier = join(dossierWorkflow(racine), 'cursor.log');

  let position = 0;
  if (existsSync(fichier)) {
    const contenu = readFileSync(fichier, 'utf8');
    process.stdout.write(`${contenu.trimEnd().split(/\r?\n/).slice(-DERNIERES_LIGNES).join('\n')}\n`);
    position = statSync(fichier).size;
  } else {
    process.stdout.write('En attente du premier appel Cursor…\n');
  }

  await new Promise<never>(() => {
    setInterval(() => {
      if (!existsSync(fichier)) return;
      const taille = statSync(fichier).size;
      if (taille < position) position = 0;
      if (taille === position) return;
      const tampon = Buffer.alloc(taille - position);
      const fd = openSync(fichier, 'r');
      readSync(fd, tampon, 0, tampon.length, position);
      closeSync(fd);
      position = taille;
      process.stdout.write(tampon.toString('utf8'));
    }, 500);
  });
}
